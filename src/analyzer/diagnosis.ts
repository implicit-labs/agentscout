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
import { fileURLToPath } from "node:url";
import type { ScanResult, ProjectScan } from "../scanner/sessions.js";
import type { InstalledTool } from "../scanner/installed.js";
import type { WorkflowSignal } from "../scanner/signals.js";
import { detectImplicitSignals, summarizeImplicitSignals } from "../scanner/implicit.js";
import type { ImplicitSignal, ImplicitSignalSummary } from "../scanner/implicit.js";

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
  lastActive: string;  // ISO date of most recent session
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

  // Most recent activity date — prefer session index, fall back to tool call timestamps
  let lastActive = new Date(0).toISOString();
  if (project.sessions.length > 0) {
    lastActive = project.sessions.reduce((latest, s) =>
      s.modified > latest ? s.modified : latest, project.sessions[0].modified);
  } else if (project.toolCalls.length > 0) {
    lastActive = project.toolCalls.reduce((latest, t) =>
      t.timestamp > latest ? t.timestamp : latest, project.toolCalls[0].timestamp);
  }

  return {
    name: project.projectName,
    sessionCount: project.sessionCount,
    toolCallCount: project.toolCalls.length,
    workflow,
    painScore,
    lastActive,
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

  // Sort by recency (most recently active first)
  projectDiagnoses.sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  return {
    techStack,
    projects: projectDiagnoses,
    systemicIssues: identifySystemicIssues(projectDiagnoses),
    topProblems: rankProblems(projectDiagnoses),
    llmAnalysis: null,
  };
}

// ── LLM Enhancement ──

type RootCauseCategory =
  | "missing-contract"
  | "weak-verification"
  | "existing-tool-mismatch"
  | "quality-judgment"
  | "missing-context"
  | "wrong-direction"
  | "manual-bottleneck"
  | "tool-limitation";

type LLMSource = "claude-sdk" | "claude-p";

const SEVERITY_VALUES = ["low", "med", "high", "critical"] as const;
const FIXABILITY_VALUES = ["low", "med", "high"] as const;
const ROOT_CAUSE_VALUES = [
  "missing-contract",
  "weak-verification",
  "existing-tool-mismatch",
  "quality-judgment",
  "missing-context",
  "wrong-direction",
  "manual-bottleneck",
  "tool-limitation",
] as const;

const PROJECT_DIAGNOSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "project",
    "engineerPerspective",
    "fixableInteractions",
    "nonFixableJudgment",
    "commodityToIgnore",
    "confidenceNotes",
  ],
  properties: {
    project: { type: "string" },
    engineerPerspective: { type: "string" },
    fixableInteractions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "interactionSurface",
          "humanRole",
          "description",
          "severity",
          "minimalPermission",
          "observableSuccess",
          "whyNotJustJudgment",
          "evidence",
        ],
        properties: {
          title: { type: "string" },
          interactionSurface: { type: "string" },
          humanRole: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: [...SEVERITY_VALUES] },
          minimalPermission: { type: "string" },
          observableSuccess: { type: "string" },
          whyNotJustJudgment: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    nonFixableJudgment: { type: "array", items: { type: "string" } },
    commodityToIgnore: { type: "array", items: { type: "string" } },
    confidenceNotes: { type: "array", items: { type: "string" } },
  },
} as const;

const SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "step1_surface",
    "step2_fixableInteractions",
    "step3_systemicGaps",
    "step4_crossProject",
    "step5_ranked",
    "meta",
  ],
  properties: {
    step1_surface: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["project", "workflow", "dominantActivities", "engineerPerspective"],
        properties: {
          project: { type: "string" },
          workflow: { type: "string" },
          dominantActivities: { type: "string" },
          engineerPerspective: { type: "string" },
        },
      },
    },
    step2_fixableInteractions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "project",
          "title",
          "interactionSurface",
          "humanRole",
          "description",
          "severity",
          "fixability",
          "rootCause",
          "brokenContract",
          "minimalPermission",
          "observableSuccess",
          "toolArchetype",
          "whyNotJustJudgment",
        ],
        properties: {
          project: { type: "string" },
          title: { type: "string" },
          interactionSurface: { type: "string" },
          humanRole: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: [...SEVERITY_VALUES] },
          fixability: { type: "string", enum: [...FIXABILITY_VALUES] },
          rootCause: { type: "string", enum: [...ROOT_CAUSE_VALUES] },
          brokenContract: { type: "string" },
          minimalPermission: { type: "string" },
          observableSuccess: { type: "string" },
          toolArchetype: { type: "string" },
          whyNotJustJudgment: { type: "string" },
        },
      },
    },
    step3_systemicGaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "pattern",
          "brokenContract",
          "whyExistingToolsFailed",
          "minimalPermission",
          "toolArchetype",
          "whyThisIsFixable",
          "projects",
          "severity",
        ],
        properties: {
          title: { type: "string" },
          pattern: { type: "string" },
          brokenContract: { type: "string" },
          whyExistingToolsFailed: { type: "string" },
          minimalPermission: { type: "string" },
          toolArchetype: { type: "string" },
          whyThisIsFixable: { type: "string" },
          projects: { type: "array", items: { type: "string" } },
          severity: { type: "string", enum: [...SEVERITY_VALUES] },
        },
      },
    },
    step4_crossProject: { type: "array", items: { type: "string" } },
    step5_ranked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "rank",
          "title",
          "description",
          "projects",
          "severity",
          "toolArchetype",
          "minimalPermission",
          "ifFixed",
        ],
        properties: {
          rank: { type: "number" },
          title: { type: "string" },
          description: { type: "string" },
          projects: { type: "array", items: { type: "string" } },
          severity: { type: "string", enum: [...SEVERITY_VALUES] },
          toolArchetype: { type: "string" },
          minimalPermission: { type: "string" },
          ifFixed: { type: "string" },
        },
      },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: [
        "projectAnalysesUsed",
        "failedProjects",
        "commodityToIgnore",
        "judgmentBoundaries",
        "confidenceNotes",
      ],
      properties: {
        projectAnalysesUsed: { type: "array", items: { type: "string" } },
        failedProjects: { type: "array", items: { type: "string" } },
        commodityToIgnore: { type: "array", items: { type: "string" } },
        judgmentBoundaries: { type: "array", items: { type: "string" } },
        confidenceNotes: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export interface LLMProjectDiagnosis {
  project: string;
  workflow: string;
  dominantActivities: string;
  engineerPerspective: string;
  fixableInteractions: {
    title: string;
    interactionSurface: string;
    humanRole: string;
    description: string;
    severity: string;
    minimalPermission: string;
    observableSuccess: string;
    whyNotJustJudgment: string;
    evidence: string[];
  }[];
  nonFixableJudgment: string[];
  commodityToIgnore: string[];
  confidenceNotes: string[];
}

interface ProjectForensics {
  project: string;
  workflow: string;
  sessions: number;
  toolCalls: number;
  painScore: number;
  relevantInstalledTools: string[];
  dominantCommandFamilies: string[];
  heuristicLoops: {
    name: string;
    humanRole: string;
    severity: WorkflowLoop["severity"];
    agentGap: string;
    evidence: string[];
  }[];
  signalEvidence: {
    yoyoFiles: string[];
    retryLoops: string[];
    corrections: string[];
    interruptions: string[];
    portChurn: string[];
    toolErrors: string[];
    frustrationQuotes: string[];
  };
  manualWorkEvidence: {
    buildChecks: string[];
    envAndSecrets: string[];
    previewsAndLocalhost: string[];
    git: string[];
    apiChecks: string[];
    assistantHandoffs: string[];
  };
}

export interface LLMDiagnosisResult {
  step1_surface: {
    project: string;
    workflow: string;
    dominantActivities: string;
    engineerPerspective?: string;
  }[];
  step2_fixableInteractions: {
    project: string;
    title: string;
    interactionSurface: string;
    humanRole: string;
    description: string;
    severity: string;
    fixability: string;
    rootCause: string;
    brokenContract: string;
    minimalPermission: string;
    observableSuccess: string;
    toolArchetype: string;
    whyNotJustJudgment: string;
  }[];
  step3_systemicGaps: {
    title: string;
    pattern: string;
    brokenContract: string;
    whyExistingToolsFailed: string;
    minimalPermission: string;
    toolArchetype: string;
    whyThisIsFixable: string;
    projects: string[];
    severity: string;
  }[];
  step4_crossProject: string[];
  step5_ranked: {
    rank: number;
    title: string;
    description: string;
    projects: string[];
    severity: string;
    toolArchetype: string;
    minimalPermission: string;
    ifFixed: string;
  }[];
  meta?: {
    projectAnalysesUsed?: string[];
    failedProjects?: string[];
    commodityToIgnore?: string[];
    judgmentBoundaries?: string[];
    confidenceNotes?: string[];
  };
}

export interface LLMDiagnosisStageMeta {
  name: string;
  status: "success" | "timeout" | "error" | "skipped";
  durationMs: number;
  timeoutMs: number;
  promptChars: number;
  outputChars: number;
  exitCode?: number | null;
  stderrPreview?: string;
  error?: string;
  model?: string;
  resultSubtype?: string | null;
  stopReason?: string | null;
  numTurns?: number | null;
  firstEventMs?: number | null;
  firstAssistantMs?: number | null;
  resultMs?: number | null;
  eventSummary?: string;
  tracePreview?: string;
  assistantPreview?: string;
}

export interface LLMDiagnosisMeta {
  status: "success" | "timeout" | "error" | "unavailable";
  source: LLMSource;
  mode: "multi-pass";
  resultMode: "full" | "project-fallback";
  durationMs: number;
  timeoutMs: number;
  promptChars: number;
  outputChars: number;
  projectCountRequested: number;
  projectCountSucceeded: number;
  selectedProjects: string[];
  stages: LLMDiagnosisStageMeta[];
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

function getPreferredSource(): LLMSource {
  return process.env.AGENTSCOUT_LLM_PROVIDER === "sdk" ? "claude-sdk" : "claude-p";
}

function getClaudeModelForStage(stage: "project" | "synthesis"): string {
  if (stage === "project" && process.env.AGENTSCOUT_CLAUDE_PROJECT_MODEL) {
    return process.env.AGENTSCOUT_CLAUDE_PROJECT_MODEL;
  }
  if (stage === "synthesis" && process.env.AGENTSCOUT_CLAUDE_SYNTH_MODEL) {
    return process.env.AGENTSCOUT_CLAUDE_SYNTH_MODEL;
  }
  if (process.env.AGENTSCOUT_CLAUDE_MODEL) {
    return process.env.AGENTSCOUT_CLAUDE_MODEL;
  }
  return stage === "project" ? "claude-haiku-4-5" : "claude-sonnet-4-6";
}

function getClaudeTimeoutMs(): number {
  const parsed = Number(process.env.AGENTSCOUT_CLAUDE_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 1_000) {
    return Math.floor(parsed);
  }
  return 20_000;
}

function getStageTimeoutMs(stage: "project" | "synthesis"): number {
  const specific = Number(
    process.env[
    stage === "project"
      ? "AGENTSCOUT_CLAUDE_PROJECT_TIMEOUT_MS"
      : "AGENTSCOUT_CLAUDE_SYNTH_TIMEOUT_MS"
    ]
  );
  if (Number.isFinite(specific) && specific >= 1_000) {
    return Math.floor(specific);
  }

  const shared = Number(process.env.AGENTSCOUT_CLAUDE_TIMEOUT_MS);
  if (Number.isFinite(shared) && shared >= 1_000) {
    return Math.floor(shared);
  }

  return stage === "project" ? 30_000 : 45_000;
}

function getProjectLimit(totalProjects: number): number {
  const parsed = Number(process.env.AGENTSCOUT_LLM_PROJECT_LIMIT);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(totalProjects, Math.floor(parsed));
  }
  return Math.min(totalProjects, 5);
}

function getAbortAfterFailures(): number {
  const parsed = Number(process.env.AGENTSCOUT_LLM_ABORT_AFTER_FAILURES);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.floor(parsed);
  }
  return 3;
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.substring(0, max - 3)}...` : text;
}

function uniqueNonEmpty(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function severityScore(severity: string): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "med":
      return 2;
    default:
      return 1;
  }
}

function fixabilityScore(fixability: string): number {
  switch (fixability) {
    case "high":
      return 3;
    case "med":
      return 2;
    default:
      return 1;
  }
}

function normalizeInteractionText(...parts: Array<string | string[] | undefined>): string {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function inferRootCauseFromInteraction(interaction: LLMProjectDiagnosis["fixableInteractions"][number]): RootCauseCategory {
  const text = normalizeInteractionText(
    interaction.title,
    interaction.interactionSurface,
    interaction.description,
    interaction.minimalPermission,
    interaction.observableSuccess,
    interaction.whyNotJustJudgment,
    interaction.evidence,
  );

  if (/\b(verify|verification|build|typecheck|test|compile|screenshot|simulator|preview)\b/.test(text)) {
    return "weak-verification";
  }
  if (/\b(direction|redirect|interrupt|clarify|intent|context|steering)\b/.test(text)) {
    return "missing-context";
  }
  if (/\b(wrong path|wrong direction|course-correct|redo)\b/.test(text)) {
    return "wrong-direction";
  }
  if (/\b(playwright|simulator|dashboard|existing tool|already have|current tool)\b/.test(text)) {
    return "existing-tool-mismatch";
  }
  if (/\b(feel|timing|taste|polish|animation|gesture)\b/.test(text)) {
    return "quality-judgment";
  }
  if (/\b(port|localhost|preview url|runtime|environment|secret|dashboard|deploy|control plane|database)\b/.test(text)) {
    return "missing-contract";
  }
  if (/\b(manual|copy|sync|reconcile|handoff)\b/.test(text)) {
    return "manual-bottleneck";
  }
  return "missing-contract";
}

function inferFixabilityFromInteraction(interaction: LLMProjectDiagnosis["fixableInteractions"][number]): string {
  const text = normalizeInteractionText(
    interaction.interactionSurface,
    interaction.minimalPermission,
    interaction.observableSuccess,
    interaction.whyNotJustJudgment,
  );

  if (/\b(browser|simulator|dashboard|api token|connection string|port|localhost|dev server|filesystem|git status|build|typecheck)\b/.test(text)) {
    return "high";
  }
  if (/\b(animation|feel|polish|taste|direction)\b/.test(text)) {
    return "low";
  }
  return "med";
}

function inferToolArchetypeFromInteraction(interaction: LLMProjectDiagnosis["fixableInteractions"][number]): string {
  const text = normalizeInteractionText(
    interaction.title,
    interaction.interactionSurface,
    interaction.description,
    interaction.minimalPermission,
    interaction.observableSuccess,
    interaction.evidence,
  );

  if (/\b(port|localhost|preview|dev server|process)\b/.test(text)) {
    return "local runtime router";
  }
  if (/\b(dashboard|vercel|supabase|deploy|service state|control plane|admin)\b/.test(text)) {
    return "service control-plane client";
  }
  if (/\b(build|typecheck|compile|test|simulator|screenshot|verify|playwright)\b/.test(text)) {
    return "verification runner";
  }
  if (/\b(secret|env|token|api key|environment)\b/.test(text)) {
    return "environment and secrets bridge";
  }
  if (/\b(git|branch|commit|status|diff|push)\b/.test(text)) {
    return "version-control orchestrator";
  }
  if (/\b(sql|schema|database|migration)\b/.test(text)) {
    return "database control-plane client";
  }
  return "bounded agent integration";
}

function inferBrokenContractFromInteraction(interaction: LLMProjectDiagnosis["fixableInteractions"][number]): string {
  const text = normalizeInteractionText(
    interaction.title,
    interaction.interactionSurface,
    interaction.description,
    interaction.minimalPermission,
    interaction.evidence,
  );

  if (/\b(port|localhost|preview|dev server|process)\b/.test(text)) {
    return "Local runtime identity and preview routing are not encoded as a stable interface.";
  }
  if (/\b(secret|env|token|api key|environment)\b/.test(text)) {
    return "Environment selection and secret access are not delegated through a bounded interface.";
  }
  if (/\b(dashboard|deploy|service state|control plane|admin)\b/.test(text)) {
    return "Service state changes still require a human-operated control plane.";
  }
  if (/\b(build|typecheck|compile|test|verify|screenshot|simulator)\b/.test(text)) {
    return "Verification is not encoded as a trusted machine gate in the default loop.";
  }
  if (/\b(git|branch|commit|status|diff|push)\b/.test(text)) {
    return "Repository state transitions still depend on manual orchestration.";
  }
  if (/\b(direction|intent|context|redirect|interrupt)\b/.test(text)) {
    return "Intent is not compiled into a stable execution contract the agent can follow.";
  }
  return "The human is still the only runtime bridging this workflow boundary.";
}

function inferWhyExistingToolsFailedFromInteraction(interaction: LLMProjectDiagnosis["fixableInteractions"][number]): string {
  const text = normalizeInteractionText(
    interaction.description,
    interaction.whyNotJustJudgment,
    interaction.evidence,
  );

  if (/\b(already have|playwright|simulator|screenshot|tooling exists)\b/.test(text)) {
    return "Existing tools expose visibility, but they are not wired into a trusted default handoff loop.";
  }
  if (/\b(dashboard|service|deploy|env|secret)\b/.test(text)) {
    return "Current tooling exposes state, but not a narrow agent-owned interface for mutating it safely.";
  }
  if (/\b(port|localhost|preview|dev server)\b/.test(text)) {
    return "Current dev tooling creates ephemeral runtime state, but does not give the agent a stable runtime handle.";
  }
  return "Current tools reduce friction but do not remove the human-owned contract in this loop.";
}

function inferIfFixedFromInteraction(interaction: LLMProjectDiagnosis["fixableInteractions"][number]): string {
  const text = normalizeInteractionText(
    interaction.interactionSurface,
    interaction.observableSuccess,
    interaction.description,
  );

  if (/\b(port|localhost|preview|dev server)\b/.test(text)) {
    return "The agent could own local previews without hand-managed ports, URLs, or process cleanup.";
  }
  if (/\b(dashboard|service|deploy|control plane)\b/.test(text)) {
    return "The agent could operate the service state directly instead of handing work back to you.";
  }
  if (/\b(build|typecheck|compile|test|verify|screenshot|simulator)\b/.test(text)) {
    return "The edit-to-verify loop would tighten and stop requiring a human verification hop.";
  }
  if (/\b(secret|env|token|environment)\b/.test(text)) {
    return "Environment switching and secret-dependent tasks would stop blocking delegation.";
  }
  if (/\b(git|branch|commit|status|diff|push)\b/.test(text)) {
    return "Repository operations could become part of the default agent workflow instead of a manual checkpoint.";
  }
  return "The human would stop acting as the default bridge for this interaction surface.";
}

function buildSignalsByProject(signals: WorkflowSignal[]): Map<string, WorkflowSignal[]> {
  const signalsByProject = new Map<string, WorkflowSignal[]>();
  for (const signal of signals) {
    const existing = signalsByProject.get(signal.project) || [];
    existing.push(signal);
    signalsByProject.set(signal.project, existing);
  }
  return signalsByProject;
}

function pickRelevantInstalledTools(
  projectDiagnosis: ProjectDiagnosis,
  installedTools: InstalledTool[],
): string[] {
  const workflow = projectDiagnosis.workflow.toLowerCase();
  const projectSpecific = installedTools
    .filter((tool) => tool.project?.toLowerCase() === projectDiagnosis.name.toLowerCase())
    .map((tool) => tool.name);

  const relevant = installedTools
    .filter((tool) => {
      const name = tool.name.toLowerCase();
      if (workflow.includes("ios")) return /(ios|xcode|swift)/.test(name);
      if (workflow.includes("web") || workflow.includes("landing")) return /(playwright|browser|vercel)/.test(name);
      if (workflow.includes("api") || workflow.includes("backend")) return /(supabase|postgres|sqlite|vercel)/.test(name);
      return /(playwright|ios|xcode|supabase|vercel)/.test(name);
    })
    .map((tool) => tool.name);

  return uniqueNonEmpty([...projectSpecific, ...relevant]).slice(0, 6);
}

function topSignalDescriptions(
  projectSignals: WorkflowSignal[],
  type: WorkflowSignal["type"],
  limit = 3,
): string[] {
  return projectSignals
    .filter((signal) => signal.type === type)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((signal) => signal.description);
}

function topFrustrationQuotes(projectSignals: WorkflowSignal[]): string[] {
  const quotes: string[] = [];
  for (const signal of projectSignals.filter((entry) => entry.type === "frustration")) {
    for (const quote of signal.evidence.split(" | ").slice(0, 3)) {
      if (quote.trim()) quotes.push(`"${truncate(quote, 110)}"`);
    }
  }
  return uniqueNonEmpty(quotes).slice(0, 3);
}

function summarizeCommands(project: ProjectScan, pattern: RegExp, limit = 3): string[] {
  return uniqueNonEmpty(
    project.bashCommands
      .filter((cmd) => pattern.test(cmd))
      .slice(0, limit)
      .map((cmd) => truncate(cmd, 100))
  );
}

function buildProjectForensics(
  project: ProjectScan,
  projectDiagnosis: ProjectDiagnosis,
  projectSignals: WorkflowSignal[],
  installedTools: InstalledTool[],
): ProjectForensics {
  const relevantTools = pickRelevantInstalledTools(projectDiagnosis, installedTools);
  const buildChecks = summarizeCommands(
    project,
    /\b(xcodebuild|xcodegen|swift build|npm run build|npm run typecheck|npx tsc|npm test|pnpm test|cargo build)\b/i
  );
  const envAndSecrets = summarizeCommands(
    project,
    /\b(export\s|env\s|source\s|\.env|API_KEY|DATABASE_URL|SUPABASE|VERCEL|TOKEN)\b/i
  );
  const previewsAndLocalhost = summarizeCommands(
    project,
    /\b(localhost|127\.0\.0\.1|npm run dev|pnpm dev|vite|next dev|vercel dev|open https?:\/\/(?:localhost|127\.0\.0\.1))\b/i
  );
  const apiChecks = summarizeCommands(
    project,
    /\b(curl\s|httpie|wget\s.*api|fetch.*api)\b/i
  );
  const git = summarizeCommands(
    project,
    /\bgit\s+(status|add|commit|push|pull|checkout|branch|log|diff|stash|merge|rebase)\b/i
  );
  const assistantHandoffs = uniqueNonEmpty(
    project.assistantHandoffs.map((handoff) => truncate(handoff, 120))
  ).slice(0, 2);

  const dominantCommandFamilies = projectDiagnosis.topCommands
    .slice(0, 4)
    .map((entry) => entry.replace(/\s+\(\d+x\)$/, ""));

  return {
    project: projectDiagnosis.name,
    workflow: projectDiagnosis.workflow,
    sessions: project.sessionCount,
    toolCalls: project.toolCalls.length,
    painScore: projectDiagnosis.painScore,
    relevantInstalledTools: relevantTools,
    dominantCommandFamilies,
    heuristicLoops: projectDiagnosis.workflowLoops.slice(0, 4).map((loop) => ({
      name: loop.name,
      humanRole: loop.humanRole,
      severity: loop.severity,
      agentGap: loop.agentGap,
      evidence: loop.evidence.slice(0, 3),
    })),
    signalEvidence: {
      yoyoFiles: topSignalDescriptions(projectSignals, "yoyo-file", 3),
      retryLoops: topSignalDescriptions(projectSignals, "retry-loop", 2),
      corrections: topSignalDescriptions(projectSignals, "correction", 2),
      interruptions: topSignalDescriptions(projectSignals, "interrupted", 1),
      portChurn: topSignalDescriptions(projectSignals, "port-juggling", 2),
      toolErrors: topSignalDescriptions(projectSignals, "tool-error", 2),
      frustrationQuotes: topFrustrationQuotes(projectSignals),
    },
    manualWorkEvidence: {
      buildChecks,
      envAndSecrets,
      previewsAndLocalhost,
      git,
      apiChecks,
      assistantHandoffs,
    },
  };
}

function buildProjectDiagnosisPrompt(forensics: ProjectForensics): string {
  return buildProjectDiagnosisPromptForSource(forensics, "claude-p");
}

function serializeForensicsCompact(forensics: ProjectForensics): string {
  const lines = [
    `project: ${forensics.project}`,
    `workflow: ${forensics.workflow}`,
    `sessions: ${forensics.sessions}`,
    `tool_calls: ${forensics.toolCalls}`,
    `pain_score: ${forensics.painScore}`,
    `installed_tools: ${forensics.relevantInstalledTools.join(", ") || "none"}`,
    `command_families: ${forensics.dominantCommandFamilies.join(", ") || "none"}`,
  ];

  if (forensics.heuristicLoops.length > 0) {
    lines.push("heuristic_loops:");
    for (const loop of forensics.heuristicLoops.slice(0, 3)) {
      lines.push(`- ${loop.severity} | ${loop.humanRole} | ${loop.name}`);
      lines.push(`  gap: ${loop.agentGap}`);
      if (loop.evidence.length > 0) lines.push(`  evidence: ${loop.evidence.join(" ; ")}`);
    }
  }

  const signalSections: [string, string[]][] = [
    ["yoyo_files", forensics.signalEvidence.yoyoFiles],
    ["retry_loops", forensics.signalEvidence.retryLoops],
    ["corrections", forensics.signalEvidence.corrections],
    ["interruptions", forensics.signalEvidence.interruptions],
    ["port_churn", forensics.signalEvidence.portChurn],
    ["tool_errors", forensics.signalEvidence.toolErrors],
    ["frustration_quotes", forensics.signalEvidence.frustrationQuotes],
  ];

  for (const [label, values] of signalSections) {
    if (values.length > 0) lines.push(`${label}: ${values.join(" ; ")}`);
  }

  const manualSections: [string, string[]][] = [
    ["build_checks", forensics.manualWorkEvidence.buildChecks],
    ["env_and_secrets", forensics.manualWorkEvidence.envAndSecrets],
    ["previews_and_localhost", forensics.manualWorkEvidence.previewsAndLocalhost],
    ["git", forensics.manualWorkEvidence.git],
    ["api_checks", forensics.manualWorkEvidence.apiChecks],
    ["assistant_handoffs", forensics.manualWorkEvidence.assistantHandoffs],
  ];

  for (const [label, values] of manualSections) {
    if (values.length > 0) lines.push(`${label}: ${values.join(" ; ")}`);
  }

  return lines.join("\n");
}

function buildProjectDiagnosisPromptForSource(
  forensics: ProjectForensics,
  source: LLMSource,
): string {
  const compactForensics = serializeForensicsCompact(forensics);

  const jsonDirective = source === "claude-sdk"
    ? "Return exactly one JSON object that matches the schema.\nThe first character of your response must be { and the last character must be }."
    : "Return exactly one JSON object. The first character must be { and the last must be }.";

  return `${jsonDirective}

