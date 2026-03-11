import type { DetectedPattern, PatternCategory } from "../scanner/patterns.js";
import type { InstalledTool } from "../scanner/installed.js";
import type { WorkflowSignal } from "../scanner/signals.js";
import type { ScanResult } from "../scanner/sessions.js";
import { isToolInstalled } from "../scanner/installed.js";
import toolsCatalog from "../catalog/tools.json" with { type: "json" };

export type ScoreLevel = "low" | "med" | "high";

export interface ProjectEvidence {
  project: string;
  yoyoFiles: string[];
  frustrationQuotes: string[];
  toolErrors: string[];
  repeatedCommands: string[];
  interruptions: number;
}

export interface ToolRecommendation {
  id: string;
  name: string;
  type: "mcp" | "cli" | "package";
  installCommand: string;
  url: string;
  workflowOwnership: ScoreLevel;
  painEliminated: ScoreLevel;
  agentReadiness: ScoreLevel;
  sellDescription: string;
  matchedPatterns: DetectedPattern[];
  projectEvidence: ProjectEvidence[];
  projects: string[];
  relevanceScore: number;
  alreadyInstalled?: InstalledTool;
  meta: {
    stars: number;
    permissions: string;
    riskLevel: string;
  };
}

interface CatalogEntry {
  id: string;
  name: string;
  type: string;
  installCommand: string;
  url: string;
  patterns: string[];
  workflowOwnership: string;
  painEliminated: string;
  agentReadiness: string;
  sellTemplate: string;
  meta: {
    stars: number;
    permissions: string;
    riskLevel: string;
  };
}

const SCORE_ORDER: Record<string, number> = {
  high: 3,
  med: 2,
  low: 1,
};

// Tools that require specific technology usage to be relevant.
// Uses word-boundary regex to avoid substring false positives.
const TECH_FILTERS: Record<string, RegExp> = {
  "k8s-mcp": /\b(kubectl|kubernetes|k8s|helm|minikube)\b/i,
  "aws-mcp": /\b(aws\s|awscli|cloudformation|ecs|ecr|s3cmd)\b/i,
  "railway-cli": /\brailway\b/i,
  "cloudflare-mcp": /\b(wrangler|cloudflare)\b/i,
  "docker-mcp": /\b(docker|docker-compose|podman)\b/i,
  "stripe-mcp": /\bstripe\b/i,
  "slack-mcp": /\bslack\b/i,
  "vercel-mcp": /\bvercel\b/i,
};

// Which file extensions are relevant to each tool category
const CATEGORY_FILE_EXTENSIONS: Record<string, string[]> = {
  ios: [".swift", ".xib", ".storyboard", ".plist", ".xcconfig"],
  database: [".sql", ".prisma", ".migration"],
  browser: [".tsx", ".jsx", ".html", ".css", ".vue", ".svelte"],
  testing: [".test.", ".spec.", ".swift", ".tsx", ".jsx", ".html"],
  deployment: [".yml", ".yaml", ".toml", ".dockerfile"],
};

// Which command keywords are relevant to each tool category
const CATEGORY_CMD_KEYWORDS: Record<string, RegExp> = {
  ios: /\b(xcodebuild|xcodegen|xcrun|simctl|pod |fastlane|swift build)\b/i,
  database: /\b(supabase|psql|sqlite|pg_dump|migration|prisma)\b/i,
  git: /\b(git |gh )\b/i,
  deployment: /\b(deploy|vercel|netlify|heroku|fly )\b/i,
  browser: /\b(playwright|puppeteer|cypress|open http|localhost)\b/i,
  "local-development": /\b(localhost|127\.0\.0\.1|next dev|vite|vercel dev|npm run dev|pnpm dev|yarn dev|bun run dev|lsof -i|pkill|killall|kill -9)\b/i,
  testing: /\b(npm test|npm run test|jest|vitest|xctest|swift test)\b/i,
  "project-management": /\b(linear|todoist|jira|asana)\b/i,
  "package-management": /\b(npm |yarn |pnpm |brew |pip |cargo )\b/i,
};

const YOYO_EVIDENCE_CATEGORIES = new Set(["ios", "browser", "local-development"]);

