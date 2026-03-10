import { execSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScanResult } from "../scanner/sessions.js";
import type { InstalledTool } from "../scanner/installed.js";
import toolsCatalog from "../catalog/tools.json" with { type: "json" };

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

function buildSessionSample(scanResult: ScanResult): string {
  const lines: string[] = [];

  for (const project of scanResult.projects) {
    const hasData =
      project.bashCommands.length > 0 ||
      project.userMessages.length > 0 ||
      project.assistantHandoffs.length > 0;
    if (!hasData) continue;

    lines.push(`\n[${project.projectName}] (${project.sessionCount} sessions, ${project.toolCalls.length} tool calls)`);

    // CRITICAL FIRST: Where Claude tells the user to do something manually
    if (project.assistantHandoffs.length > 0) {
      lines.push(`  HANDOFFS (Claude told user to do manually):`);
      for (const handoff of project.assistantHandoffs.slice(0, 5)) {
        const truncated = handoff.length > 150 ? handoff.substring(0, 147) + "..." : handoff;
        lines.push(`    ! ${truncated}`);
      }
    }

    // Top bash commands (deduplicated by prefix to reduce noise)
    if (project.bashCommands.length > 0) {
      const cmdPrefixes = new Map<string, number>();
      for (const cmd of project.bashCommands) {
        const prefix = cmd.split(/\s+/).slice(0, 3).join(" ");
        cmdPrefixes.set(prefix, (cmdPrefixes.get(prefix) || 0) + 1);
      }
      const topCmds = [...cmdPrefixes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      lines.push(`  Top commands: ${topCmds.map(([c, n]) => `${c} (${n}x)`).join(", ")}`);
    }

    // Key user messages (first 3, short)
    if (project.userMessages.length > 0) {
      lines.push(`  User asks:`);
      for (const msg of project.userMessages.slice(0, 3)) {
        const truncated = msg.length > 120 ? msg.substring(0, 117) + "..." : msg;
        lines.push(`    > ${truncated}`);
      }
    }
  }

  return lines.join("\n");
}

function buildPrompt(
  sessionSample: string,
  installedTools: InstalledTool[],
  scanResult: ScanResult
): string {
  const installedList = installedTools
    .map(
      (t) =>
        `- ${t.name} (${t.source}${t.project ? `, project: ${t.project}` : ""})`
    )
    .join("\n");

  const catalogList = toolsCatalog
    .map(
      (t) =>
        `- ${t.name} [${t.id}] (${t.type}): ${t.sellTemplate} | Install: ${t.installCommand} | URL: ${t.url} | Stars: ${t.meta.stars} | Permissions: ${t.meta.permissions} | Risk: ${t.meta.riskLevel}`
    )
    .join("\n");

  return `You are AgentScout. You analyze a developer's Claude Code session history to find where agents COULD own workflows but currently don't.

REAL SESSION DATA from ${scanResult.totalProjects} projects, ${scanResult.totalSessions} sessions:

${sessionSample}

=== TOOLS ALREADY INSTALLED ===
${installedList || "None"}

=== KNOWN TOOL CATALOG (you may also suggest tools outside this list) ===
${catalogList}

YOUR ANALYSIS PRIORITIES (in order):

1. **HANDOFFS are the #1 signal.** The "Claude Handoffs to Human" sections show where Claude literally told the user "you need to manually do X." Each one is a tool opportunity. A tool that handles that handoff means the agent can own that step end-to-end.

2. **Project attribution is mandatory.** Every recommendation MUST list the specific projects it applies to. If a tool only helps one project, say so. If it helps 5 projects, list all 5. Do NOT recommend tools that have no evidence in any project.

3. **Be specific about what gets automated.** Don't say "manages your database." Say "In project 'primitive', Claude repeatedly asked you to check Supabase RLS policies manually — with the Supabase MCP, the agent handles RLS, migrations, and schema changes directly."

4. **Call out gotchas and blockers.** If npm publish requires 2FA, say that and suggest workarounds (--otp flag, CI tokens). If a tool needs admin access, flag it. Don't just recommend — explain what it takes to actually make it work.

5. **Only recommend what the data supports.** If you see zero Kubernetes or AWS usage, do NOT recommend K8s or AWS tools. Every recommendation must have real evidence from the session data.

RESPOND WITH ONLY THIS JSON (no markdown, no backticks):
{
  "insights": [
    "Specific observation about a workflow pattern — reference the project and actual commands/handoffs"
  ],
  "recommendations": [
    {
      "name": "Tool Name",
      "type": "mcp|cli|package",
      "installCommand": "how to install",
      "url": "github or docs url",
      "workflowOwnership": "low|med|high (Handoff Index: how much the agent can do without human intervention)",
      "painEliminated": "low|med|high (Time Reclaimed: how much time and frustration is saved)",
      "agentReadiness": "low|med|high (Agent Readiness: trust, reliability, maturity of the tool)",
      "sellDescription": "2-sentence description referencing THIS developer's SPECIFIC projects and pain",
      "evidence": "The specific commands/handoffs/patterns from their sessions, with project names",
      "projects": ["project-name-1", "project-name-2"],
      "gotchas": "Known blockers, permission issues, 2FA requirements, or limitations. Empty string if none.",
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
  installedTools: InstalledTool[]
): Promise<AIAnalysisResult | null> {
  console.error("[agentscout] Checking if claude CLI is available...");
  if (!isClaudeAvailable()) {
    console.error("[agentscout] claude CLI not found in PATH, falling back to regex");
    return null;
  }
  console.error("[agentscout] claude CLI found, building prompt...");

  const sessionSample = buildSessionSample(scanResult);
  const prompt = buildPrompt(sessionSample, installedTools, scanResult);
  console.error(`[agentscout] Prompt built: ${prompt.length} chars`);

  // Write prompt to temp file to avoid shell escaping issues
  const tmpFile = join(tmpdir(), `agentscout-prompt-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt, "utf-8");
  console.error(`[agentscout] Prompt written to ${tmpFile}`);

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      let settled = false;
      // Unset CLAUDECODE to allow nested sessions when running from within Claude Code
      const env = { ...process.env };
      delete env.CLAUDECODE;
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