Task:
- read the project forensics below
- identify at most 2 fixableInteractions
- identify any judgment-heavy work that should stay human-owned for now
- keep strings short and concrete

Rules:
- a fixable interaction must be delegable through a bounded interface
- minimalPermission must be narrow and specific
- observableSuccess must be something the agent could verify
- whyNotJustJudgment must explain why this is not merely taste or strategy
- do not recommend named tools
- do not narrate your reasoning
- do not say you need to inspect or analyze anything else
- if there are no clear fixable interactions, return an empty array

JSON shape:
{"project":"name","engineerPerspective":"one sentence","fixableInteractions":[{"title":"short","interactionSurface":"surface","humanRole":"role","description":"diagnosis","severity":"low|med|high|critical","minimalPermission":"permission","observableSuccess":"metric","whyNotJustJudgment":"reason","evidence":["evidence"]}],"nonFixableJudgment":["items"],"commodityToIgnore":["items"],"confidenceNotes":["items"]}

Project forensics:
${compactForensics}`;
}

function buildSynthesisPrompt(
  projectAnalyses: LLMProjectDiagnosis[],
  failedProjects: string[],
): string {
  return buildSynthesisPromptForSource(projectAnalyses, failedProjects, "claude-p");
}

function serializeProjectAnalysesCompact(
  projectAnalyses: LLMProjectDiagnosis[],
  failedProjects: string[],
): string {
  const lines: string[] = [];
  for (const analysis of projectAnalyses) {
    lines.push(`${analysis.project} | ${analysis.workflow}`);
    lines.push(`activities: ${analysis.dominantActivities}`);
    lines.push(`engineer_perspective: ${analysis.engineerPerspective}`);
    for (const interaction of analysis.fixableInteractions.slice(0, 3)) {
      const derivedRootCause = inferRootCauseFromInteraction(interaction);
      const derivedFixability = inferFixabilityFromInteraction(interaction);
      const derivedContract = inferBrokenContractFromInteraction(interaction);
      const derivedArchetype = inferToolArchetypeFromInteraction(interaction);
      lines.push(
        `- ${interaction.severity} | ${derivedFixability} fixable | ${interaction.humanRole} | ${interaction.title} | ${derivedRootCause}`
      );
      lines.push(`  surface: ${interaction.interactionSurface}`);
      lines.push(`  description: ${interaction.description}`);
      lines.push(`  broken_contract: ${derivedContract}`);
      lines.push(`  minimal_permission: ${interaction.minimalPermission}`);
      lines.push(`  observable_success: ${interaction.observableSuccess}`);
      lines.push(`  archetype: ${derivedArchetype}`);
      lines.push(`  existing_tools_failed: ${inferWhyExistingToolsFailedFromInteraction(interaction)}`);
      lines.push(`  not_just_judgment: ${interaction.whyNotJustJudgment}`);
      if (interaction.evidence.length > 0) lines.push(`  evidence: ${interaction.evidence.join(" ; ")}`);
      lines.push(`  if_fixed: ${inferIfFixedFromInteraction(interaction)}`);
    }
    if (analysis.nonFixableJudgment.length > 0) {
      lines.push(`non_fixable_judgment: ${analysis.nonFixableJudgment.join(" ; ")}`);
    }
    if (analysis.commodityToIgnore.length > 0) {
      lines.push(`commodity_to_ignore: ${analysis.commodityToIgnore.join(" ; ")}`);
    }
    if (analysis.confidenceNotes.length > 0) {
      lines.push(`confidence_notes: ${analysis.confidenceNotes.join(" ; ")}`);
    }
    lines.push("");
  }

  if (failedProjects.length > 0) {
    lines.push(`failed_projects: ${failedProjects.join(", ")}`);
  }

  return lines.join("\n").trim();
}

function buildSynthesisPromptForSource(
  projectAnalyses: LLMProjectDiagnosis[],
  failedProjects: string[],
  source: LLMSource,
): string {
  const compactAnalyses = serializeProjectAnalysesCompact(projectAnalyses, failedProjects);

  const jsonDirective = source === "claude-sdk"
    ? "Return exactly one JSON object that matches the schema."
    : "Return exactly one JSON object. The first character must be { and the last must be }.";

  return `${jsonDirective}