function hasTechEvidence(toolId: string, scanResult: ScanResult): boolean {
  const filter = TECH_FILTERS[toolId];
  if (!filter) return true;

  for (const project of scanResult.projects) {
    for (const cmd of project.bashCommands) {
      if (filter.test(cmd)) return true;
    }
  }
  return false;
}

function projectHasMonorepoEvidence(project: ScanResult["projects"][number]): boolean {
  const workspaceConfigPattern =
    /(?:^|\/)(pnpm-workspace\.yaml|turbo\.json|nx\.json|lerna\.json|rush\.json)$/i;
  const monorepoCommandPattern =
    /\b(turbo\b|nx\b|lerna\b|rush\b|pnpm\s+--filter|yarn\s+workspace|npm\s+run\s+\S+\s+--workspace|npm\s+--workspace)\b/i;
  const nestedPackagePattern =
    /\/(?:apps|packages|libs|services)\/([^/]+)\/package\.json$/i;

  const nestedPackages = new Set<string>();
  for (const toolUse of project.rawToolUses) {
    if (typeof toolUse.filePath !== "string") continue;

    if (workspaceConfigPattern.test(toolUse.filePath)) {
      return true;
    }

    const nestedPackageMatch = toolUse.filePath.match(nestedPackagePattern);
    if (nestedPackageMatch?.[1]) {
      nestedPackages.add(nestedPackageMatch[1]);
    }
  }

  return (
    nestedPackages.size >= 2 ||
    project.bashCommands.some((command) => monorepoCommandPattern.test(command))
  );
}

function projectHasLintFormattingPain(project: ScanResult["projects"][number]): boolean {
  const lintConfigPattern =
    /(?:^|\/)(eslint\.config|\.eslintrc|prettier\.config|\.prettierrc|biome\.json|rome\.json)/i;
  const lintCommandPattern =
    /\b(eslint|prettier|stylelint|rome|biome|npm\s+run\s+lint|pnpm\s+lint|yarn\s+lint)\b/i;

  return (
    project.rawToolUses.some((toolUse) =>
      typeof toolUse.filePath === "string" && lintConfigPattern.test(toolUse.filePath)
    ) ||
    project.bashCommands.some((command) => lintCommandPattern.test(command))
  );
}

function findProjects(
  scanResult: ScanResult | undefined,
  projectNames: string[],
): ScanResult["projects"] {
  if (!scanResult) return [];
  const nameSet = new Set(projectNames);
  return scanResult.projects.filter((project) => nameSet.has(project.projectName));
}

/**
 * Check if a yoyo-file signal is relevant to a tool's categories.
 * e.g. SwipeCardView.swift yoyo → relevant to "ios" tools, not "database" tools
 */
function isYoyoRelevant(description: string, categories: string[]): boolean {
  if (!categories.some((category) => YOYO_EVIDENCE_CATEGORIES.has(category))) {
    return false;
  }

  const descLower = description.toLowerCase();
  for (const cat of categories) {
    const extensions = CATEGORY_FILE_EXTENSIONS[cat];
    if (extensions) {
      for (const ext of extensions) {
        if (descLower.includes(ext)) return true;
      }
    }
  }
  // If the tool has no file extension mapping, don't show yoyos
  return false;
}

/**
 * Check if a repeated-command signal is relevant to a tool's categories.
 * e.g. "xcodegen generate" repeated → relevant to "ios" tools
 */
function isCommandRelevant(description: string, categories: string[]): boolean {
  for (const cat of categories) {
    const pattern = CATEGORY_CMD_KEYWORDS[cat];
    if (pattern && pattern.test(description)) return true;
  }
  return false;
}

