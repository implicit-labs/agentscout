import React from "react";
import { Box, Text } from "ink";
import { ScoreBar } from "./ScoreBar.js";
import type { ToolRecommendation } from "../analyzer/matcher.js";

interface RecommendationCardProps {
  recommendation: ToolRecommendation;
  rank: number;
}

const TYPE_LABELS: Record<string, string> = {
  mcp: "MCP Server",
  cli: "CLI Tool",
  package: "Package",
};

export function RecommendationCard({
  recommendation: rec,
  rank,
}: RecommendationCardProps) {
  const typeLabel = TYPE_LABELS[rec.type] || rec.type;
  const patterns = rec.matchedPatterns
    .map((p) => p.label)
    .join(", ");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {"  "}
        <Text bold color="cyan">
          #{rank}
        </Text>
        <Text bold> {rec.name}</Text>
        <Text dimColor> ({typeLabel})</Text>
      </Text>

      <Text> </Text>
      <ScoreBar label="Workflow Ownership" score={rec.workflowOwnership} />
      <ScoreBar label="Pain Eliminated" score={rec.painEliminated} />
      <ScoreBar label="Agent Readiness" score={rec.agentReadiness} />
      <Text> </Text>

      <Text>
        {"  "}
        <Text italic color="white">
          &quot;{rec.sellDescription}&quot;
        </Text>
      </Text>
      <Text> </Text>

      <Text>
        {"  "}
        <Text dimColor>Matched: </Text>
        <Text>{patterns}</Text>
      </Text>

      {rec.meta.stars > 0 && (
        <Text>
          {"  "}
          <Text dimColor>Trust: </Text>
          <Text>
            {rec.meta.stars.toLocaleString()} stars
          </Text>
          <Text dimColor> | </Text>
          <Text>
            Permissions: {rec.meta.permissions}
          </Text>
        </Text>
      )}

      <Text>
        {"  "}
        <Text dimColor>Install: </Text>
        <Text color="green">{rec.installCommand}</Text>
      </Text>

      <Text dimColor>
        {"  "}
        {"─".repeat(56)}
      </Text>
    </Box>
  );
}