Task:
- synthesize the project analyses below
- keep only the most important recurring fixable interactions
- separate fixable gaps from commodity toil and judgment boundaries

Rules:
- only elevate issues that are bounded, permissionable, and observable
- do not recommend named tools
- keep descriptions concrete and short
- do not narrate your reasoning

JSON shape:
{"step1_surface":[{"project":"name","workflow":"type","dominantActivities":"activities","engineerPerspective":"read"}],"step2_fixableInteractions":[{"project":"name","title":"title","interactionSurface":"surface","humanRole":"role","description":"diagnosis","severity":"low|med|high|critical","fixability":"low|med|high","rootCause":"category","brokenContract":"contract","minimalPermission":"permission","observableSuccess":"metric","toolArchetype":"archetype","whyNotJustJudgment":"reason"}],"step3_systemicGaps":[{"title":"gap","pattern":"pattern","brokenContract":"contract","whyExistingToolsFailed":"reason","minimalPermission":"permission","toolArchetype":"archetype","whyThisIsFixable":"reason","projects":["p1"],"severity":"severity"}],"step4_crossProject":["pattern"],"step5_ranked":[{"rank":1,"title":"title","description":"desc","projects":["p1"],"severity":"severity","toolArchetype":"archetype","minimalPermission":"permission","ifFixed":"impact"}],"meta":{"projectAnalysesUsed":["names"],"failedProjects":["names"],"commodityToIgnore":["items"],"judgmentBoundaries":["items"],"confidenceNotes":["caveats"]}}

