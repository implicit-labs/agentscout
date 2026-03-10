import React from "react";
import { Box, Text } from "ink";
import { RecommendationCard } from "./RecommendationCard.js";
import type { ToolRecommendation } from "../analyzer/matcher.js";
import type { AIRecommendation } from "../analyzer/claude-pipe.js";
import type { DetectedPattern } from "../scanner/patterns.js";
import type { ScanResult } from "../scanner/sessions.js";
import type { InstalledTool } from "../scanner/installed.js";
import { ScoreBar } from "./ScoreBar.js";

interface ReportProps {
  scanResult: ScanResult;
  patterns: DetectedPattern[];
  installedTools: InstalledTool[];
  // AI-powered analysis (preferred)
  aiInsights?: string[];
  aiRecommendations?: AIRecommendation[];
  // Fallback: regex-based
  recommendations?: ToolRecommendation[];
}

const SOURCE_LABELS: Record<string, string> = {
  "global-mcp": "global",
  "project-mcp": "project",
  permission: "permissions",
  plugin: "plugin",
};

function AIRecommendationCard({
  rec,
  rank,
}: {
  rec: AIRecommendation;
  rank: number;
}) {
  const TYPE_LABELS: Record<string, string> = {
    mcp: "MCP Server",
    cli: "CLI Tool",
    package: "Package",
  };
  const typeLabel = TYPE_LABELS[rec.type] || rec.type;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {"  "}
        <Text bold color={rec.alreadyInstalled ? "green" : "cyan"}>
          #{rank}
        </Text>
        <Text bold> {rec.name}</Text>
        <Text dimColor> ({typeLabel})</Text>
        {rec.alreadyInstalled && (
          <Text color="green"> [installed]</Text>
        )}
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

      {rec.projects && rec.projects.length > 0 && (
        <Text>
          {"  "}
          <Text dimColor>Projects: </Text>
          <Text color="magenta">{rec.projects.join(", ")}</Text>
        </Text>
      )}

      <Text>
        {"  "}
        <Text dimColor>Evidence: </Text>
        <Text>{rec.evidence}</Text>
      </Text>

      {rec.gotchas && rec.gotchas.length > 0 && (
        <Text>
          {"  "}
          <Text color="yellow">Gotchas: </Text>
          <Text>{rec.gotchas}</Text>
        </Text>
      )}

      {!rec.alreadyInstalled && (
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

export function Report({
  scanResult,
  patterns,
  installedTools,
  aiInsights,
  aiRecommendations,
  recommendations,
}: ReportProps) {
  const hasAI = aiRecommendations && aiRecommendations.length > 0;

  // Fallback separation for non-AI mode
  const installedRecs = recommendations?.filter((r) => r.alreadyInstalled) || [];
  const newRecs = recommendations?.filter((r) => !r.alreadyInstalled)?.slice(0, 10) || [];

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
          <Text dimColor>Analyzed:</Text>{" "}
          <Text bold>{scanResult.totalToolCalls.toLocaleString()}</Text>
          <Text> tool calls, </Text>
          <Text bold>{scanResult.totalBashCommands.toLocaleString()}</Text>
          <Text> bash commands</Text>
        </Text>
      </Box>

      {/* Current Toolbox */}
      {installedTools.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>
            {"  "}Current Toolbox:
          </Text>
          {installedTools.map((t, i) => (
            <Text key={`${t.name}-${i}`}>
              {"  "}
              <Text color="green">{"+"}</Text>
              <Text> {t.name}</Text>
              <Text dimColor>
                {" "}
                ({SOURCE_LABELS[t.source] || t.source}
                {t.project ? `, ${t.project}` : ""})
              </Text>
            </Text>
          ))}
        </Box>
      )}

      {/* AI Insights */}
      {hasAI && aiInsights && aiInsights.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>
            {"  "}Workflow Analysis:
          </Text>
          {aiInsights.map((insight, i) => (
            <Text key={i}>
              {"  "}
              <Text color="yellow">{">"}</Text>
              <Text> {insight}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Fallback: regex-detected patterns (only if no AI) */}
      {!hasAI && patterns.length > 0 && (
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

      {/* AI Recommendations */}
      {hasAI ? (
        <Box flexDirection="column">
          {/* Already installed that are relevant */}
          {aiRecommendations.filter((r) => r.alreadyInstalled).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>
                {"  "}Already Working For You
              </Text>
              <Text dimColor>
                {"  "}Tools you have that address detected patterns
              </Text>
              <Text> </Text>
              {aiRecommendations
                .filter((r) => r.alreadyInstalled)
                .map((rec, i) => (
                  <AIRecommendationCard
                    key={`installed-${i}`}
                    rec={rec}
                    rank={i + 1}
                  />
                ))}
            </Box>
          )}

          {/* New recommendations */}
          {aiRecommendations.filter((r) => !r.alreadyInstalled).length > 0 && (
            <Box flexDirection="column">
              <Text bold>
                {"  "}New Recommendations
              </Text>
              <Text dimColor>
                {"  "}Tools that would let your agent own more of your workflow
              </Text>
              <Text> </Text>
              {aiRecommendations
                .filter((r) => !r.alreadyInstalled)
                .map((rec, i) => (
                  <AIRecommendationCard
                    key={`new-${i}`}
                    rec={rec}
                    rank={i + 1}
                  />
                ))}
            </Box>
          )}
        </Box>
      ) : (
        /* Fallback: regex-based recommendations */
        <Box flexDirection="column">
          {installedRecs.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>
                {"  "}Already Working For You
              </Text>
              <Text> </Text>
              {installedRecs.map((rec, i) => (
                <RecommendationCard
                  key={rec.id}
                  recommendation={rec}
                  rank={i + 1}
                />
              ))}
            </Box>
          )}

          {newRecs.length > 0 ? (
            <Box flexDirection="column">
              <Text bold>
                {"  "}New Recommendations
              </Text>
              <Text dimColor>
                {"  "}Tools that would let your agent own more of your workflow
              </Text>
              <Text> </Text>
              {newRecs.map((rec, i) => (
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
                <Text color="green">No new recommendations.</Text>
              </Text>
            </Box>
          )}
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
