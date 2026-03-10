import type { DetectedPattern, PatternCategory } from "../scanner/patterns.js";
import toolsCatalog from "../catalog/tools.json" with { type: "json" };

export type ScoreLevel = "low" | "med" | "high";

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
  relevanceScore: number;
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

function computeRelevanceScore(
  tool: CatalogEntry,
  matchedPatterns: DetectedPattern[]
): number {
  // Weighted combination: workflow ownership matters most
  const wo = SCORE_ORDER[tool.workflowOwnership] || 1;
  const pe = SCORE_ORDER[tool.painEliminated] || 1;
  const ar = SCORE_ORDER[tool.agentReadiness] || 1;

  // Base score from pillar ratings
  const baseScore = wo * 3 + pe * 2 + ar * 1;

  // Boost by pattern frequency (how often the user actually does this)
  const frequencyBoost = matchedPatterns.reduce(
    (sum, p) => sum + Math.min(p.frequency, 50),
    0
  );

  // Boost by number of projects affected
  const projectBoost = new Set(
    matchedPatterns.flatMap((p) => p.projects)
  ).size;

  return baseScore + frequencyBoost * 0.1 + projectBoost * 0.5;
}

export function matchToolsToPatterns(
  patterns: DetectedPattern[]
): ToolRecommendation[] {
  const catalog = toolsCatalog as CatalogEntry[];
  const recommendations: ToolRecommendation[] = [];

  const patternsByCategory = new Map<PatternCategory, DetectedPattern>();
  for (const p of patterns) {
    patternsByCategory.set(p.category, p);
  }

  for (const tool of catalog) {
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

    // Adjust pain eliminated based on actual usage frequency
    let adjustedPain = tool.painEliminated as ScoreLevel;
    const totalFrequency = matchedPatterns.reduce(
      (s, p) => s + p.frequency,
      0
    );
    if (totalFrequency > 20 && adjustedPain === "med") {
      adjustedPain = "high";
    }

    recommendations.push({
      id: tool.id,
      name: tool.name,
      type: tool.type as "mcp" | "cli" | "package",
      installCommand: tool.installCommand,
      url: tool.url,
      workflowOwnership: tool.workflowOwnership as ScoreLevel,
      painEliminated: adjustedPain,
      agentReadiness: tool.agentReadiness as ScoreLevel,
      sellDescription: tool.sellTemplate,
      matchedPatterns,
      relevanceScore: computeRelevanceScore(tool, matchedPatterns),
      meta: tool.meta,
    });
  }

  // Sort by relevance score (highest first)
  recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return recommendations;
}
