import { execSync } from "node:child_process";
import type { ToolRecommendation } from "./matcher.js";
import type { DetectedPattern } from "../scanner/patterns.js";

function buildPrompt(
  recommendations: ToolRecommendation[],
  patterns: DetectedPattern[]
): string {
  const patternsContext = patterns
    .map(
      (p) =>
        `- ${p.label}: ${p.frequency} occurrences across ${p.projects.length} project(s)`
    )
    .join("\n");

  const toolsContext = recommendations
    .map(
      (r) =>
        `- ${r.name} (${r.type}): matches patterns [${r.matchedPatterns.map((p) => p.category).join(", ")}]. Default description: "${r.sellDescription}"`
    )
    .join("\n");

  return `You are writing compelling 2-sentence descriptions for developer tool recommendations. These descriptions should focus on the HUMAN SUFFERING that gets eliminated, not technical features. Be specific and vivid about the annoying manual process that goes away.

The user's actual workflow patterns (from their Claude Code session logs):
${patternsContext}

Tools to describe:
${toolsContext}

For each tool, write a 2-sentence description that:
1. Names the specific painful manual process it eliminates (based on the user's actual patterns)
2. Explains what the agent now owns end-to-end

Respond ONLY with a JSON array of objects with "id" and "description" fields. No markdown, no explanation.`;
}

export async function generateDescriptions(
  recommendations: ToolRecommendation[],
  patterns: DetectedPattern[]
): Promise<Map<string, string>> {
  const descriptions = new Map<string, string>();

  if (recommendations.length === 0) {
    return descriptions;
  }

  try {
    // Check if claude CLI is available
    execSync("which claude", { stdio: "pipe" });
  } catch {
    // claude CLI not available, return empty (will use template fallbacks)
    return descriptions;
  }

  try {
    const prompt = buildPrompt(recommendations, patterns);

    // Pipe to claude -p with a timeout
    const result = execSync(
      `echo ${JSON.stringify(prompt)} | claude -p --output-format json`,
      {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Parse the response - claude outputs JSON with a "result" field
    let parsed: Array<{ id: string; description: string }>;
    try {
      const response = JSON.parse(result);
      const content = response.result || response.content || result;
      // Try to extract JSON array from the response
      const jsonMatch =
        typeof content === "string"
          ? content.match(/\[[\s\S]*\]/)
          : null;
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else if (Array.isArray(content)) {
        parsed = content;
      } else {
        return descriptions;
      }
    } catch {
      // Try parsing raw result as JSON array
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return descriptions;
      }
    }

    for (const item of parsed) {
      if (item.id && item.description) {
        descriptions.set(item.id, item.description);
      }
    }
  } catch {
    // AI generation failed, will use template fallbacks
  }

  return descriptions;
}
