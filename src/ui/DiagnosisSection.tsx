import React from "react";
import { Box, Text } from "ink";
import type { Diagnosis, LLMDiagnosisMeta, LLMDiagnosisResult } from "../analyzer/diagnosis.js";

interface DiagnosisSectionProps {
  diagnosis: Diagnosis;
  llmResult?: LLMDiagnosisResult | null;
  llmMeta?: LLMDiagnosisMeta | null;
}

const SEV_COLOR: Record<string, string> = {
  critical: "red",
  high: "red",
  med: "yellow",
  low: "white",
};

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function providerLabel(llmMeta: LLMDiagnosisMeta | null | undefined): string {
  return llmMeta?.source === "claude-sdk" ? "Claude Agent SDK" : "Claude CLI";
}

function commandLabel(llmMeta: LLMDiagnosisMeta | null | undefined): string {
  return llmMeta?.source === "claude-sdk"
    ? "Claude Agent SDK query() (tools disabled, settings isolated)"
    : "claude -p --output-format json (multi-pass)";
}

function formatStatusLine(llmMeta: LLMDiagnosisMeta | null | undefined, hasLLM: boolean): string {
  if (hasLLM && llmMeta) {
    if (llmMeta.resultMode === "project-fallback") {
      return `Source: ${providerLabel(llmMeta)} project extractions + local synthesis (${formatSeconds(llmMeta.durationMs)})`;
    }
    return `Source: ${providerLabel(llmMeta)} (${formatSeconds(llmMeta.durationMs)})`;
  }

  if (!llmMeta) {
    return "Source: heuristic diagnosis";
  }

  if (llmMeta.status === "timeout") {
    return `Source: heuristic fallback. ${providerLabel(llmMeta)} timed out after ${(llmMeta.timeoutMs / 1000).toFixed(1)}s`;
  }

  if (llmMeta.status === "unavailable") {
    return llmMeta.source === "claude-sdk"
      ? "Source: heuristic fallback. Claude Agent SDK unavailable"
      : "Source: heuristic fallback. Claude CLI not found in PATH";
  }

  if (llmMeta.status === "error") {
    return `Source: heuristic fallback. ${providerLabel(llmMeta)} failed${llmMeta.error ? `: ${llmMeta.error}` : ""}`;
  }

  return "Source: heuristic diagnosis";
}

function formatEngineStatus(llmMeta: LLMDiagnosisMeta | null | undefined, hasLLM: boolean): string {
  if (hasLLM && llmMeta) {
    return llmMeta.resultMode === "project-fallback"
      ? "Result: project extractions succeeded; synthesized locally"
      : "Result: success";
  }
  if (!llmMeta) return "Result: heuristic only";
  if (llmMeta.status === "timeout") {
    return `Result: timed out after ${formatSeconds(llmMeta.timeoutMs)}; showing heuristic fallback`;
  }
  if (llmMeta.status === "unavailable") return `Result: ${providerLabel(llmMeta)} unavailable; showing heuristic fallback`;
  if (llmMeta.status === "error") return `Result: ${providerLabel(llmMeta)} failed; showing heuristic fallback`;
  return "Result: heuristic only";
}

function summarizeStages(llmMeta: LLMDiagnosisMeta): string {
  const counts = {
    success: 0,
    timeout: 0,
    error: 0,
    skipped: 0,
  };
  for (const stage of llmMeta.stages) counts[stage.status]++;
  return `Stages: ${llmMeta.stages.length} total | ${counts.success} success | ${counts.timeout} timeout | ${counts.error} error`;
}

