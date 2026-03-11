/**
 * Workflow Diagnosis Engine
 *
 * Multi-step analysis of developer workflows. Instead of counting signals,
 * this module INTERPRETS what's happening between the lines:
 *
 * - Yoyo files + build commands = "You are the agent's eyes"
 * - Repeated curl commands = "You are the agent's API tester"
 * - Repeated typecheck = "Agent introduces errors it can't catch"
 *
 * The diagnosis is completely independent of any tool catalog.
 */

import { execSync, spawn } from "node:child_process";
import type { ScanResult, ProjectScan } from "../scanner/sessions.js";
import type { InstalledTool } from "../scanner/installed.js";
import type { WorkflowSignal } from "../scanner/signals.js";

// ── Output Types ──

export interface WorkflowLoop {
  name: string;          // "Blind UI Iteration", "Manual Build Verification"
  humanRole: string;     // "You are the agent's eyes"
  description: string;   // What's happening, with specifics
  evidence: string[];    // Supporting data points
  severity: "critical" | "high" | "med" | "low";
  agentGap: string;      // What capability the agent is missing
}

export interface ProjectDiagnosis {
  name: string;
  sessionCount: number;
  toolCallCount: number;
  workflow: string;
  painScore: number;
  workflowLoops: WorkflowLoop[];  // The new interpretive layer
  topCommands: string[];
}

export interface RankedProblem {
  rank: number;
  title: string;
  description: string;
  projects: string[];
  evidence: string[];
  severity: "critical" | "high" | "med" | "low";
  ifFixed: string;
}

export interface Diagnosis {
  techStack: string[];
  projects: ProjectDiagnosis[];
  systemicIssues: string[];
  topProblems: RankedProblem[];
  llmAnalysis: string | null;
}

// ── Tech Stack Detection ──

function extractTechStack(scanResult: ScanResult): string[] {
  const tech = new Set<string>();
  const allCommands = scanResult.projects.flatMap((p) => p.bashCommands);
  const allText = allCommands.join(" ");

  const techPatterns: [RegExp, string][] = [
    [/\bswift\b/i, "Swift"],
    [/\bxcodebuild\b/i, "Xcode"],
    [/\bxcodegen\b/i, "XcodeGen"],
    [/\bnpm\b/i, "npm"],
    [/\btsx?\b/, "TypeScript"],
    [/\breact\b/i, "React"],
    [/\bnext\b/i, "Next.js"],
    [/\bvercel\b/i, "Vercel"],
    [/\bsupabase\b/i, "Supabase"],
    [/\bgit\b/i, "Git"],
    [/\bpython\b/i, "Python"],
    [/\bcurl\b/i, "curl/HTTP"],
    [/\btsup\b/i, "tsup"],
    [/\bplaywright\b/i, "Playwright"],
  ];

  for (const [pattern, name] of techPatterns) {
    if (pattern.test(allText)) tech.add(name);
  }

  return [...tech];
}

// ── Workflow Identification ──

function identifyWorkflow(project: ProjectScan, signals: WorkflowSignal[]): string {
  const allText = [
    ...signals.map((s) => s.description + " " + s.evidence),
    ...project.bashCommands,
  ].join(" ");

  const workflows: [RegExp, string, number][] = [
    [/\.(swift|xib|storyboard)\b/gi, "iOS app development", 0],
    [/\b(xcodebuild|xcodegen|simctl)\b/gi, "iOS app development", 0],
    [/\.(tsx|jsx)\b/gi, "Web/React development", 0],
    [/\b(npm run build|next|vercel)\b/gi, "Web/React development", 0],
    [/\b(supabase|psql|migration|database)\b/gi, "Backend/database development", 0],
    [/\b(curl.*api|endpoint|route)\b/gi, "API development", 0],
    [/\b(hero|landing|marketing)\b/gi, "Landing page development", 0],
    [/\b(deploy|docker|ci|cd)\b/gi, "DevOps/deployment", 0],
    [/\bcli\b/gi, "CLI tool development", 0],
  ];

  for (const entry of workflows) {
    const matches = allText.match(entry[0]);
    entry[2] = matches?.length || 0;
  }

  workflows.sort((a, b) => b[2] - a[2]);
  return workflows[0]?.[2] > 0 ? workflows[0][1] : "General development";
}

// ── Workflow Loop Detectors ──
// These correlate signals to identify WHAT the human is actually doing

function hasVisualVerificationTool(installedTools: InstalledTool[]): boolean {
  return installedTools.some((tool) =>
    /(playwright|puppeteer|ios-simulator|browser)/i.test(tool.name)
  );
}

function isMotionHeavyFile(text: string): boolean {
  return /(animation|animate|motion|transition|spring|swipe|gesture|drag|carousel|hero|scroll|parallax|sheet|card|flow)/i.test(
    text
  );
}

