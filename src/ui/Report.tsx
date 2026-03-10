import React from "react";
import { Box, Text } from "ink";
import { RecommendationCard } from "./RecommendationCard.js";
import type { ToolRecommendation } from "../analyzer/matcher.js";
import type { DetectedPattern } from "../scanner/patterns.js";
import type { ScanResult } from "../scanner/sessions.js";

interface ReportProps {
  scanResult: ScanResult;
  patterns: DetectedPattern[];
  recommendations: ToolRecommendation[];
}

export function Report({
  scanResult,
  patterns,
  recommendations,
}: ReportProps) {
  const topRecs = recommendations.slice(0, 10);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text> </Text>
      <Text bold color="cyan">
        {"  "}AgentScout Analysis Report
      </Text>
      <Text dimColor>
        {"  "}Your agents should shop for their own tools.
      </Text>
      <Text> </Text>

      {/* Scan Stats */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          {"  "}
          <Text dimColor>Scanned:</Text>{" "}
          <Text bold>{scanResult.totalProjects}</Text>
          <Text> projects, </Text>
          <Text bold>{scanResult.totalSessions}</Text>
          <Text> sessions</Text>
          <Text dimColor> ({(scanResult.scanDuration / 1000).toFixed(1)}s)</Text>
        </Text>
        <Text>
          {"  "}
          <Text dimColor>Found:</Text>{" "}
          <Text bold>{scanResult.totalToolCalls.toLocaleString()}</Text>
          <Text> tool calls, </Text>
          <Text bold>{scanResult.totalBashCommands.toLocaleString()}</Text>
          <Text> bash commands</Text>
        </Text>
      </Box>

      {/* Detected Patterns */}
      {patterns.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>
            {"  "}Manual Work Detected:
          </Text>
          {patterns.slice(0, 8).map((p) => (
            <Text key={p.category}>
              {"  "}
              <Text color="yellow">{">"}</Text>
              <Text> {p.label}</Text>
              <Text dimColor>
                {" "}
                ({p.frequency}x across {p.projects.length} project
                {p.projects.length > 1 ? "s" : ""})
              </Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Divider */}
      <Text dimColor>
        {"  "}
        {"═".repeat(56)}
      </Text>
      <Text> </Text>

      {/* Recommendations */}
      {topRecs.length > 0 ? (
        <Box flexDirection="column">
          <Text bold>
            {"  "}Recommendations
          </Text>
          <Text dimColor>
            {"  "}Tools that let your agent own more of your workflow
          </Text>
          <Text> </Text>
          {topRecs.map((rec, i) => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              rank={i + 1}
            />
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text>
            {"  "}
            <Text color="green">
              No obvious inefficiencies found.
            </Text>
          </Text>
          <Text dimColor>
            {"  "}Your agent workflow is already well-optimized, or you
            have very few sessions to analyze.
          </Text>
        </Box>
      )}

      {/* Footer */}
      <Text> </Text>
      <Text dimColor>
        {"  "}AgentScout v0.1.0 | https://agentscout.polsia.app
      </Text>
      <Text> </Text>
    </Box>
  );
}