function collectProjectEvidence(
  matchedPatterns: DetectedPattern[],
  signals: WorkflowSignal[],
  toolCategories: string[],
): ProjectEvidence[] {
  const projectNames = new Set(matchedPatterns.flatMap((p) => p.projects));
  const evidence: ProjectEvidence[] = [];

  for (const project of projectNames) {
    const projectSignals = signals.filter((s) => s.project === project);
    if (projectSignals.length === 0) continue;

    const pe: ProjectEvidence = {
      project,
      yoyoFiles: [],
      frustrationQuotes: [],
      toolErrors: [],
      repeatedCommands: [],
      interruptions: 0,
    };

    for (const s of projectSignals) {
      switch (s.type) {
        case "yoyo-file":
          // Only include yoyos relevant to this tool's domain
          if (isYoyoRelevant(s.description, toolCategories)) {
            pe.yoyoFiles.push(s.description);
          }
          break;
        case "repeated-command":
          // Only include commands relevant to this tool's domain
          if (isCommandRelevant(s.description, toolCategories)) {
            pe.repeatedCommands.push(s.description);
          }
          break;
        case "port-juggling":
          if (toolCategories.includes("local-development")) {
            pe.repeatedCommands.push(s.description);
          }
          break;
        case "tool-error":
          // Tool errors are general — include up to 1
          if (pe.toolErrors.length < 1) {
            pe.toolErrors.push(`${s.description}: ${s.evidence.substring(0, 80)}`);
          }
          break;
        case "interrupted":
          pe.interruptions += s.count;
          break;
        // Skip frustration — it's too generic to attribute to a specific tool
      }
    }

    // Only include if there's tool-specific content (not just generic interruptions/errors)
    const hasSpecificContent =
      pe.yoyoFiles.length > 0 ||
      pe.repeatedCommands.length > 0;

    if (hasSpecificContent) evidence.push(pe);
  }

  // Sort by most relevant evidence first
  evidence.sort((a, b) => {
    const scoreA = a.yoyoFiles.length * 3 + a.repeatedCommands.length * 2;
    const scoreB = b.yoyoFiles.length * 3 + b.repeatedCommands.length * 2;
    return scoreB - scoreA;
  });

  return evidence;
}

function inferRelevantProjects(
  toolCategories: string[],
  matchedPatterns: DetectedPattern[],
  evidence: ProjectEvidence[],
  scanResult?: ScanResult,
): string[] {
  const evidenceProjects = [...new Set(evidence.map((item) => item.project).filter(Boolean))];
  if (evidenceProjects.length > 0) {
    return evidenceProjects;
  }

  if (!scanResult) {
    return [...new Set(matchedPatterns.flatMap((p) => p.projects).filter(Boolean))];
  }

  const inferredProjects = scanResult.projects
    .filter((project) =>
      toolCategories.some((category) => {
        const commandPattern = CATEGORY_CMD_KEYWORDS[category];
        return commandPattern
          ? project.bashCommands.some((command) => commandPattern.test(command))
          : false;
      })
    )
    .map((project) => project.projectName)
    .filter(Boolean);

  if (inferredProjects.length > 0) {
    return [...new Set(inferredProjects)];
  }

  return [...new Set(matchedPatterns.flatMap((p) => p.projects).filter(Boolean))];
}

function shouldSuppressBecauseEquivalentInstalled(
  tool: CatalogEntry,
  installedTools: InstalledTool[],
): boolean {
  if (
    tool.id === "puppeteer-mcp" &&
    installedTools.some((installed) => /playwright/i.test(installed.name))
  ) {
    return true;
  }

  if (
    tool.id === "gh-cli" &&
    isToolInstalled("github-mcp", "GitHub MCP Server", installedTools)
  ) {
    return true;
  }

  return false;
}

function shouldSuppressForWeakFit(
  tool: CatalogEntry,
  matchedPatterns: DetectedPattern[],
  scanResult?: ScanResult,
): boolean {
  const relevantProjects = findProjects(
    scanResult,
    [...new Set(matchedPatterns.flatMap((pattern) => pattern.projects).filter(Boolean))],
  );

  if (tool.id === "turborepo") {
    return !relevantProjects.some(projectHasMonorepoEvidence);
  }

  if (tool.id === "biome") {
    return !relevantProjects.some(projectHasLintFormattingPain);
  }

  return false;
}