function detectBlindUIIteration(
  project: ProjectScan,
  signals: WorkflowSignal[],
  installedTools: InstalledTool[],
): WorkflowLoop | null {
  // Pattern: yoyo on UI files (.swift views, .tsx components) + build commands
  const yoyos = signals.filter((s) => s.type === "yoyo-file");
  const uiYoyos = yoyos.filter((s) => {
    const d = s.description.toLowerCase();
    return d.includes("view") || d.includes(".tsx") || d.includes(".jsx") ||
      d.includes(".html") || d.includes(".css") || d.includes("component") ||
      d.includes(".swift") || d.includes("hero") || d.includes("card") ||
      d.includes("button") || d.includes("layout") || d.includes("page");
  });

  if (uiYoyos.length === 0) return null;

  // Check for build/verify commands
  const buildCmds = project.bashCommands.filter((c) =>
    /\b(xcodebuild|npm run build|npm run dev|npm start|open http|localhost)\b/i.test(c)
  );

  const totalEdits = uiYoyos.reduce((sum, y) => sum + y.count, 0);
  if (totalEdits < 8) return null;

  const topFiles = uiYoyos
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((y) => {
      const fileName = y.evidence.split("/").pop() || y.description;
      return `${fileName} (${y.count}x)`;
    });

  const severity = totalEdits > 30 ? "critical" : totalEdits > 15 ? "high" : "med";
  const hasVerifier = hasVisualVerificationTool(installedTools);
  const motionHeavyFiles = uiYoyos.filter((y) =>
    isMotionHeavyFile(`${y.description} ${y.evidence}`)
  );
  const motionHeavyEdits = motionHeavyFiles.reduce((sum, y) => sum + y.count, 0);

  if (motionHeavyEdits >= 10) {
    return {
      name: "Motion / Interaction Tuning",
      humanRole: "You are the interaction judge",
      description: `This loop is more specific than \"the agent can't see the UI.\" Files like ${topFiles.join(", ")} suggest motion-heavy or gesture-heavy work, so you are still judging timing, feel, and interaction polish by hand after each change. ${hasVerifier ? "Static screenshots and simulator access exist, but they do not settle whether the experience feels right." : "The agent lacks a reliable way to verify interactive behavior, not just pixels."}`,
      evidence: [
        `Motion-heavy UI files edited ${motionHeavyEdits} total times: ${topFiles.join(", ")}`,
        ...(buildCmds.length > 0 ? [`Build/verify commands run ${buildCmds.length}x`] : []),
      ],
      severity,
      agentGap: hasVerifier
        ? "Existing verification is static; it does not encode interaction quality, timing, or animation feel"
        : "Agent cannot verify interactive behavior, animation timing, or overall UI feel",
    };
  }

  if (hasVerifier) {
    return {
      name: "Verification Workflow Gap",
      humanRole: "You are the final UI reviewer",
      description: `You already have screenshot/browser/simulator tooling available, but the agent still loops on UI edits across ${topFiles.join(", ")}. The missing piece is not raw visibility; verification is not tight enough or trusted enough to catch bad UI edits before you review them.`,
      evidence: [
        `UI files edited ${totalEdits} total times: ${topFiles.join(", ")}`,
        ...(buildCmds.length > 0 ? [`Build/verify commands run ${buildCmds.length}x`] : []),
      ],
      severity,
      agentGap: "Verification exists, but it is not wired tightly enough into the default edit -> verify -> fix loop",
    };
  }

  return {
    name: "Blind UI Iteration",
    humanRole: "You are the agent's eyes",
    description: `The agent edits UI files blind — it can't see the rendered result. You manually ${buildCmds.length > 0 ? "build and " : ""}check the output, describe what's wrong, and the agent tries again. This loop repeated ${totalEdits} times across ${topFiles.join(", ")}.`,
    evidence: [
      `UI files edited ${totalEdits} total times: ${topFiles.join(", ")}`,
      ...(buildCmds.length > 0 ? [`Build/verify commands run ${buildCmds.length}x`] : []),
    ],
    severity,
    agentGap: "Agent cannot verify visual output of its changes",
  };
}