Project analyses:
${compactAnalyses}`;
}

function selectProjectsForLLM(projects: ProjectDiagnosis[], limit: number): ProjectDiagnosis[] {
  return [...projects]
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive))
    .slice(0, limit);
}

function extractClaudeContent(stdout: string): string {
  try {
    const response = JSON.parse(stdout);
    const content = response.result ?? response.content ?? stdout;
    return typeof content === "string" ? content : JSON.stringify(content);
  } catch {
    return stdout;
  }
}

function stringifyOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeEventCounts(eventCounts: Record<string, number>): string | undefined {
  const entries = Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (entries.length === 0) return undefined;
  return entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function hasRequiredKeys(value: unknown, requiredKeys: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  return requiredKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(value as Record<string, unknown>, key)
  );
}

function extractJsonObject(content: string, requiredKeys: string[]): string | null {
  const direct = content.trim();
  if (direct.startsWith("{") && direct.endsWith("}")) {
    try {
      const parsed = JSON.parse(direct);
      if (hasRequiredKeys(parsed, requiredKeys)) return direct;
    } catch {
      // fall through to substring extraction
    }
  }

  const starts: number[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "{") starts.push(i);
  }

  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < content.length; i++) {
      const ch = content[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = content.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (hasRequiredKeys(parsed, requiredKeys)) return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function isProjectDiagnosis(value: unknown): value is LLMProjectDiagnosis {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.project === "string" &&
    typeof record.engineerPerspective === "string" &&
    Array.isArray(record.fixableInteractions) &&
    Array.isArray(record.nonFixableJudgment) &&
    Array.isArray(record.commodityToIgnore) &&
    Array.isArray(record.confidenceNotes)
  );
}

function isSynthesisResult(value: unknown): value is LLMDiagnosisResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.step1_surface) &&
    Array.isArray(record.step2_fixableInteractions) &&
    Array.isArray(record.step3_systemicGaps) &&
    Array.isArray(record.step5_ranked)
  );
}

async function runClaudeSdkPrompt(
  prompt: string,
  timeoutMs: number,
  outputSchema: Record<string, unknown>,
  model: string,
): Promise<{
  structuredOutput: unknown;
  textOutput: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  exitCode: number | null;
  errors: string[];
  resultSubtype: string | null;
  stopReason: string | null;
  numTurns: number | null;
  eventCounts: Record<string, number>;
  eventTrace: string[];
  firstEventMs: number | null;
  firstAssistantMs: number | null;
  resultMs: number | null;
  lastAssistantPreview: string;
}> {
  return await new Promise((resolve, reject) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const startedAt = Date.now();
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const workerPath = fileURLToPath(new URL("./analyzer/sdk-worker.js", import.meta.url));
    const proc = spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs + 1_000);

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
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");

      try {
        const parsed = JSON.parse(stdout) as {
          structuredOutput: unknown;
          textOutput: string;
          stderr: string;
          timedOut: boolean;
          durationMs: number;
          exitCode: number | null;
          errors: string[];
          resultSubtype: string | null;
          stopReason: string | null;
          numTurns: number | null;
          eventCounts: Record<string, number>;
          eventTrace: string[];
          firstEventMs: number | null;
          firstAssistantMs: number | null;
          resultMs: number | null;
          lastAssistantPreview: string;
        };
        resolve({
          structuredOutput: parsed.structuredOutput ?? null,
          textOutput: parsed.textOutput || "",
          stderr: [parsed.stderr, stderr].filter(Boolean).join(" | "),
          timedOut: timedOut || !!parsed.timedOut,
          durationMs: parsed.durationMs || Date.now() - startedAt,
          exitCode: code,
          errors: parsed.errors || [],
          resultSubtype: parsed.resultSubtype ?? null,
          stopReason: parsed.stopReason ?? null,
          numTurns: parsed.numTurns ?? null,
          eventCounts: parsed.eventCounts || {},
          eventTrace: parsed.eventTrace || [],
          firstEventMs: parsed.firstEventMs ?? null,
          firstAssistantMs: parsed.firstAssistantMs ?? null,
          resultMs: parsed.resultMs ?? null,
          lastAssistantPreview: parsed.lastAssistantPreview || "",
        });
      } catch {
        resolve({
          structuredOutput: null,
          textOutput: "",
          stderr,
          timedOut,
          durationMs: Date.now() - startedAt,
          exitCode: code,
          errors: [
            stdout
              ? `Claude Agent SDK worker returned invalid JSON: ${truncate(stdout, 200)}`
              : "Claude Agent SDK worker returned no output",
          ],
          resultSubtype: null,
          stopReason: null,
          numTurns: null,
          eventCounts: {},
          eventTrace: [],
          firstEventMs: null,
          firstAssistantMs: null,
          resultMs: null,
          lastAssistantPreview: "",
        });
      }
    });

    proc.stdin.write(JSON.stringify({
      prompt,
      timeoutMs,
      outputSchema,
      model,
    }));
    proc.stdin.end();
  });
}

async function runClaudeJsonPrompt(
  prompt: string,
  timeoutMs: number,
  model: string,
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

    const proc = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
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

async function runClaudeStage<T>(
  name: string,
  prompt: string,
  timeoutMs: number,
  requiredKeys: string[],
  validator: (value: unknown) => value is T,
  outputSchema: Record<string, unknown>,
  source: LLMSource,
  model: string,
): Promise<{ parsed: T | null; meta: LLMDiagnosisStageMeta }> {
  try {
    if (source === "claude-sdk") {
      const run = await runClaudeSdkPrompt(prompt, timeoutMs, outputSchema, model);
      const outputText = stringifyOutput(run.structuredOutput ?? run.textOutput);
      console.error(
        `[diagnosis] stage=${name} source=${source} timedOut=${run.timedOut} output=${outputText.length} stderr=${run.stderr.length}`
      );

      const parsedValue = run.structuredOutput;
      if (parsedValue && validator(parsedValue)) {
        return {
          parsed: parsedValue,
          meta: {
            name,
            status: "success",
            durationMs: run.durationMs,
            timeoutMs,
            promptChars: prompt.length,
            outputChars: outputText.length,
            exitCode: run.exitCode,
            model,
            resultSubtype: run.resultSubtype,
            stopReason: run.stopReason,
            numTurns: run.numTurns,
            firstEventMs: run.firstEventMs,
            firstAssistantMs: run.firstAssistantMs,
            resultMs: run.resultMs,
            eventSummary: summarizeEventCounts(run.eventCounts),
            tracePreview: run.eventTrace.join(" | ") || undefined,
            assistantPreview: run.lastAssistantPreview || undefined,
            stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
          },
        };
      }

      const json = extractJsonObject(outputText, requiredKeys);
      if (json) {
        const parsedFallback = JSON.parse(json);
        if (validator(parsedFallback)) {
          return {
            parsed: parsedFallback,
            meta: {
              name,
            status: "success",
            durationMs: run.durationMs,
            timeoutMs,
            promptChars: prompt.length,
            outputChars: outputText.length,
            exitCode: run.exitCode,
            model,
            resultSubtype: run.resultSubtype,
            stopReason: run.stopReason,
            numTurns: run.numTurns,
            firstEventMs: run.firstEventMs,
            firstAssistantMs: run.firstAssistantMs,
            resultMs: run.resultMs,
            eventSummary: summarizeEventCounts(run.eventCounts),
            tracePreview: run.eventTrace.join(" | ") || undefined,
            assistantPreview: run.lastAssistantPreview || undefined,
            stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
          },
        };
      }
      }

      return {
        parsed: null,
        meta: {
          name,
          status: run.timedOut ? "timeout" : "error",
          durationMs: run.durationMs,
          timeoutMs,
          promptChars: prompt.length,
          outputChars: outputText.length,
          exitCode: run.exitCode,
          model,
          resultSubtype: run.resultSubtype,
          stopReason: run.stopReason,
          numTurns: run.numTurns,
          firstEventMs: run.firstEventMs,
          firstAssistantMs: run.firstAssistantMs,
          resultMs: run.resultMs,
          eventSummary: summarizeEventCounts(run.eventCounts),
          tracePreview: run.eventTrace.join(" | ") || undefined,
          assistantPreview: run.lastAssistantPreview || undefined,
          stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
          error: run.timedOut
            ? `Claude Agent SDK timed out after ${timeoutMs}ms`
            : truncate(
              run.errors.join(" | ") ||
                run.stderr ||
                (outputText
                  ? `Claude Agent SDK returned unparseable output: ${outputText}`
                  : "Claude Agent SDK returned invalid structured output"),
              180
            ),
        },
      };
    }

    const run = await runClaudeJsonPrompt(prompt, timeoutMs, model);
    console.error(
      `[diagnosis] stage=${name} source=${source} code=${run.exitCode} timedOut=${run.timedOut} stdout=${run.stdout.length} stderr=${run.stderr.length}`
    );

    const content = extractClaudeContent(run.stdout);
    const json = extractJsonObject(content, requiredKeys);
    if (!json) {
      return {
        parsed: null,
        meta: {
          name,
          status: run.timedOut ? "timeout" : "error",
          durationMs: run.durationMs,
          timeoutMs,
          promptChars: prompt.length,
          outputChars: run.stdout.length,
          exitCode: run.exitCode,
          model,
          stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
          error: run.timedOut
            ? `Claude CLI timed out after ${timeoutMs}ms`
            : truncate(run.stderr || "Claude CLI returned no parseable JSON", 180),
        },
      };
    }

    const parsedValue = JSON.parse(json);
    if (!validator(parsedValue)) {
      return {
        parsed: null,
        meta: {
          name,
          status: "error",
          durationMs: run.durationMs,
          timeoutMs,
          promptChars: prompt.length,
          outputChars: run.stdout.length,
          exitCode: run.exitCode,
          model,
          stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
          error: "Claude CLI returned JSON with unexpected shape",
        },
      };
    }

    return {
      parsed: parsedValue,
      meta: {
        name,
        status: "success",
        durationMs: run.durationMs,
        timeoutMs,
        promptChars: prompt.length,
        outputChars: run.stdout.length,
        exitCode: run.exitCode,
        model,
        stderrPreview: run.stderr ? truncate(run.stderr, 180) : undefined,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[diagnosis] stage=${name} source=${source} error=${message}`);
    return {
      parsed: null,
      meta: {
        name,
        status: "error",
        durationMs: 0,
        timeoutMs,
        promptChars: prompt.length,
        outputChars: 0,
        exitCode: null,
        model,
        error: truncate(message, 180),
      },
    };
  }
}

