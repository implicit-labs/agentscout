import React from "react";
import { Box, Text } from "ink";
import { RecommendationCard } from "./RecommendationCard.js";
import { DiagnosisSection } from "./DiagnosisSection.js";
import pkg from "../../package.json" with { type: "json" };
import type { ToolRecommendation } from "../analyzer/matcher.js";
import type { DetectedPattern } from "../scanner/patterns.js";
import type { ScanResult } from "../scanner/sessions.js";
import type { InstalledTool } from "../scanner/installed.js";
import type { WorkflowSignal } from "../scanner/signals.js";
import type { RepoMetadata } from "../scanner/github.js";
import type { ReadinessBreakdown } from "../analyzer/readiness.js";
import type { Diagnosis, LLMDiagnosisMeta, LLMDiagnosisResult } from "../analyzer/diagnosis.js";

interface ReportProps {
  scanResult: ScanResult;
  patterns: DetectedPattern[];
  installedTools: InstalledTool[];
  signals?: WorkflowSignal[];
  githubData?: Map<string, RepoMetadata>;
  readinessData?: Map<string, ReadinessBreakdown>;
  // Diagnosis (the main event)
  diagnosis: Diagnosis;
  llmDiagnosis?: LLMDiagnosisResult | null;
  llmDiagnosisMeta?: LLMDiagnosisMeta | null;
  // Tool recommendations
  recommendations?: ToolRecommendation[];
}

const SOURCE_LABELS: Record<string, string> = {
  "global-mcp": "global",
  "project-mcp": "project",
  permission: "permissions",
  plugin: "plugin",
};

export function Report({
  scanResult,
  patterns,
  installedTools,
  signals,
  githubData,
  readinessData,
  diagnosis,
  llmDiagnosis,
  llmDiagnosisMeta,
  recommendations,
}: ReportProps) {
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

      {/* ═══ DIAGNOSIS (the main event) ═══ */}
      <Text dimColor>
        {"  "}
        {"═".repeat(56)}
      </Text>
      <Text> </Text>

      <DiagnosisSection
        diagnosis={diagnosis}
        llmResult={llmDiagnosis}
        llmMeta={llmDiagnosisMeta}
      />

      {/* ═══ RECOMMENDATIONS ═══ */}
      <Text> </Text>
      <Text dimColor>
        {"  "}
        {"═".repeat(56)}
      </Text>
      <Text> </Text>

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

      {/* Footer */}
      <Text> </Text>
      <Text dimColor>
        {"  "}AgentScout v{pkg.version} | https://agentscout.polsia.app
      </Text>
      <Text> </Text>
    </Box>
  );
}
