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

const SOURCE_LABELS: Record<string, string> = {
  "global-mcp": "global",
  "project-mcp": "project",
  permission: "permissions",
  plugin: "plugin",
};

export function RecommendationCard({
  recommendation: rec,
  rank,
}: RecommendationCardProps) {
  const typeLabel = TYPE_LABELS[rec.type] || rec.type;
  const isInstalled = !!rec.alreadyInstalled;
  const hasEvidence = rec.projectEvidence.length > 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {"  "}
        <Text bold color={isInstalled ? "green" : "cyan"}>
          #{rank}
        </Text>
        <Text bold> {rec.name}</Text>
        <Text dimColor> ({typeLabel})</Text>
        {isInstalled && (
          <Text color="green">
            {" "}
            [installed
            {rec.alreadyInstalled!.source
              ? ` via ${SOURCE_LABELS[rec.alreadyInstalled!.source] || rec.alreadyInstalled!.source}`
              : ""}
            {rec.alreadyInstalled!.project
              ? ` in ${rec.alreadyInstalled!.project}`
              : ""}
            ]
          </Text>
        )}
      </Text>

      <Text> </Text>
      <ScoreBar label="Handoff Index" score={rec.workflowOwnership} />
      <ScoreBar label="Time Reclaimed" score={rec.painEliminated} />
      <ScoreBar label="Agent Readiness" score={rec.agentReadiness} />
      <Text> </Text>

      <Text>
        {"  "}
        <Text italic color="white">
          &quot;{rec.sellDescription}&quot;
        </Text>
      </Text>
      <Text> </Text>

      {/* Domain-specific evidence — only show top 1 project with relevant signals */}
      {hasEvidence && (
        <Box flexDirection="column">
          {rec.projectEvidence.slice(0, 1).map((pe, i) => (
            <Box key={i} flexDirection="column">
              <Text>
                {"  "}
                <Text dimColor>Evidence from </Text>
                <Text color="magenta" bold>{pe.project}</Text>
                <Text dimColor>:</Text>
              </Text>
              {pe.yoyoFiles.slice(0, 2).map((yf, j) => (
                <Text key={`yf-${j}`}>
                  {"    "}
                  <Text color="yellow">{"<>"}</Text>
                  <Text> {yf}</Text>
                </Text>
              ))}
              {pe.repeatedCommands.slice(0, 2).map((rc, j) => (
                <Text key={`rc-${j}`}>
                  {"    "}
                  <Text color="yellow">{"#"}</Text>
                  <Text> {rc}</Text>
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      )}

      {/* Fallback: pattern labels when no specific evidence */}
      {!hasEvidence && (
        <Text>
          {"  "}
          <Text dimColor>Matched: </Text>
          <Text>{rec.matchedPatterns.map((p) => p.label).join(", ")}</Text>
        </Text>
      )}

      {/* Projects */}
      {rec.projects.length > 0 && (
        <Text>
          {"  "}
          <Text dimColor>Projects: </Text>
          <Text color="magenta">{rec.projects.join(", ")}</Text>
        </Text>
      )}

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

      {!isInstalled && (
        <Text>
          {"  "}
          <Text dimColor>Install: </Text>
          <Text color="green">{rec.installCommand}</Text>
        </Text>
      )}

      <Text dimColor>
        {"  "}
        {"─".repeat(56)}
      </Text>
    </Box>
  );
}
