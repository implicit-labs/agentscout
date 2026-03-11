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

function formatStatusLine(llmMeta: LLMDiagnosisMeta | null | undefined, hasLLM: boolean): string {
  if (hasLLM && llmMeta) {
    return `Source: Claude CLI via claude -p (${formatSeconds(llmMeta.durationMs)})`;
  }

  if (!llmMeta) {
    return "Source: heuristic diagnosis";
  }

  if (llmMeta.status === "timeout") {
    return `Source: heuristic fallback. Claude CLI timed out after ${(llmMeta.timeoutMs / 1000).toFixed(1)}s`;
  }

  if (llmMeta.status === "unavailable") {
    return "Source: heuristic fallback. Claude CLI not found in PATH";
  }

  if (llmMeta.status === "error") {
    return `Source: heuristic fallback. Claude CLI failed${llmMeta.error ? `: ${llmMeta.error}` : ""}`;
  }

  return "Source: heuristic diagnosis";
}

function formatEngineStatus(llmMeta: LLMDiagnosisMeta | null | undefined, hasLLM: boolean): string {
  if (hasLLM && llmMeta) return "Result: success";
  if (!llmMeta) return "Result: heuristic only";
  if (llmMeta.status === "timeout") {
    return `Result: timed out after ${formatSeconds(llmMeta.timeoutMs)}; showing heuristic fallback`;
  }
  if (llmMeta.status === "unavailable") return "Result: Claude CLI unavailable; showing heuristic fallback";
  if (llmMeta.status === "error") return "Result: Claude CLI failed; showing heuristic fallback";
  return "Result: heuristic only";
}

export function DiagnosisSection({ diagnosis, llmResult, llmMeta }: DiagnosisSectionProps) {
  const hasLLM = !!llmResult;
  const sourceLabel = hasLLM ? "LLM via Claude CLI" : "heuristic fallback";

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
            <Text>claude -p --output-format json</Text>
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
          <Text> </Text>
        </Box>
      )}

      {hasLLM ? (
        /* LLM-enhanced analysis */
        <Box flexDirection="column">
          {llmResult.step1_surface.map((proj, i) => {
            const painPoints = llmResult.step2_painPoints.filter(
              (pp) => pp.project === proj.project
            );
            const rootCauses = llmResult.step3_rootCauses.filter(
              (rc) => painPoints.some((pp) =>
                rc.pain.toLowerCase().includes(proj.project.toLowerCase()) ||
                rc.pain.toLowerCase().includes(pp.pain.substring(0, 30).toLowerCase())
              )
            );

            if (painPoints.length === 0) return null;

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

                {painPoints.slice(0, 3).map((pp, j) => (
                  <Text key={j}>
                    {"    "}
                    <Text color={SEV_COLOR[pp.severity] || "white"} bold={pp.severity === "high"}>
                      [{pp.severity.toUpperCase()}]
                    </Text>
                    <Text> {pp.pain}</Text>
                  </Text>
                ))}

                {rootCauses.slice(0, 2).map((rc, j) => (
                  <Text key={`rc-${j}`}>
                    {"    "}
                    <Text dimColor>Why: </Text>
                    <Text color="cyan">{rc.rootCause}</Text>
                    <Text> — {rc.explanation}</Text>
                  </Text>
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
        {"  "}Top Problems (ranked by impact)
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