function buildSynthesisFromProjectAnalyses(
  projectAnalyses: LLMProjectDiagnosis[],
  failedProjects: string[],
): LLMDiagnosisResult {
  const step1_surface = projectAnalyses.map((analysis) => ({
    project: analysis.project,
    workflow: analysis.workflow,
    dominantActivities: analysis.dominantActivities,
    engineerPerspective: analysis.engineerPerspective,
  }));

  const step2_fixableInteractions = projectAnalyses.flatMap((analysis) =>
    analysis.fixableInteractions.slice(0, 3).map((interaction) => ({
      project: analysis.project,
      title: interaction.title,
      interactionSurface: interaction.interactionSurface,
      humanRole: interaction.humanRole,
      description: interaction.description,
      severity: interaction.severity,
      fixability: inferFixabilityFromInteraction(interaction),
      rootCause: inferRootCauseFromInteraction(interaction),
      brokenContract: inferBrokenContractFromInteraction(interaction),
      minimalPermission: interaction.minimalPermission,
      observableSuccess: interaction.observableSuccess,
      toolArchetype: inferToolArchetypeFromInteraction(interaction),
      whyNotJustJudgment: interaction.whyNotJustJudgment,
    }))
  );

  const grouped = new Map<string, {
    severity: string;
    fixability: string;
    title: string;
    humanRole: string;
    interactionSurface: string;
    brokenContract: string;
    minimalPermission: string;
    toolArchetype: string;
    whyExistingToolsFailed: string;
    whyThisIsFixable: string;
    descriptions: string[];
    ifFixed: string[];
    projects: string[];
  }>();

  for (const analysis of projectAnalyses) {
    for (const interaction of analysis.fixableInteractions.slice(0, 3)) {
      const derivedFixability = inferFixabilityFromInteraction(interaction);
      const derivedContract = inferBrokenContractFromInteraction(interaction);
      const derivedArchetype = inferToolArchetypeFromInteraction(interaction);
      const key = [
        interaction.title.trim().toLowerCase(),
        derivedContract.trim().toLowerCase(),
        derivedArchetype.trim().toLowerCase(),
      ].join("|");
      const existing = grouped.get(key);
      if (existing) {
        existing.projects.push(analysis.project);
        existing.descriptions.push(interaction.description);
        existing.ifFixed.push(inferIfFixedFromInteraction(interaction));
        if (severityScore(interaction.severity) > severityScore(existing.severity)) {
          existing.severity = interaction.severity;
        }
        if (fixabilityScore(derivedFixability) > fixabilityScore(existing.fixability)) {
          existing.fixability = derivedFixability;
        }
      } else {
        grouped.set(key, {
          severity: interaction.severity,
          fixability: derivedFixability,
          title: interaction.title,
          humanRole: interaction.humanRole,
          interactionSurface: interaction.interactionSurface,
          brokenContract: derivedContract,
          minimalPermission: interaction.minimalPermission,
          toolArchetype: derivedArchetype,
          whyExistingToolsFailed: inferWhyExistingToolsFailedFromInteraction(interaction),
          whyThisIsFixable: interaction.whyNotJustJudgment,
          descriptions: [interaction.description],
          ifFixed: [inferIfFixedFromInteraction(interaction)],
          projects: [analysis.project],
        });
      }
    }
  }

  const step3_systemicGaps = [...grouped.values()]
    .map((entry) => ({
      title: entry.title,
      pattern: `${entry.humanRole} on ${entry.interactionSurface}`,
      brokenContract: entry.brokenContract,
      whyExistingToolsFailed: entry.whyExistingToolsFailed,
      minimalPermission: entry.minimalPermission,
      toolArchetype: entry.toolArchetype,
      whyThisIsFixable: entry.whyThisIsFixable,
      projects: [...new Set(entry.projects)],
      severity: entry.severity,
      score:
        severityScore(entry.severity) *
        fixabilityScore(entry.fixability) *
        [...new Set(entry.projects)].length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ score: _score, ...entry }) => entry);

  const step5_ranked = [...grouped.values()]
    .map((entry) => ({
      title: `${entry.title} — ${entry.humanRole}`,
      severity: entry.severity,
      description: `${entry.descriptions[0]} Permission boundary: ${entry.minimalPermission}. Archetype: ${entry.toolArchetype}.`,
      projects: [...new Set(entry.projects)],
      toolArchetype: entry.toolArchetype,
      minimalPermission: entry.minimalPermission,
      ifFixed: uniqueNonEmpty(entry.ifFixed)[0] || "If this were fixed: the human would stop supplying this workflow contract",
      score:
        severityScore(entry.severity) *
        fixabilityScore(entry.fixability) *
        [...new Set(entry.projects)].length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry, index) => ({
      rank: index + 1,
      title: entry.title,
      description: entry.description,
      projects: entry.projects,
      severity: entry.severity,
      toolArchetype: entry.toolArchetype,
      minimalPermission: entry.minimalPermission,
      ifFixed: entry.ifFixed,
    }));

  const repeatedTitles = [...grouped.values()]
    .filter((entry) => [...new Set(entry.projects)].length >= 2)
    .sort((a, b) => [...new Set(b.projects)].length - [...new Set(a.projects)].length)
    .slice(0, 5)
    .map((entry) =>
      `"${entry.title}" across ${[...new Set(entry.projects)].length} projects (${[...new Set(entry.projects)].join(", ")}): ${entry.brokenContract}`
    );

  return {
    step1_surface,
    step2_fixableInteractions,
    step3_systemicGaps,
    step4_crossProject: repeatedTitles,
    step5_ranked,
    meta: {
      projectAnalysesUsed: projectAnalyses.map((analysis) => analysis.project),
      failedProjects,
      commodityToIgnore: uniqueNonEmpty(projectAnalyses.flatMap((analysis) => analysis.commodityToIgnore)).slice(0, 8),
      judgmentBoundaries: uniqueNonEmpty(projectAnalyses.flatMap((analysis) => analysis.nonFixableJudgment)).slice(0, 8),
      confidenceNotes: uniqueNonEmpty(projectAnalyses.flatMap((analysis) => analysis.confidenceNotes)).slice(0, 8),
    },
  };
}

export async function enhanceWithLLM(
  scanResult: ScanResult,
  signals: WorkflowSignal[],
  computedDiagnosis: Diagnosis,
  installedTools: InstalledTool[] = [],
): Promise<LLMDiagnosisRun> {
  const startedAt = Date.now();
  const source = getPreferredSource();
  const fallbackTimeoutMs = getClaudeTimeoutMs();
  const projectTimeoutMs = getStageTimeoutMs("project");
  const synthesisTimeoutMs = getStageTimeoutMs("synthesis");
  const signalsByProject = buildSignalsByProject(signals);
  const stages: LLMDiagnosisStageMeta[] = [];

  if (source === "claude-p" && !isClaudeAvailable()) {
    console.error("[diagnosis] claude CLI not found");
    return {
      result: null,
      meta: {
        status: "unavailable",
        source,
        mode: "multi-pass",
        resultMode: "project-fallback",
        durationMs: 0,
        timeoutMs: fallbackTimeoutMs,
        promptChars: 0,
        outputChars: 0,
        projectCountRequested: 0,
        projectCountSucceeded: 0,
        selectedProjects: [],
        stages,
        exitCode: null,
        error: "claude CLI not found in PATH",
      },
    };
  }

  const projectLimit = getProjectLimit(computedDiagnosis.projects.length);
  const selectedDiagnoses = selectProjectsForLLM(computedDiagnosis.projects, projectLimit);
  const selectedProjectNames = selectedDiagnoses.map((project) => project.name);
  const scanByProject = new Map(scanResult.projects.map((project) => [project.projectName, project]));

  const successfulProjectAnalyses: LLMProjectDiagnosis[] = [];
  const failedProjects: string[] = [];

  // Build all stage inputs upfront
  const stageInputs: { diagnosis: ProjectDiagnosis; prompt: string }[] = [];
  for (const projectDiagnosis of selectedDiagnoses) {
    const project = scanByProject.get(projectDiagnosis.name);
    if (!project) continue;
    const projectSignals = signalsByProject.get(projectDiagnosis.name) || [];
    const forensics = buildProjectForensics(project, projectDiagnosis, projectSignals, installedTools);
    const prompt = buildProjectDiagnosisPromptForSource(forensics, source);
    console.error(`[diagnosis] project forensics ${projectDiagnosis.name}: ${prompt.length} chars`);
    stageInputs.push({ diagnosis: projectDiagnosis, prompt });
  }

  // Run all project analyses in parallel
  const stageResults = await Promise.allSettled(
    stageInputs.map(({ diagnosis: projectDiagnosis, prompt }) =>
      runClaudeStage<LLMProjectDiagnosis>(
        `project:${projectDiagnosis.name}`,
        prompt,
        projectTimeoutMs,
        ["project", "fixableInteractions"],
        isProjectDiagnosis,
        PROJECT_DIAGNOSIS_SCHEMA,
        source,
        getClaudeModelForStage("project"),
      ).then((stage) => ({ stage, projectDiagnosis }))
    )
  );

  for (const result of stageResults) {
    if (result.status === "rejected") continue;
    const { stage, projectDiagnosis } = result.value;
    stages.push(stage.meta);

    if (stage.parsed) {
      successfulProjectAnalyses.push({
        ...stage.parsed,
        project: projectDiagnosis.name,
        workflow: projectDiagnosis.workflow,
        dominantActivities: projectDiagnosis.workflowLoops
          .slice(0, 2)
          .map((loop) => loop.name)
          .join(", ") || projectDiagnosis.workflow,
      });
    } else {
      failedProjects.push(projectDiagnosis.name);
    }
  }

  const aggregatePromptChars = stages.reduce((sum, stage) => sum + stage.promptChars, 0);
  const aggregateOutputChars = stages.reduce((sum, stage) => sum + stage.outputChars, 0);
  const aggregateExitCode = stages.at(-1)?.exitCode ?? null;
  const aggregateStderr = stages.find((stage) => stage.stderrPreview)?.stderrPreview;

  if (successfulProjectAnalyses.length === 0) {
    const firstFailure = stages.find((stage) => stage.status !== "success");
    return {
      result: null,
      meta: {
        status: firstFailure?.status === "timeout" ? "timeout" : "error",
        source,
        mode: "multi-pass",
        resultMode: "project-fallback",
        durationMs: Date.now() - startedAt,
        timeoutMs: Math.max(projectTimeoutMs, synthesisTimeoutMs),
        promptChars: aggregatePromptChars,
        outputChars: aggregateOutputChars,
        projectCountRequested: selectedDiagnoses.length,
        projectCountSucceeded: 0,
        selectedProjects: selectedProjectNames,
        stages,
        exitCode: aggregateExitCode,
        stderrPreview: aggregateStderr,
        error: firstFailure?.error || "All project diagnosis stages failed",
      },
    };
  }

  const totalPromptChars = stages.reduce((sum, stage) => sum + stage.promptChars, 0);
  const totalOutputChars = stages.reduce((sum, stage) => sum + stage.outputChars, 0);
  const durationMs = Date.now() - startedAt;
  const stageErrors = stages.filter((stage) => stage.status !== "success");
  const result = buildSynthesisFromProjectAnalyses(successfulProjectAnalyses, failedProjects);

  if (result.meta) {
    result.meta.projectAnalysesUsed = successfulProjectAnalyses.map((analysis) => analysis.project);
    result.meta.failedProjects = failedProjects;
    result.meta.commodityToIgnore = uniqueNonEmpty([
      ...(result.meta.commodityToIgnore || []),
      ...successfulProjectAnalyses.flatMap((analysis) => analysis.commodityToIgnore),
    ]).slice(0, 8);
    result.meta.judgmentBoundaries = uniqueNonEmpty([
      ...(result.meta.judgmentBoundaries || []),
      ...successfulProjectAnalyses.flatMap((analysis) => analysis.nonFixableJudgment),
    ]).slice(0, 8);
    result.meta.confidenceNotes = uniqueNonEmpty([
      ...(result.meta.confidenceNotes || []),
      ...successfulProjectAnalyses.flatMap((analysis) => analysis.confidenceNotes),
      ...(failedProjects.length > 0 ? [`Failed project analyses: ${failedProjects.join(", ")}`] : []),
    ]).slice(0, 10);
  }

  return {
    result,
    meta: {
      status: "success",
      source,
      mode: "multi-pass",
      resultMode: "project-fallback",
      durationMs,
      timeoutMs: projectTimeoutMs,
      promptChars: totalPromptChars,
      outputChars: totalOutputChars,
      projectCountRequested: selectedDiagnoses.length,
      projectCountSucceeded: successfulProjectAnalyses.length,
      selectedProjects: selectedProjectNames,
      stages,
      exitCode: aggregateExitCode,
      stderrPreview: stageErrors.find((stage) => stage.stderrPreview)?.stderrPreview,
      error: undefined,
    },
  };
}

// ── Prompt Export / External Answer Mode ──

export interface DiagnosisPrompt {
  project: string;
  workflow: string;
  prompt: string;
}

export interface ProjectBrief {
  project: string;
  workflow: string;
  sessions: number;
  painScore: number;
  rawUserMessages: string[];
  rawBashCommands: string[];
  rawAssistantHandoffs: string[];
  rawToolErrors: string[];
  heuristicFindings: string[];
  implicitSignals: ImplicitSignalSummary;
}

export function buildDiagnosisData(
  scanResult: ScanResult,
  signals: WorkflowSignal[],
  computedDiagnosis: Diagnosis,
  installedTools: InstalledTool[] = [],
): { briefs: ProjectBrief[]; prompts: DiagnosisPrompt[] } {
  const projectLimit = getProjectLimit(computedDiagnosis.projects.length);
  const selectedDiagnoses = selectProjectsForLLM(computedDiagnosis.projects, projectLimit);
  const signalsByProject = buildSignalsByProject(signals);
  const scanByProject = new Map(scanResult.projects.map((project) => [project.projectName, project]));

  const briefs: ProjectBrief[] = [];
  const prompts: DiagnosisPrompt[] = [];

  for (const projectDiagnosis of selectedDiagnoses) {
    const project = scanByProject.get(projectDiagnosis.name);
    if (!project) continue;

    // Raw session data — the actual story, not pre-digested summaries
    const rawUserMessages = project.parsedUserMessages
      .filter((m) => m.text.length > 10)
      .slice(-30)
      .map((m) => (m.isInterrupted ? `[INTERRUPTED] ${m.text}` : m.text))
      .map((t) => truncate(t, 200));
    const rawBashCommands = project.bashCommands.slice(-40).map((c) => truncate(c, 150));
    const rawAssistantHandoffs = project.assistantHandoffs.slice(-10).map((h) => truncate(h, 200));
    const rawToolErrors = project.rawToolUses
      .filter((u) => u.isError && u.errorMessage)
      .slice(-10)
      .map((u) => `${u.name}: ${truncate(u.errorMessage || "", 120)}`);

    // What heuristics already found — so the LLM knows what's covered
    const heuristicFindings = projectDiagnosis.workflowLoops.slice(0, 4).map((loop) =>
      `[${loop.severity}] ${loop.name} — ${loop.humanRole}. Gap: ${loop.agentGap}`
    );

    // Implicit signals — what systems was the human consulting between messages?
    const toolTimestamps = project.toolCalls.map((tc) => tc.timestamp).filter(Boolean);
    const rawImplicitSignals = detectImplicitSignals(project.userMessages, toolTimestamps);
    const implicitSignals = summarizeImplicitSignals(rawImplicitSignals);

    briefs.push({
      project: projectDiagnosis.name,
      workflow: projectDiagnosis.workflow,
      sessions: project.sessionCount,
      painScore: projectDiagnosis.painScore,
      rawUserMessages,
      rawBashCommands,
      rawAssistantHandoffs,
      rawToolErrors,
      heuristicFindings,
      implicitSignals,
    });

    // Also build the structured extraction prompt for backward compat
    const projectSignals = signalsByProject.get(projectDiagnosis.name) || [];
    const forensics = buildProjectForensics(project, projectDiagnosis, projectSignals, installedTools);
    const prompt = buildProjectDiagnosisPromptForSource(forensics, "claude-p");
    prompts.push({ project: projectDiagnosis.name, workflow: projectDiagnosis.workflow, prompt });
  }

  return { briefs, prompts };
}

export function synthesizeFromExternalAnswers(
  computedDiagnosis: Diagnosis,
  answers: { project: string; json: unknown }[],
): LLMDiagnosisRun {
  const startedAt = Date.now();
  const successfulProjectAnalyses: LLMProjectDiagnosis[] = [];
  const failedProjects: string[] = [];
  const stages: LLMDiagnosisStageMeta[] = [];

  for (const answer of answers) {
    const projectDiagnosis = computedDiagnosis.projects.find((p) => p.name === answer.project);
    if (!projectDiagnosis) {
      failedProjects.push(answer.project);
      continue;
    }

    if (isProjectDiagnosis(answer.json)) {
      stages.push({
        name: `project:${answer.project}`,
        status: "success",
        durationMs: 0,
        timeoutMs: 0,
        promptChars: 0,
        outputChars: JSON.stringify(answer.json).length,
      });
      successfulProjectAnalyses.push({
        ...answer.json,
        project: projectDiagnosis.name,
        workflow: projectDiagnosis.workflow,
        dominantActivities: projectDiagnosis.workflowLoops
          .slice(0, 2)
          .map((loop) => loop.name)
          .join(", ") || projectDiagnosis.workflow,
      });
    } else {
      stages.push({
        name: `project:${answer.project}`,
        status: "error",
        durationMs: 0,
        timeoutMs: 0,
        promptChars: 0,
        outputChars: 0,
        error: "Response did not match expected schema",
      });
      failedProjects.push(answer.project);
    }
  }

  if (successfulProjectAnalyses.length === 0) {
    return {
      result: null,
      meta: {
        status: "error",
        source: "claude-p",
        mode: "multi-pass",
        resultMode: "project-fallback",
        durationMs: Date.now() - startedAt,
        timeoutMs: 0,
        promptChars: 0,
        outputChars: 0,
        projectCountRequested: answers.length,
        projectCountSucceeded: 0,
        selectedProjects: answers.map((a) => a.project),
        stages,
        error: "No project analyses matched the expected schema",
      },
    };
  }

  const result = buildSynthesisFromProjectAnalyses(successfulProjectAnalyses, failedProjects);
  return {
    result,
    meta: {
      status: "success",
      source: "claude-p",
      mode: "multi-pass",
      resultMode: "project-fallback",
      durationMs: Date.now() - startedAt,
      timeoutMs: 0,
      promptChars: 0,
      outputChars: stages.reduce((sum, s) => sum + s.outputChars, 0),
      projectCountRequested: answers.length,
      projectCountSucceeded: successfulProjectAnalyses.length,
      selectedProjects: answers.map((a) => a.project),
      stages,
    },
  };
}
