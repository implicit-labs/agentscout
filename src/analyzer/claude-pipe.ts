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

    lines.push(`\n${"=".repeat(60)}`);
    lines.push(`PROJECT: ${project.projectName} (${project.projectPath})`);
    lines.push(`Sessions: ${project.sessionCount} | Tool calls: ${project.toolCalls.length} | Bash commands: ${project.bashCommands.length}`);
    lines.push(`${"=".repeat(60)}`);

    // Bash commands for this project
    if (project.bashCommands.length > 0) {
      lines.push(`\n--- Bash Commands (${project.projectName}) ---`);
      for (const cmd of project.bashCommands.slice(0, 25)) {
        const truncated = cmd.length > 200 ? cmd.substring(0, 197) + "..." : cmd;
        lines.push(`  $ ${truncated}`);
      }
    }

    // User messages — what they're asking Claude to do
    if (project.userMessages.length > 0) {
      lines.push(`\n--- User Requests (${project.projectName}) ---`);
      for (const msg of project.userMessages.slice(0, 10)) {
        const truncated = msg.length > 250 ? msg.substring(0, 247) + "..." : msg;
        lines.push(`  > ${truncated}`);
      }
    }

    // CRITICAL: Where Claude tells the user to do something manually
    if (project.assistantHandoffs.length > 0) {
      lines.push(`\n--- Claude Handoffs to Human (${project.projectName}) ---`);
      lines.push(`  [These are moments where Claude admitted it can't do something and told the user to do it manually]`);
      for (const handoff of project.assistantHandoffs.slice(0, 15)) {
        const truncated = handoff.length > 250 ? handoff.substring(0, 247) + "..." : handoff;
        lines.push(`  ! ${truncated}`);
      }
    }

    // Tool call frequency for this project
    const toolFreq = new Map<string, number>();
    for (const call of project.toolCalls) {
      toolFreq.set(call.name, (toolFreq.get(call.name) || 0) + 1);
    }
    if (toolFreq.size > 0) {
      lines.push(`\n--- Tool Usage (${project.projectName}) ---`);
      const sorted = [...toolFreq.entries()].sort((a, b) => b[1] - a[1]);
      for (const [name, count] of sorted.slice(0, 10)) {
        lines.push(`  ${name}: ${count}x`);
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
      "workflowOwnership": "low|med|high",
      "painEliminated": "low|med|high",
      "agentReadiness": "low|med|high",
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
  if (!isClaudeAvailable()) {
    return null;
  }

  const sessionSample = buildSessionSample(scanResult);
  const prompt = buildPrompt(sessionSample, installedTools, scanResult);

  // Write prompt to temp file to avoid shell escaping issues
  const tmpFile = join(tmpdir(), `agentscout-prompt-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt, "utf-8");

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
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

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(chunks.join(""));
        } else {
          reject(new Error(`claude exited with code ${code}`));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });

      // Timeout after 3 minutes
      setTimeout(() => {
        proc.kill();
        reject(new Error("claude analysis timed out"));
      }, 180_000);
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

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*"insights"[\s\S]*"recommendations"[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as AIAnalysisResult;

    if (!Array.isArray(parsed.insights) || !Array.isArray(parsed.recommendations)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}