function detectLocalhostPortJuggling(
  project: ProjectScan,
): WorkflowLoop | null {
  const localPreviewPattern =
    /\b(localhost|127\.0\.0\.1|next dev|vite|vercel dev|vc dev|npm run dev|pnpm dev|yarn dev|bun run dev|open https?:\/\/(?:localhost|127\.0\.0\.1)|curl .*localhost)\b/i;
  const cleanupPattern =
    /\b(lsof\s+-i|pkill|killall|kill\s+-9|fuser)\b.*(?:\d{2,5}|node|vite|next)/i;
  const conflictPattern =
    /\b(EADDRINUSE|address already in use|port \d{2,5}.*in use)\b/i;

  const localCommands = project.bashCommands.filter((cmd) => localPreviewPattern.test(cmd));
  const cleanupCommands = project.bashCommands.filter((cmd) => cleanupPattern.test(cmd));
  const conflictErrors = project.rawToolUses
    .filter((tool) => tool.isError && tool.errorMessage && conflictPattern.test(tool.errorMessage))
    .map((tool) => tool.errorMessage as string);

  const ports = new Set<string>();
  for (const text of [...localCommands, ...cleanupCommands, ...conflictErrors]) {
    for (const match of text.matchAll(/(?:localhost|127\.0\.0\.1):(\d{2,5})/gi)) {
      if (match[1]) ports.add(match[1]);
    }
    for (const match of text.matchAll(/(?:-i\s*:|\bport\s+)(\d{2,5})\b/gi)) {
      if (match[1]) ports.add(match[1]);
    }
  }

  const totalTouches = localCommands.length + cleanupCommands.length + conflictErrors.length;
  if (totalTouches < 5 && ports.size < 3 && conflictErrors.length === 0) {
    return null;
  }

  const severity =
    conflictErrors.length > 0 || ports.size >= 5 || totalTouches >= 12
      ? "high"
      : ports.size >= 3 || totalTouches >= 8
        ? "med"
        : "low";

  const topCommands = [...localCommands, ...cleanupCommands]
    .slice(0, 3)
    .map((cmd) => cmd.length > 90 ? cmd.substring(0, 87) + "..." : cmd);

  return {
    name: "Localhost Port Juggling",
    humanRole: "You are the agent's port janitor",
    description: `You repeatedly boot local servers, chase ephemeral localhost URLs, and clean up stale processes by hand. This project touched ${totalTouches} local-preview commands across ${ports.size > 0 ? `${ports.size} ports (${[...ports].slice(0, 5).join(", ")})` : "multiple previews"}${cleanupCommands.length > 0 ? ` with ${cleanupCommands.length} cleanup commands` : ""}.`,
    evidence: [
      ...(topCommands.length > 0 ? topCommands : []),
      ...(conflictErrors.slice(0, 2).map((err) =>
        err.length > 90 ? err.substring(0, 87) + "..." : err
      )),
    ],
    severity,
    agentGap: "Local preview URLs are ephemeral and process / port management is still manual",
  };
}

