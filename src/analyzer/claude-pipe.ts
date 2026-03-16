import { execSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScanResult } from "../scanner/sessions.js";
import type { InstalledTool } from "../scanner/installed.js";
import type { WorkflowSignal } from "../scanner/signals.js";
import { loadCatalogSync } from "../catalog/remote.js";

export type ScoreLevel = "low" | "med" | "high";

export interface AIRecommendation {
  name: string;
  type: "mcp" | "cli" | "package";
  installCommand: string;
  url: string;
  workflowOwnership: ScoreLevel;
  painEliminated: ScoreLevel;
  agentReadiness: ScoreLevel;
  sellDescription: string;
  evidence: string;
  projects: string[];
  gotchas: string;
  alreadyInstalled: boolean;
}

export interface AIAnalysisResult {
  insights: string[];
  recommendations: AIRecommendation[];
}

// Frustration patterns to identify painful user messages (not just any messages)
const PAIN_PATTERNS = [
  /\bstill not working\b/i,
  /\bstill broken\b/i,
  /\bsame (?:error|issue|problem|bug)\b/i,
  /\bnot what i (?:asked|wanted|meant)\b/i,
  /\bthat'?s (?:not |in)?correct\b/i,
  /\bi (?:already|just) (?:told|said|asked)\b/i,
  /\bwhy (?:is|does|did|are|isn't|doesn't|won't)\b/i,
  /\bwrong\b/i,
  /\bundo\b/i,
  /\brevert\b/i,
  /\bjust (?:do|make|fix)\b/i,
  /\bcome on\b/i,
  /!!+/,
  /\bdon'?t do that\b/i,
  /\bactually[,]?\s+(?:i want|let's|we should|don't)\b/i,
  /\bnot (?:this|that|the)\b/i,
];

function isSkillContent(text: string): boolean {
  return (
    text.startsWith("Base directory for this skill:") ||
    text.startsWith("# ") ||
    text.startsWith("This session is being continued") ||
    text.includes("SKILL.md") ||
    text.length > 500
  );
}

function extractPainfulMessages(userMessages: string[]): string[] {
  const painful: string[] = [];
  for (const msg of userMessages) {
    if (isSkillContent(msg)) continue;
    if (msg.length < 5) continue;
    for (const pattern of PAIN_PATTERNS) {
      if (pattern.test(msg)) {
        const truncated = msg.length > 150 ? msg.substring(0, 147) + "..." : msg;
        painful.push(truncated);
        break;
      }
    }
  }
  return painful;
}

function buildProjectPainStories(
  scanResult: ScanResult,
  signals: WorkflowSignal[]
): string {
  const lines: string[] = [];

  // Index signals by project for quick lookup
  const signalsByProject = new Map<string, WorkflowSignal[]>();
  for (const s of signals) {
    const existing = signalsByProject.get(s.project) || [];
    existing.push(s);
    signalsByProject.set(s.project, existing);
  }

  for (const project of scanResult.projects) {
    const hasData =
      project.bashCommands.length > 0 ||
      project.userMessages.length > 0 ||
      project.assistantHandoffs.length > 0;
    if (!hasData) continue;

    const projectSignals = signalsByProject.get(project.projectName) || [];
    const painfulMsgs = extractPainfulMessages(project.userMessages);

    lines.push(`\n[${project.projectName}] (${project.sessionCount} sessions, ${project.toolCalls.length} tool calls)`);

    // 1. HANDOFFS — where Claude told the user to do it manually
    if (project.assistantHandoffs.length > 0) {
      lines.push(`  HANDOFFS (agent told user to do manually):`);
      for (const handoff of project.assistantHandoffs.slice(0, 4)) {
        const truncated = handoff.length > 150 ? handoff.substring(0, 147) + "..." : handoff;
        lines.push(`    ! ${truncated}`);
      }
    }

    // 2. FRUSTRATED MOMENTS — actual user messages showing pain
    if (painfulMsgs.length > 0) {
      lines.push(`  FRUSTRATED USER (actual quotes):`);
      for (const msg of painfulMsgs.slice(0, 4)) {
        lines.push(`    > "${msg}"`);
      }
    }

    // 3. YOYO FILES — files edited back-and-forth excessively
    const yoyos = projectSignals.filter((s) => s.type === "yoyo-file");
    if (yoyos.length > 0) {
      lines.push(`  YOYO FILES (edited back-and-forth):`);
      for (const y of yoyos.slice(0, 3)) {
        lines.push(`    ~ ${y.description}`);
      }
    }

    // 4. TOOL ERRORS — what kept failing
    const errors = projectSignals.filter((s) => s.type === "tool-error");
    if (errors.length > 0) {
      lines.push(`  TOOL ERRORS:`);
      for (const e of errors.slice(0, 3)) {
        lines.push(`    x ${e.description}: ${e.evidence.substring(0, 100)}`);
      }
    }

    // 5. REPEATED COMMANDS — automation candidates
    const repeated = projectSignals.filter((s) => s.type === "repeated-command");
    if (repeated.length > 0) {
      lines.push(`  REPEATED COMMANDS (automation candidates):`);
      for (const r of repeated.slice(0, 3)) {
        lines.push(`    # ${r.description}`);
      }
    }

    // 6. INTERRUPTIONS — agent going wrong direction
    const interrupts = projectSignals.filter((s) => s.type === "interrupted");
    if (interrupts.length > 0) {
      lines.push(`  INTERRUPTIONS: ${interrupts[0].description}`);
    }

    // 7. Top commands (compact)
    if (project.bashCommands.length > 0) {
      const cmdPrefixes = new Map<string, number>();
      for (const cmd of project.bashCommands) {
        const prefix = cmd.split(/\s+/).slice(0, 3).join(" ");
        cmdPrefixes.set(prefix, (cmdPrefixes.get(prefix) || 0) + 1);
      }
      const topCmds = [...cmdPrefixes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      lines.push(`  Top commands: ${topCmds.map(([c, n]) => `${c} (${n}x)`).join(", ")}`);
    }
  }

  return lines.join("\n");
}

function buildPrompt(
  painStories: string,
  installedTools: InstalledTool[],
  scanResult: ScanResult
): string {
  const installedList = installedTools
    .map(
      (t) =>
        `- ${t.name} (${t.source}${t.project ? `, project: ${t.project}` : ""})`
    )
    .join("\n");

  const catalogList = loadCatalogSync()
    .map(
      (t) =>
        `- ${t.name} [${t.id}] (${t.type}): ${t.sellTemplate} | Install: ${t.installCommand} | URL: ${t.url} | Stars: ${t.meta.stars} | Permissions: ${t.meta.permissions} | Risk: ${t.meta.riskLevel}`
    )
    .join("\n");

  return `You are AgentScout. You analyze a developer's Claude Code session history to find where agents COULD own workflows but currently don't.

Below is REAL session data organized by project. Each project shows:
- HANDOFFS: Where Claude told the user "you need to do this manually"
- FRUSTRATED USER: Actual quotes showing anger, correction, or impatience
- YOYO FILES: Files edited back-and-forth excessively (agent indecision)
- TOOL ERRORS: What kept failing
- REPEATED COMMANDS: Same command run 3+ times (automation candidates)
- INTERRUPTIONS: User hit Escape because agent was going wrong direction

DATA from ${scanResult.totalProjects} projects, ${scanResult.totalSessions} sessions:

${painStories}

=== TOOLS ALREADY INSTALLED ===
${installedList || "None"}

=== KNOWN TOOL CATALOG (you may also suggest tools outside this list) ===
${catalogList}

YOUR ANALYSIS RULES:

1. **Use the ACTUAL quotes and examples.** Your sellDescription and evidence MUST reference the real user quotes, real file names, and real commands from the data above. Do NOT make generic descriptions. Quote the user's actual frustrated words when relevant.

2. **Each recommendation = a specific pain story.** Example: "In 'primitive', you edited SwipeCardView.swift 50 times back-and-forth and said 'why is this still broken'. A Playwright/iOS Simulator verification step after each edit would catch regressions immediately instead of the yoyo cycle."

3. **Project attribution is mandatory.** Every recommendation MUST list specific projects. Do NOT recommend tools without evidence from a specific project.

4. **Suggest compound solutions.** Don't just recommend a raw tool — suggest how to USE it. Example: "Install Supabase MCP, then create a 'supabase-sync' skill that wraps it for dev/prod environment switching. Gotcha: requires write permissions to fully hand off migrations."

5. **Call out gotchas and blockers.** What will prevent the tool from actually working? 2FA? Permission escalation? Requires admin access? Be specific.

6. **Only recommend what the data supports.** Zero K8s/AWS usage = do NOT recommend K8s/AWS tools.

RESPOND WITH ONLY THIS JSON (no markdown, no backticks):
{
  "insights": [
    "A specific pain story from a specific project — quote the user, reference the file, cite the command"
  ],
  "recommendations": [
    {
      "name": "Tool Name",
      "type": "mcp|cli|package",
      "installCommand": "how to install",
      "url": "github or docs url",
      "workflowOwnership": "low|med|high",
      "painEliminated": "low|med|high",
      "agentReadiness": "low|med|high",
      "sellDescription": "2-sentence description that references THIS user's ACTUAL project, file names, and frustrated quotes from the data",
      "evidence": "Quote the specific user messages, file names, commands, and handoffs that prove this recommendation. Include project name.",
      "projects": ["project-name-1", "project-name-2"],
      "gotchas": "Known blockers. Suggest compound solution (tool + skill/wrapper). Empty string if none.",
      "alreadyInstalled": false
    }
  ]
}

Return 5-10 recommendations, ranked by impact. Include already-installed tools if relevant (mark alreadyInstalled: true). Every recommendation MUST have at least one project in the "projects" array.`;
}

function isClaudeAvailable(): boolean {
  try {
    execSync("which claude", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function analyzeWithClaude(
  scanResult: ScanResult,
  installedTools: InstalledTool[],
  signals: WorkflowSignal[] = []
): Promise<AIAnalysisResult | null> {
  console.error("[agentscout] Checking if claude CLI is available...");
  if (!isClaudeAvailable()) {
    console.error("[agentscout] claude CLI not found in PATH, falling back to regex");
    return null;
  }
  console.error("[agentscout] claude CLI found, building prompt...");
  console.error(`[agentscout] ${signals.length} workflow signals detected`);

  const painStories = buildProjectPainStories(scanResult, signals);
  const prompt = buildPrompt(painStories, installedTools, scanResult);
  console.error(`[agentscout] Prompt built: ${prompt.length} chars`);

  // Write prompt to temp file to avoid shell escaping issues
  const tmpFile = join(tmpdir(), `agentscout-prompt-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt, "utf-8");
  console.error(`[agentscout] Prompt written to ${tmpFile}`);

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      let settled = false;
      // Unset all Claude Code env vars to allow nested sessions
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;
      const proc = spawn("sh", ["-c", `cat "${tmpFile}" | claude -p --output-format json`], {
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

      proc.stdout.on("data", (data: Buffer) => {
        chunks.push(data.toString());
      });

      proc.stderr.on("data", () => {
        // ignore stderr
      });

      // close is the ONLY place we resolve — it fires after all data is flushed
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        const output = chunks.join("");
        console.error(`[agentscout] claude exited code=${code}, output=${output.length} chars`);
        if (output.length > 0) {
          resolve(output);
        } else {
          reject(new Error(`claude exited with code ${code} and no output`));
        }
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      // Timeout: kill the process, let the close handler resolve with buffered output
      setTimeout(() => {
        if (!settled) {
          console.error(`[agentscout] timeout reached, killing process...`);
          proc.kill();
          // close handler will fire and resolve with whatever was buffered
        }
      }, 240_000);
    });

    // Parse response
    let content: string;
    try {
      const response = JSON.parse(result);
      content = response.result || response.content || result;
      if (typeof content !== "string") {
        content = JSON.stringify(content);
      }
    } catch {
      content = result;
    }

    // Write debug output
    const debugFile = join(tmpdir(), "agentscout-debug.txt");
    writeFileSync(debugFile, `=== RAW RESULT (${result.length} chars) ===\n${result.substring(0, 2000)}\n\n=== EXTRACTED CONTENT (${content.length} chars) ===\n${content.substring(0, 2000)}\n`, "utf-8");

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*"insights"[\s\S]*"recommendations"[\s\S]*\}/);
    if (!jsonMatch) {
      writeFileSync(debugFile, `\n=== NO JSON MATCH FOUND ===\nFull content:\n${content}\n`, { flag: "a" });
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as AIAnalysisResult;

    if (!Array.isArray(parsed.insights) || !Array.isArray(parsed.recommendations)) {
      return null;
    }

    return parsed;
  } catch (err) {
    console.error(`[agentscout] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    const debugFile = join(tmpdir(), "agentscout-debug.txt");
    writeFileSync(debugFile, `=== ERROR ===\n${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ""}\n`, "utf-8");
    return null;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}