export function DiagnosisSection({ diagnosis, llmResult, llmMeta }: DiagnosisSectionProps) {
  const hasLLM = !!llmResult;
  const sourceLabel = hasLLM
    ? llmMeta?.resultMode === "project-fallback"
      ? "LLM project extractions"
      : `LLM via ${providerLabel(llmMeta)}`
    : "heuristic fallback";
  const failedStages = llmMeta?.stages.filter((stage) => stage.status !== "success") || [];
  const commodityToIgnore = llmResult?.meta?.commodityToIgnore || [];
  const judgmentBoundaries = llmResult?.meta?.judgmentBoundaries || [];
  const confidenceNotes = llmResult?.meta?.confidenceNotes || [];

  return (
    <Box flexDirection="column">
      {/* Tech Stack */}
      {diagnosis.techStack.length > 0 && (
        <Box marginBottom={1}>
          <Text>
            {"  "}
            <Text dimColor>Tech stack: </Text>
            <Text>{diagnosis.techStack.join(", ")}</Text>
          </Text>
        </Box>
      )}

      <Text bold>
        {"  "}Workflow Diagnosis ({sourceLabel})
      </Text>
      <Text dimColor>
        {"  "}What you're doing manually that your agent should own
      </Text>
      <Text dimColor>
        {"  "}{formatStatusLine(llmMeta, hasLLM)}
      </Text>
      <Text> </Text>

      {llmMeta && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>
            {"  "}Diagnosis Engine
          </Text>
          <Text>
            {"  "}
            <Text dimColor>Command: </Text>
            <Text>{commandLabel(llmMeta)}</Text>
          </Text>
          <Text>
            {"  "}
            <Text dimColor>{formatEngineStatus(llmMeta, hasLLM)}</Text>
          </Text>
          <Text>
            {"  "}
            <Text dimColor>Runtime: </Text>
            <Text>{formatSeconds(llmMeta.durationMs)}</Text>
            <Text dimColor> | Prompt: </Text>
            <Text>{llmMeta.promptChars.toLocaleString()} chars</Text>
            <Text dimColor> | Output: </Text>
            <Text>{llmMeta.outputChars.toLocaleString()} chars</Text>
            <Text dimColor> | Exit code: </Text>
            <Text>{llmMeta.exitCode ?? "n/a"}</Text>
          </Text>
          <Text>
            {"  "}
            <Text dimColor>Projects analyzed: </Text>
            <Text>{llmMeta.projectCountSucceeded}</Text>
            <Text dimColor> / </Text>
            <Text>{llmMeta.projectCountRequested}</Text>
          </Text>
          {llmMeta.selectedProjects.length > 0 && (
            <Text wrap="wrap">
              {"  "}
              <Text dimColor>Selected projects: </Text>
              <Text>{llmMeta.selectedProjects.join(", ")}</Text>
            </Text>
          )}
          <Text>
            {"  "}
            <Text dimColor>{summarizeStages(llmMeta)}</Text>
          </Text>
          {llmMeta.error && (
            <Text wrap="wrap">
              {"  "}
              <Text dimColor>Error: </Text>
              <Text>{llmMeta.error}</Text>
            </Text>
          )}
          <Text wrap="wrap">
            {"  "}
            <Text dimColor>stderr: </Text>
            <Text>{llmMeta.stderrPreview || "none"}</Text>
          </Text>
          {failedStages.slice(0, 8).map((stage) => (
            <Box key={stage.name} flexDirection="column">
              <Text wrap="wrap">
                {"  "}
                <Text dimColor>Stage {stage.name}: </Text>
                <Text>{stage.status}</Text>
                <Text dimColor> ({formatSeconds(stage.durationMs)}, {stage.promptChars.toLocaleString()} chars)</Text>
                {stage.error ? <Text>{` — ${stage.error}`}</Text> : null}
              </Text>
              {(stage.model || stage.resultSubtype || stage.stopReason || stage.numTurns !== undefined) && (
                <Text wrap="wrap">
                  {"  "}
                  <Text dimColor>  model: </Text>
                  <Text>{stage.model || "n/a"}</Text>
                  <Text dimColor> | result: </Text>
                  <Text>{stage.resultSubtype || "n/a"}</Text>
                  <Text dimColor> | stop: </Text>
                  <Text>{stage.stopReason || "n/a"}</Text>
                  <Text dimColor> | turns: </Text>
                  <Text>{stage.numTurns ?? "n/a"}</Text>
                </Text>
              )}
              {(stage.firstEventMs !== undefined || stage.firstAssistantMs !== undefined || stage.resultMs !== undefined) && (
                <Text wrap="wrap">
                  {"  "}
                  <Text dimColor>  stream: first event </Text>
                  <Text>{stage.firstEventMs != null ? formatSeconds(stage.firstEventMs) : "none"}</Text>
                  <Text dimColor>, first assistant </Text>
                  <Text>{stage.firstAssistantMs != null ? formatSeconds(stage.firstAssistantMs) : "none"}</Text>
                  <Text dimColor>, result </Text>
                  <Text>{stage.resultMs != null ? formatSeconds(stage.resultMs) : "none"}</Text>
                </Text>
              )}
              {stage.eventSummary && (
                <Text wrap="wrap">
                  {"  "}
                  <Text dimColor>  events: </Text>
                  <Text>{stage.eventSummary}</Text>
                </Text>
              )}
              {stage.tracePreview && (
                <Text wrap="wrap">
                  {"  "}
                  <Text dimColor>  trace: </Text>
                  <Text>{stage.tracePreview}</Text>
                </Text>
              )}
              {stage.assistantPreview && (
                <Text wrap="wrap">
                  {"  "}
                  <Text dimColor>  assistant: </Text>
                  <Text>{stage.assistantPreview}</Text>
                </Text>
              )}
            </Box>
          ))}
          <Text> </Text>
        </Box>
      )}

      {hasLLM ? (
        /* LLM-enhanced analysis */
        <Box flexDirection="column">
          {llmResult.step1_surface.map((proj, i) => {
            const fixableInteractions = llmResult.step2_fixableInteractions.filter(
              (interaction) => interaction.project === proj.project
            );

            if (fixableInteractions.length === 0) return null;

            return (
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Text>
                  {"  "}
                  <Text bold color="magenta">{proj.project}</Text>
                  <Text dimColor> — {proj.workflow}</Text>
                </Text>
                <Text>
                  {"    "}
                  <Text dimColor>{proj.dominantActivities}</Text>
                </Text>
                {proj.engineerPerspective && (
                  <Text wrap="wrap">
                    {"    "}
                  <Text color="cyan">{proj.engineerPerspective}</Text>
                  </Text>
                )}

                {fixableInteractions.slice(0, 3).map((interaction, j) => (
                  <Box key={j} flexDirection="column">
                    <Text>
                      {"    "}
                      <Text color={SEV_COLOR[interaction.severity] || "white"} bold={interaction.severity === "critical" || interaction.severity === "high"}>
                        [{interaction.severity.toUpperCase()}]
                      </Text>
                      <Text bold> {interaction.title}</Text>
                      <Text dimColor> — </Text>
                      <Text italic>{interaction.humanRole}</Text>
                    </Text>
                    <Text wrap="wrap">
                      {"      "}
                      <Text>{interaction.description}</Text>
                    </Text>
                    <Text wrap="wrap">
                      {"      "}
                      <Text dimColor>Surface: </Text>
                      <Text>{interaction.interactionSurface}</Text>
                      <Text dimColor> | Permission: </Text>
                      <Text>{interaction.minimalPermission}</Text>
                      <Text dimColor> | Success: </Text>
                      <Text>{interaction.observableSuccess}</Text>
                    </Text>
                    <Text wrap="wrap">
                      {"      "}
                      <Text dimColor>Contract: </Text>
                      <Text>{interaction.brokenContract}</Text>
                    </Text>
                    <Text wrap="wrap">
                      {"      "}
                      <Text dimColor>Why not just judgment: </Text>
                      <Text>{interaction.whyNotJustJudgment}</Text>
                    </Text>
                  </Box>
                ))}
              </Box>
            );
          })}
        </Box>
      ) : (
        /* Computational diagnosis with workflow loops */
        <Box flexDirection="column">
          {diagnosis.projects.slice(0, 8).map((proj, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text>
                {"  "}
                <Text bold color="magenta">{proj.name}</Text>
                <Text dimColor> — {proj.workflow}</Text>
                <Text dimColor> ({proj.sessionCount} sessions)</Text>
              </Text>

              {proj.workflowLoops.map((loop, j) => (
                <Box key={j} flexDirection="column">
                  <Text>
                    {"    "}
                    <Text color={SEV_COLOR[loop.severity] || "white"} bold={loop.severity === "critical" || loop.severity === "high"}>
                      [{loop.severity.toUpperCase()}]
                    </Text>
                    <Text bold> {loop.name}</Text>
                    <Text dimColor> — </Text>
                    <Text italic>{loop.humanRole}</Text>
                  </Text>
                  <Text wrap="wrap">
                    {"      "}
                    <Text>{loop.description}</Text>
                  </Text>
                  <Text>
                    {"      "}
                    <Text dimColor>Gap: {loop.agentGap}</Text>
                  </Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}

      {hasLLM && commodityToIgnore.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text> </Text>
          <Text bold>
            {"  "}Commodity To Ignore
          </Text>
          <Text> </Text>
          {commodityToIgnore.slice(0, 5).map((item, i) => (
            <Text key={i} wrap="wrap">
              {"  "}
              <Text dimColor>- </Text>
              <Text dimColor>{item}</Text>
            </Text>
          ))}
        </Box>
      )}

      {hasLLM && judgmentBoundaries.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text> </Text>
          <Text bold>
            {"  "}Judgment Boundaries
          </Text>
          <Text> </Text>
          {judgmentBoundaries.slice(0, 5).map((item, i) => (
            <Text key={i} wrap="wrap">
              {"  "}
              <Text dimColor>- </Text>
              <Text dimColor>{item}</Text>
            </Text>
          ))}
        </Box>
      )}

      {hasLLM && confidenceNotes.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text> </Text>
          <Text bold>
            {"  "}Confidence Notes
          </Text>
          <Text> </Text>
          {confidenceNotes.slice(0, 4).map((item, i) => (
            <Text key={i} wrap="wrap">
              {"  "}
              <Text dimColor>- </Text>
              <Text dimColor>{item}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Systemic Issues */}
      {(hasLLM ? llmResult.step4_crossProject : diagnosis.systemicIssues).length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text> </Text>
          <Text bold>
            {"  "}Systemic Issues
          </Text>
          <Text> </Text>
          {(hasLLM ? llmResult.step4_crossProject : diagnosis.systemicIssues).map((issue, i) => (
            <Text key={i} wrap="wrap">
              {"  "}
              <Text color="yellow">{">"}</Text>
              <Text> {issue}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Top Ranked Problems */}
      <Text> </Text>
      <Text bold>
        {"  "}{hasLLM ? "Top Fixable Interactions (ranked by impact)" : "Top Problems (ranked by impact)"}
      </Text>
      <Text> </Text>

      {(hasLLM ? llmResult.step5_ranked : diagnosis.topProblems).map((problem, i) => {
        const sev = problem.severity as keyof typeof SEV_COLOR;
        return (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text>
              {"  "}
              <Text bold color={SEV_COLOR[sev] || "white"}>
                #{problem.rank}
              </Text>
              <Text bold> {problem.title}</Text>
            </Text>

            <Text wrap="wrap">
              {"    "}
              <Text>{problem.description}</Text>
            </Text>

            <Text>
              {"    "}
              <Text dimColor>Projects: </Text>
              <Text color="magenta">{problem.projects.join(", ")}</Text>
            </Text>

            {hasLLM && "toolArchetype" in problem && "minimalPermission" in problem && (
              <Text wrap="wrap">
                {"    "}
                <Text dimColor>Archetype: </Text>
                <Text>{problem.toolArchetype}</Text>
                <Text dimColor> | Permission: </Text>
                <Text>{problem.minimalPermission}</Text>
              </Text>
            )}

            <Text>
              {"    "}
              <Text color="green" italic>{problem.ifFixed}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