function buildPersonalizedDescription(
  tool: CatalogEntry,
  evidence: ProjectEvidence[],
): string {
  if (evidence.length === 0) return tool.sellTemplate;

  const top = evidence[0];
  const parts: string[] = [];

  if (top.yoyoFiles.length > 0) {
    parts.push(`In '${top.project}', ${top.yoyoFiles[0]}`);
  }

  if (top.repeatedCommands.length > 0) {
    parts.push(`${top.repeatedCommands[0]} in '${top.project}'`);
  }

  if (top.interruptions > 10) {
    parts.push(`You interrupted Claude ${top.interruptions} times in '${top.project}'`);
  }

  if (parts.length > 0) {
    return parts.slice(0, 2).join(". ") + ".";
  }

  return tool.sellTemplate;
}

function computeRelevanceScore(
  tool: CatalogEntry,
  matchedPatterns: DetectedPattern[],
  evidence: ProjectEvidence[],
): number {
  const wo = SCORE_ORDER[tool.workflowOwnership] || 1;
  const pe = SCORE_ORDER[tool.painEliminated] || 1;
  const ar = SCORE_ORDER[tool.agentReadiness] || 1;

  const baseScore = wo * 3 + pe * 2 + ar * 1;

  const frequencyBoost = matchedPatterns.reduce(
    (sum, p) => sum + Math.min(p.frequency, 50),
    0
  );

  const projectBoost = new Set(
    matchedPatterns.flatMap((p) => p.projects)
  ).size;

  // Boost tools with domain-specific evidence
  const signalBoost = evidence.reduce((sum, e) => {
    return sum + e.yoyoFiles.length * 3 + e.repeatedCommands.length * 2;
  }, 0);

  return baseScore + frequencyBoost * 0.1 + projectBoost * 0.5 + signalBoost * 0.5;
}

export function matchToolsToPatterns(
  patterns: DetectedPattern[],
  installedTools: InstalledTool[] = [],
  signals: WorkflowSignal[] = [],
  scanResult?: ScanResult,
): ToolRecommendation[] {
  const catalog = toolsCatalog as CatalogEntry[];
  const recommendations: ToolRecommendation[] = [];

  const patternsByCategory = new Map<PatternCategory, DetectedPattern>();
  for (const p of patterns) {
    patternsByCategory.set(p.category, p);
  }

  for (const tool of catalog) {
    // Filter out tools with no tech evidence in bash commands
    if (scanResult && !hasTechEvidence(tool.id, scanResult)) {
      continue;
    }

    if (shouldSuppressBecauseEquivalentInstalled(tool, installedTools)) {
      continue;
    }

    const matchedPatterns: DetectedPattern[] = [];

    for (const patternKey of tool.patterns) {
      const pattern = patternsByCategory.get(
        patternKey as PatternCategory
      );
      if (pattern) {
        matchedPatterns.push(pattern);
      }
    }

    if (matchedPatterns.length === 0) continue;

    if (shouldSuppressForWeakFit(tool, matchedPatterns, scanResult)) {
      continue;
    }

    // Adjust pain eliminated based on actual usage frequency
    let adjustedPain = tool.painEliminated as ScoreLevel;
    const totalFrequency = matchedPatterns.reduce(
      (s, p) => s + p.frequency,
      0
    );
    if (totalFrequency > 20 && adjustedPain === "med") {
      adjustedPain = "high";
    }

    const installed = isToolInstalled(tool.id, tool.name, installedTools);

    // Collect domain-specific evidence from signals
    const projectEvidence = collectProjectEvidence(
      matchedPatterns,
      signals,
      tool.patterns,
    );

    const allProjects = inferRelevantProjects(
      tool.patterns,
      matchedPatterns,
      projectEvidence,
      scanResult,
    );

    const sellDescription = buildPersonalizedDescription(tool, projectEvidence);

    recommendations.push({
      id: tool.id,
      name: tool.name,
      type: tool.type as "mcp" | "cli" | "package",
      installCommand: tool.installCommand,
      url: tool.url,
      workflowOwnership: tool.workflowOwnership as ScoreLevel,
      painEliminated: adjustedPain,
      agentReadiness: tool.agentReadiness as ScoreLevel,
      sellDescription,
      matchedPatterns,
      projectEvidence,
      projects: allProjects,
      relevanceScore: computeRelevanceScore(tool, matchedPatterns, projectEvidence),
      alreadyInstalled: installed,
      meta: tool.meta,
    });
  }

  recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return recommendations;
}