function detectManualBuildVerification(
  project: ProjectScan,
  signals: WorkflowSignal[],
): WorkflowLoop | null {
  // Pattern: same build/typecheck/test command run many times
  const buildPatterns = /\b(xcodebuild|npm run build|npm run typecheck|npm test|cargo build|go build|tsc|swift build|xcodegen)\b/i;

  const buildCmds = new Map<string, number>();
  for (const cmd of project.bashCommands) {
    if (buildPatterns.test(cmd)) {
      const prefix = cmd.split(/\s+/).slice(0, 4).join(" ");
      buildCmds.set(prefix, (buildCmds.get(prefix) || 0) + 1);
    }
  }

  if (buildCmds.size === 0) return null;

  const totalRuns = [...buildCmds.values()].reduce((s, n) => s + n, 0);
  if (totalRuns < 5) return null;

  const topCmds = [...buildCmds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const severity = totalRuns > 20 ? "high" : totalRuns > 10 ? "med" : "low";

  return {
    name: "Manual Build Verification",
    humanRole: "You are the agent's compiler check",
    description: `After each code change, you manually run build/typecheck commands because the agent doesn't verify its code compiles. ${topCmds.map(([c, n]) => `"${c}" run ${n}x`).join(", ")}.`,
    evidence: topCmds.map(([c, n]) => `"${c}" run ${n} times`),
    severity,
    agentGap: "Agent doesn't automatically verify code compiles after edits",
  };
}

function detectManualAPITesting(
  project: ProjectScan,
): WorkflowLoop | null {
  // Pattern: repeated curl/httpie commands
  const apiCmds = project.bashCommands.filter((c) =>
    /\b(curl\s|httpie|wget\s.*api|fetch.*api)\b/i.test(c)
  );

  if (apiCmds.length < 3) return null;

  // Extract unique API patterns
  const patterns = new Set<string>();
  for (const cmd of apiCmds) {
    const urlMatch = cmd.match(/https?:\/\/[^\s"']+/);
    if (urlMatch) {
      const url = urlMatch[0].replace(/\/[a-f0-9-]{20,}/, "/:id");
      patterns.add(url.substring(0, 80));
    } else {
      patterns.add(cmd.substring(0, 60));
    }
  }

  const severity = apiCmds.length > 10 ? "high" : apiCmds.length > 5 ? "med" : "low";

  return {
    name: "Manual API Testing",
    humanRole: "You are the agent's API tester",
    description: `You manually run ${apiCmds.length} curl/API commands because the agent can't access the API directly to verify its changes.`,
    evidence: [
      `${apiCmds.length} manual API calls`,
      ...[...patterns].slice(0, 3),
    ],
    severity,
    agentGap: "Agent cannot make HTTP requests to verify API behavior",
  };
}

function detectEnvironmentJuggling(
  project: ProjectScan,
): WorkflowLoop | null {
  // Pattern: repeated env/export commands, switching between dev/prod
  const envCmds = project.bashCommands.filter((c) =>
    /\b(export\s|env\s|\.env|source\s|PAPERCLIP|API_KEY|DATABASE_URL|SUPABASE)\b/i.test(c)
  );

  if (envCmds.length < 3) return null;

  const severity = envCmds.length > 10 ? "high" : envCmds.length > 5 ? "med" : "low";

  return {
    name: "Environment Juggling",
    humanRole: "You are the agent's environment manager",
    description: `You manually manage environment variables and API keys (${envCmds.length} env-related commands). The agent can't switch between environments or manage secrets.`,
    evidence: envCmds.slice(0, 3).map((c) => c.substring(0, 80)),
    severity,
    agentGap: "Agent cannot manage environment configurations or secrets",
  };
}

function detectAgentDirectionFailure(
  project: ProjectScan,
  signals: WorkflowSignal[],
): WorkflowLoop | null {
  // Pattern: high interruptions + corrections = agent going wrong way
  const interrupts = signals.find((s) => s.type === "interrupted");
  const corrections = signals.find((s) => s.type === "correction");
  const frustrations = signals.find((s) => s.type === "frustration");

  const interruptCount = interrupts?.count || 0;
  const correctionCount = corrections?.count || 0;

  if (interruptCount < 5 && correctionCount < 3) return null;

  const totalMisdirections = interruptCount + correctionCount;
  const severity = totalMisdirections > 20 ? "critical" : totalMisdirections > 10 ? "high" : "med";

  const evidence: string[] = [];
  if (interruptCount > 0) evidence.push(`${interruptCount} interruptions (Escape pressed)`);
  if (correctionCount > 0) evidence.push(`${correctionCount} explicit corrections`);
  if (frustrations) {
    const quotes = frustrations.evidence.split(" | ").slice(0, 2);
    for (const q of quotes) {
      evidence.push(`"${q.substring(0, 100)}"`);
    }
  }

  return {
    name: "Agent Direction Failure",
    humanRole: "You are the agent's steering wheel",
    description: `The agent frequently goes down the wrong path, requiring you to interrupt (${interruptCount}x) and correct it (${correctionCount}x). You spend significant time redirecting instead of building.`,
    evidence,
    severity,
    agentGap: "Agent misunderstands intent or lacks context to stay on track",
  };
}

function detectManualGitWorkflow(
  project: ProjectScan,
): WorkflowLoop | null {
  const gitCmds = project.bashCommands.filter((c) =>
    /\bgit\s+(status|add|commit|push|pull|checkout|branch|log|diff|stash|merge|rebase)\b/i.test(c)
  );

  if (gitCmds.length < 5) return null;

  // Count unique git operations
  const ops = new Map<string, number>();
  for (const cmd of gitCmds) {
    const match = cmd.match(/\bgit\s+(\w+)/i);
    if (match) ops.set(match[1], (ops.get(match[1]) || 0) + 1);
  }

  const topOps = [...ops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const severity = gitCmds.length > 20 ? "med" : "low";

  return {
    name: "Manual Git Workflow",
    humanRole: "You manage version control manually",
    description: `${gitCmds.length} manual git commands: ${topOps.map(([op, n]) => `${op} (${n}x)`).join(", ")}. These could be automated into the agent's workflow.`,
    evidence: topOps.map(([op, n]) => `git ${op}: ${n}x`),
    severity,
    agentGap: "Git operations could be part of the agent's workflow",
  };
}

// ── Project Diagnosis Builder ──

function diagnoseProject(
  project: ProjectScan,
  signals: WorkflowSignal[],
  installedTools: InstalledTool[],
): ProjectDiagnosis {
  const workflow = identifyWorkflow(project, signals);

  // Detect all workflow loops
  const loops: WorkflowLoop[] = [];
  const blindUiLoop = detectBlindUIIteration(project, signals, installedTools);
  if (blindUiLoop) loops.push(blindUiLoop);

  const buildLoop = detectManualBuildVerification(project, signals);
  if (buildLoop) loops.push(buildLoop);

  const apiLoop = detectManualAPITesting(project);
  if (apiLoop) loops.push(apiLoop);

  const directionLoop = detectAgentDirectionFailure(project, signals);
  if (directionLoop) loops.push(directionLoop);

  const localhostLoop = detectLocalhostPortJuggling(project);
  if (localhostLoop) loops.push(localhostLoop);

  const envLoop = detectEnvironmentJuggling(project);
  if (envLoop) loops.push(envLoop);
  const gitLoop = detectManualGitWorkflow(project);
  if (gitLoop) loops.push(gitLoop);

  // Sort by severity
  const sevOrder = { critical: 4, high: 3, med: 2, low: 1 };
  loops.sort((a, b) => (sevOrder[b.severity] || 0) - (sevOrder[a.severity] || 0));

  // Pain score from loops
  const painScore = Math.min(
    loops.reduce((sum, l) => sum + (sevOrder[l.severity] || 0) * 10, 0),
    100
  );

  // Top commands
  const cmdCounts = new Map<string, number>();
  for (const cmd of project.bashCommands) {
    const prefix = cmd.split(/\s+/).slice(0, 3).join(" ");
    cmdCounts.set(prefix, (cmdCounts.get(prefix) || 0) + 1);
  }
  const topCommands = [...cmdCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cmd, n]) => `${cmd} (${n}x)`);

  return {
    name: project.projectName,
    sessionCount: project.sessionCount,
    toolCallCount: project.toolCalls.length,
    workflow,
    painScore,
    workflowLoops: loops,
    topCommands,
  };
}

// ── Systemic Issues ──

function identifySystemicIssues(projects: ProjectDiagnosis[]): string[] {
  const issues: string[] = [];

  // Count loop types across projects
  const loopCounts = new Map<string, string[]>();
  for (const p of projects) {
    for (const l of p.workflowLoops) {
      const existing = loopCounts.get(l.name) || [];
      existing.push(p.name);
      loopCounts.set(l.name, existing);
    }
  }

  for (const [loopName, projectNames] of loopCounts) {
    if (projectNames.length >= 2) {
      const loop = projects
        .flatMap((p) => p.workflowLoops)
        .find((l) => l.name === loopName);
      if (loop) {
        issues.push(
          `"${loop.humanRole}" across ${projectNames.length} projects (${projectNames.join(", ")}): ${loop.agentGap}`
        );
      }
    }
  }

  return issues;
}

// ── Ranked Problems ──

function rankProblems(projects: ProjectDiagnosis[]): RankedProblem[] {
  // Group all loops by type
  const groupedLoops = new Map<string, { loop: WorkflowLoop; projects: string[] }>();

  for (const p of projects) {
    for (const l of p.workflowLoops) {
      const existing = groupedLoops.get(l.name);
      if (existing) {
        existing.projects.push(p.name);
        // Keep the most severe version
        const sevOrder = { critical: 4, high: 3, med: 2, low: 1 };
        if ((sevOrder[l.severity] || 0) > (sevOrder[existing.loop.severity] || 0)) {
          existing.loop = l;
        }
      } else {
        groupedLoops.set(l.name, { loop: l, projects: [p.name] });
      }
    }
  }

  const sevOrder = { critical: 4, high: 3, med: 2, low: 1 };

  const ranked = [...groupedLoops.entries()]
    .map(([name, { loop, projects: projs }]) => ({
      name,
      loop,
      projects: [...new Set(projs)],
      score: (sevOrder[loop.severity] || 0) * projs.length,
    }))
    .sort((a, b) => b.score - a.score)
    .map((g, i) => ({
      rank: i + 1,
      title: `${g.loop.humanRole} — ${g.name}`,
      description: g.loop.description,
      projects: g.projects,
      evidence: g.loop.evidence,
      severity: g.loop.severity,
      ifFixed: `Gap: ${g.loop.agentGap}`,
    }));

  return ranked;
}

// ── Main Diagnosis ──

export function computeDiagnosis(
  scanResult: ScanResult,
  signals: WorkflowSignal[],
  installedTools: InstalledTool[] = [],
): Diagnosis {
  const techStack = extractTechStack(scanResult);

  // Index signals by project
  const signalsByProject = new Map<string, WorkflowSignal[]>();
  for (const s of signals) {
    const existing = signalsByProject.get(s.project) || [];
    existing.push(s);
    signalsByProject.set(s.project, existing);
  }

  // Diagnose each project
  const projectDiagnoses: ProjectDiagnosis[] = [];
  for (const project of scanResult.projects) {
    const projectSignals = signalsByProject.get(project.projectName) || [];
    if (projectSignals.length === 0 && project.bashCommands.length === 0) continue;

    const diag = diagnoseProject(project, projectSignals, installedTools);
    if (diag.workflowLoops.length > 0) {
      projectDiagnoses.push(diag);
    }
  }

  // Sort by pain score
  projectDiagnoses.sort((a, b) => b.painScore - a.painScore);

  return {
    techStack,
    projects: projectDiagnoses,
    systemicIssues: identifySystemicIssues(projectDiagnoses),
    topProblems: rankProblems(projectDiagnoses),
    llmAnalysis: null,
  };
}

// ── LLM Enhancement ──

export interface LLMDiagnosisResult {
  step1_surface: { project: string; workflow: string; dominantActivities: string }[];
  step2_painPoints: { project: string; pain: string; severity: string }[];
  step3_rootCauses: { pain: string; rootCause: string; explanation: string }[];
  step4_crossProject: string[];
  step5_ranked: {
    rank: number;
    title: string;
    description: string;
    projects: string[];
    severity: string;
    ifFixed: string;
  }[];
  meta?: {
    keptDrafts?: string[];
    rejectedDrafts?: { project: string; draft: string; reason: string }[];
    confidenceNotes?: string[];
  };
}

export interface LLMDiagnosisMeta {
  status: "success" | "timeout" | "error" | "unavailable";
  source: "claude-p";
  durationMs: number;
  timeoutMs: number;
  promptChars: number;
  outputChars: number;
  exitCode?: number | null;
  stderrPreview?: string;
  error?: string;
}

export interface LLMDiagnosisRun {
  result: LLMDiagnosisResult | null;
  meta: LLMDiagnosisMeta;
}

function isClaudeAvailable(): boolean {
  try {
    execSync("which claude", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getClaudeTimeoutMs(): number {
  const parsed = Number(process.env.AGENTSCOUT_CLAUDE_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 1_000) {
    return Math.floor(parsed);
  }
  return 90_000;
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.substring(0, max - 3)}...` : text;
}

function buildInstalledToolSummary(installedTools: InstalledTool[]): string {
  if (installedTools.length === 0) return "None";
  return installedTools
    .map((tool) => `- ${tool.name} (${tool.source}${tool.project ? `, project: ${tool.project}` : ""})`)
    .join("\n");
}

function buildDraftSummary(computedDiagnosis: Diagnosis): string {
  if (computedDiagnosis.topProblems.length === 0) return "None";
  return computedDiagnosis.topProblems
    .slice(0, 7)
    .map((problem) =>
      `- ${problem.title} [${problem.severity}] in ${problem.projects.join(", ")} -> ${truncate(problem.description, 180)}`
    )
    .join("\n");
}

async function runClaudeJsonPrompt(
  prompt: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; timedOut: boolean; durationMs: number; exitCode: number | null }> {
  return await new Promise((resolve, reject) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;
    let timedOut = false;
    const startedAt = Date.now();
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const proc = spawn("claude", ["-p", "--output-format", "json"], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => stdoutChunks.push(data.toString()));
    proc.stderr.on("data", (data: Buffer) => stderrChunks.push(data.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        timedOut,
        durationMs: Date.now() - startedAt,
        exitCode: code,
      });
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export async function enhanceWithLLM(
  scanResult: ScanResult,
  signals: WorkflowSignal[],
  computedDiagnosis: Diagnosis,
  installedTools: InstalledTool[] = [],
): Promise<LLMDiagnosisRun> {
  const timeoutMs = getClaudeTimeoutMs();
  if (!isClaudeAvailable()) {
    console.error("[diagnosis] claude CLI not found");
    return {
      result: null,
      meta: {
        status: "unavailable",
        source: "claude-p",
        durationMs: 0,
        timeoutMs,
        promptChars: 0,
        outputChars: 0,
        exitCode: null,
        error: "claude CLI not found in PATH",
      },
    };
  }

  const signalsByProject = new Map<string, WorkflowSignal[]>();
  for (const s of signals) {
    const existing = signalsByProject.get(s.project) || [];
    existing.push(s);
    signalsByProject.set(s.project, existing);
  }

  const diagnosesByProject = new Map(
    computedDiagnosis.projects.map((projectDiagnosis) => [projectDiagnosis.name, projectDiagnosis])
  );

  const painStories: string[] = [];
  for (const project of scanResult.projects) {
    const hasData = project.bashCommands.length > 0 || project.userMessages.length > 0;
    if (!hasData) continue;

    const projectSignals = signalsByProject.get(project.projectName) || [];
    const draftDiagnosis = diagnosesByProject.get(project.projectName);
    const lines: string[] = [];
    lines.push(`\n[${project.projectName}] (${project.sessionCount} sessions, ${project.toolCalls.length} tool calls)`);

    if (draftDiagnosis?.workflowLoops.length) {
      lines.push("  HEURISTIC DRAFTS (skeptically review: keep / split / rename / reject):");
      for (const loop of draftDiagnosis.workflowLoops.slice(0, 4)) {
        lines.push(`    ? ${loop.name} -> ${loop.humanRole} | Gap: ${truncate(loop.agentGap, 110)}`);
      }
    }

    if (project.assistantHandoffs.length > 0) {
      lines.push(`  HANDOFFS:`);
      for (const h of project.assistantHandoffs.slice(0, 3)) {
        lines.push(`    ! ${truncate(h, 150)}`);
      }
    }

    const yoyos = projectSignals.filter((s) => s.type === "yoyo-file");
    for (const y of yoyos.slice(0, 3)) lines.push(`  YOYO: ${y.description} (${y.count}x)`);

    const retries = projectSignals.filter((s) => s.type === "retry-loop");
    for (const retry of retries.slice(0, 2)) {
      lines.push(`  RETRY LOOP: ${retry.description}`);
      lines.push(`    ${truncate(retry.evidence, 120)}`);
    }

    const corrections = projectSignals.filter((s) => s.type === "correction");
    for (const correction of corrections.slice(0, 2)) {
      lines.push(`  CORRECTION: ${correction.description}`);
      for (const quote of correction.evidence.split(" | ").slice(0, 2)) {
        lines.push(`    USER: "${truncate(quote, 120)}"`);
      }
    }

    const frustration = projectSignals.filter((s) => s.type === "frustration");
    for (const f of frustration) {
      for (const q of f.evidence.split(" | ").slice(0, 3)) {
        lines.push(`  USER: "${truncate(q, 120)}"`);
      }
    }

    const errors = projectSignals.filter((s) => s.type === "tool-error");
    for (const e of errors.slice(0, 2)) lines.push(`  ERROR: ${e.description}: ${truncate(e.evidence, 100)}`);

    const repeated = projectSignals.filter((s) => s.type === "repeated-command");
    for (const r of repeated.slice(0, 3)) lines.push(`  REPEAT: ${r.description}`);

    const portLoops = projectSignals.filter((s) => s.type === "port-juggling");
    for (const portLoop of portLoops.slice(0, 2)) {
      lines.push(`  PORT LOOP: ${portLoop.description}`);
      for (const sample of portLoop.evidence.split(" | ").slice(0, 3)) {
        lines.push(`    ${truncate(sample, 120)}`);
      }
    }

    const interrupts = projectSignals.filter((s) => s.type === "interrupted");
    if (interrupts.length > 0) lines.push(`  INTERRUPTIONS: ${interrupts[0].description}`);

    const buildCmds = project.bashCommands.filter((cmd) =>
      /\b(xcodebuild|xcodegen|swift build|npm run build|npm run typecheck|npx tsc|npm test|pnpm test|cargo build)\b/i.test(cmd)
    );
    if (buildCmds.length > 0) {
      lines.push("  BUILD / CHECK COMMANDS:");
      for (const cmd of buildCmds.slice(0, 3)) {
        lines.push(`    ${truncate(cmd, 120)}`);
      }
    }

    const envCmds = project.bashCommands.filter((cmd) =>
      /\b(export\s|env\s|source\s|\.env|API_KEY|DATABASE_URL|SUPABASE|VERCEL|TOKEN)\b/i.test(cmd)
    );
    if (envCmds.length > 0) {
      lines.push("  ENV / SECRET COMMANDS:");
      for (const cmd of envCmds.slice(0, 3)) {
        lines.push(`    ${truncate(cmd, 120)}`);
      }
    }

    if (project.bashCommands.length > 0) {
      const cmdPrefixes = new Map<string, number>();
      for (const cmd of project.bashCommands) {
        const prefix = cmd.split(/\s+/).slice(0, 3).join(" ");
        cmdPrefixes.set(prefix, (cmdPrefixes.get(prefix) || 0) + 1);
      }
      const topCmds = [...cmdPrefixes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      lines.push(`  Top commands: ${topCmds.map(([c, n]) => `${c} (${n}x)`).join(", ")}`);
    }

    if (lines.length > 1) painStories.push(lines.join("\n"));
  }

  const prompt = `You are an adversarial workflow diagnostician. Analyze this developer's Claude Code sessions and explain the hidden workflow contracts the human still fulfills manually.

DO NOT recommend tools. This is PURELY a diagnosis of what's broken and why.

IMPORTANT: The heuristic diagnosis below is a draft, not truth. Your job is to challenge it.
- Keep, split, rename, merge, or reject draft diagnoses when the evidence demands it.
- Do not simply restate detector labels.
- Prefer diagnoses about failed workflow contracts and bad assumptions.
- If verification tooling already exists, do NOT say "the agent can't see the UI" unless you explain why existing verification is insufficient or not trusted.
- Treat localhost / dev-server / port churn as a first-class workflow failure when supported by evidence.
- Distinguish correctness verification from interaction / motion / feel judgment.
- Prefer specific diagnoses over generic "manual git" or "environment juggling" when stronger evidence exists.
- Every pain point must cite concrete evidence: commands, files, ports, error text, or user quotes.

YOUR JOB: Identify the human's ROLE in each project and the assumption the agent is getting wrong.

INSTALLED TOOLS:
${buildInstalledToolSummary(installedTools)}

HEURISTIC TOP PROBLEMS TO CHALLENGE:
${buildDraftSummary(computedDiagnosis)}

DATA from ${scanResult.totalProjects} projects, ${scanResult.totalSessions} sessions:
${painStories.join("\n")}

Tech stack: ${computedDiagnosis.techStack.join(", ")}

Perform analysis in 5 steps:

STEP 1 — SURFACE: What is each project? What does the developer do there?
STEP 2 — PAIN POINTS: What specific manual work is the human doing? Quote actual files, commands, user words.
STEP 3 — ROOT CAUSES: For each pain, identify the real blocker. Use only these categories: "missing-contract", "weak-verification", "existing-tool-mismatch", "quality-judgment", "missing-context", "wrong-direction", "manual-bottleneck", "tool-limitation"
STEP 4 — CROSS-PROJECT: What patterns repeat across projects? Name systemic workflow failures, not generic busywork.
STEP 5 — RANKED PROBLEMS: Top 7 by impact. Rank by how much human judgment or coordination is still required, not just raw frequency. For each: "If this were fixed: [specific impact]"

RESPOND WITH ONLY JSON (no markdown):
{
  "step1_surface": [{"project":"name","workflow":"type","dominantActivities":"what they actually do"}],
  "step2_painPoints": [{"project":"name","pain":"description with actual quotes/files/commands","severity":"low|med|high|critical"}],
  "step3_rootCauses": [{"pain":"ref","rootCause":"category","explanation":"why"}],
  "step4_crossProject": ["pattern"],
  "step5_ranked": [{"rank":1,"title":"short specific diagnosis","description":"detailed with evidence","projects":["p1"],"severity":"low|med|high|critical","ifFixed":"If this were fixed: impact"}],
  "meta": {
    "keptDrafts": ["draft titles you agree with"],
    "rejectedDrafts": [{"project":"name","draft":"draft title","reason":"why it was weak or wrong"}],
    "confidenceNotes": ["short notes about ambiguity, existing tools, or evidence limits"]
  }
}`;

  console.error(`[diagnosis] LLM prompt: ${prompt.length} chars`);

  try {
    const run = await runClaudeJsonPrompt(prompt, timeoutMs);
    console.error(
      `[diagnosis] claude exited code=${run.exitCode}, timedOut=${run.timedOut}, stdout=${run.stdout.length} chars, stderr=${run.stderr.length} chars`
    );

    let content: string;
    try {
      const response = JSON.parse(run.stdout);
      content = response.result || response.content || run.stdout;
      if (typeof content !== "string") content = JSON.stringify(content);
    } catch {
      content = run.stdout;
    }

    const jsonMatch = content.match(/\{[\s\S]*"step1_surface"[\s\S]*"step5_ranked"[\s\S]*\}/);
    if (!jsonMatch) {
      const error = run.timedOut
        ? `Claude CLI timed out after ${timeoutMs}ms`
        : truncate(run.stderr || "Claude CLI returned no parseable JSON", 180);
      console.error(`[diagnosis] No valid JSON: ${error}`);
      return {
        result: null,
        meta: {
          status: run.timedOut ? "timeout" : "error",
          source: "claude-p",
          durationMs: run.durationMs,
          timeoutMs,
          promptChars: prompt.length,
          outputChars: run.stdout.length,
          exitCode: run.exitCode,
          stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
          error,
        },
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as LLMDiagnosisResult;
    if (!Array.isArray(parsed.step5_ranked)) {
      return {
        result: null,
        meta: {
          status: "error",
          source: "claude-p",
          durationMs: run.durationMs,
          timeoutMs,
          promptChars: prompt.length,
          outputChars: run.stdout.length,
          exitCode: run.exitCode,
          stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
          error: "Claude CLI returned JSON without step5_ranked",
        },
      };
    }

    return {
      result: parsed,
      meta: {
        status: "success",
        source: "claude-p",
        durationMs: run.durationMs,
        timeoutMs,
        promptChars: prompt.length,
        outputChars: run.stdout.length,
        exitCode: run.exitCode,
        stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[diagnosis] LLM error: ${message}`);
    return {
      result: null,
      meta: {
        status: "error",
        source: "claude-p",
        durationMs: 0,
        timeoutMs,
        promptChars: prompt.length,
        outputChars: 0,
        exitCode: null,
        error: truncate(message, 180),
      },
    };
  }
}
