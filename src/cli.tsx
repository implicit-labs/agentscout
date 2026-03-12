import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import { Spinner } from "./ui/Spinner.js";
import { Report } from "./ui/Report.js";
import { scanSessions } from "./scanner/sessions.js";
import { detectPatterns } from "./scanner/patterns.js";
import { matchToolsToPatterns } from "./analyzer/matcher.js";
import {
  computeDiagnosis,
  enhanceWithLLM,
  buildDiagnosisData,
  synthesizeFromExternalAnswers,
  type Diagnosis,
  type LLMDiagnosisMeta,
  type LLMDiagnosisResult,
} from "./analyzer/diagnosis.js";
import {
  discoverInstalledTools,
  type InstalledTool,
} from "./scanner/installed.js";
import { buildToolingInventory } from "./scanner/inventory.js";
import {
  detectWorkflowSignals,
  type WorkflowSignal,
} from "./scanner/signals.js";
import {
  enrichWithGitHub,
  type RepoMetadata,
} from "./scanner/github.js";
import { computeReadiness, type ReadinessBreakdown } from "./analyzer/readiness.js";
import toolsCatalog from "./catalog/tools.json" with { type: "json" };
import type { ScanResult } from "./scanner/sessions.js";
import type { DetectedPattern } from "./scanner/patterns.js";
import type { ToolRecommendation } from "./analyzer/matcher.js";

type Phase =
  | "scanning"
  | "diagnosing"
  | "done"
  | "error";

function App() {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [patterns, setPatterns] = useState<DetectedPattern[]>([]);
  const [recommendations, setRecommendations] = useState<
    ToolRecommendation[]
  >([]);
  const [installedTools, setInstalledTools] = useState<InstalledTool[]>([]);
  const [signals, setSignals] = useState<WorkflowSignal[]>([]);
  const [githubData, setGithubData] = useState<Map<string, RepoMetadata>>(new Map());
  const [readinessData, setReadinessData] = useState<Map<string, ReadinessBreakdown>>(new Map());
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [llmDiagnosis, setLlmDiagnosis] = useState<LLMDiagnosisResult | null>(null);
  const [llmDiagnosisMeta, setLlmDiagnosisMeta] = useState<LLMDiagnosisMeta | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function run() {
      try {
        // Phase 1: Scan sessions + discover installed tools + GitHub metadata
        setPhase("scanning");
        const [scan, installed, github] = await Promise.all([
          scanSessions(),
          discoverInstalledTools(),
          enrichWithGitHub(toolsCatalog.map((t) => ({ id: t.id, url: t.url }))),
        ]);
        setScanResult(scan);
        setInstalledTools(installed);
        setGithubData(github);

        // Compute readiness
        const readiness = new Map<string, ReadinessBreakdown>();
        for (const tool of toolsCatalog) {
          const ghMeta = github.get(tool.id);
          readiness.set(tool.id, computeReadiness(tool.meta, ghMeta));
        }
        setReadinessData(readiness);

        if (scan.totalProjects === 0) {
          setError(
            "No Claude Code sessions found in ~/.claude/projects/. Use Claude Code for a while first, then run AgentScout again."
          );
          setPhase("error");
          return;
        }

        // Detect patterns
        const detected = detectPatterns(scan);
        setPatterns(detected);

        // Detect workflow signals
        let totalRawToolUses = 0;
        let totalParsedMsgs = 0;
        for (const p of scan.projects) {
          totalRawToolUses += p.rawToolUses.length;
          totalParsedMsgs += p.parsedUserMessages.length;
        }
        console.error(`[agentscout] Raw data: ${totalRawToolUses} tool uses, ${totalParsedMsgs} parsed messages`);

        const sessionSignalData = scan.projects.map((p) => ({
          toolUses: p.rawToolUses,
          userMessages: p.parsedUserMessages,
          projectName: p.projectName,
        }));
        const detectedSignals = detectWorkflowSignals(sessionSignalData);
        setSignals(detectedSignals);
        console.error(`[agentscout] Detected ${detectedSignals.length} workflow signals`);

        // Phase 2: DIAGNOSIS (the main event)
        setPhase("diagnosing");

        // Step A: Computational diagnosis (instant, always works)
        const computedDiag = computeDiagnosis(scan, detectedSignals, installed);
        setDiagnosis(computedDiag);
        console.error(`[agentscout] Computed diagnosis: ${computedDiag.projects.length} projects, ${computedDiag.topProblems.length} ranked problems`);

        // Step B: LLM-enhanced diagnosis (optional, ~1-2 min)
        const llmRun = await enhanceWithLLM(scan, detectedSignals, computedDiag, installed);
        setLlmDiagnosisMeta(llmRun.meta);
        if (llmRun.result) {
          setLlmDiagnosis(llmRun.result);
          console.error(
            `[agentscout] LLM diagnosis: ${llmRun.result.step5_ranked.length} ranked problems in ${(llmRun.meta.durationMs / 1000).toFixed(1)}s`
          );
        } else {
          console.error(
            `[agentscout] LLM diagnosis unavailable (${llmRun.meta.status}), using computational diagnosis${llmRun.meta.error ? `: ${llmRun.meta.error}` : ""}`
          );
        }

        // Step C: Tool matching (regex-based, uses signals for evidence)
        const matched = matchToolsToPatterns(detected, installed, detectedSignals, scan);
        setRecommendations(matched);

        setPhase("done");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Unknown error occurred"
        );
        setPhase("error");
      }
    }

    run();
  }, []);

  if (phase === "error") {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text color="red">
          {"  "}Error: {error}
        </Text>
        <Text> </Text>
      </Box>
    );
  }

  if (phase === "done" && scanResult && diagnosis) {
    return (
      <Report
        scanResult={scanResult}
        patterns={patterns}
        installedTools={installedTools}
        signals={signals}
        githubData={githubData}
        readinessData={readinessData}
        diagnosis={diagnosis}
        llmDiagnosis={llmDiagnosis}
        llmDiagnosisMeta={llmDiagnosisMeta}
        recommendations={
          recommendations.length > 0 ? recommendations : undefined
        }
      />
    );
  }

  const PHASE_LABELS: Record<string, string> = {
    scanning: "Scanning Claude Code sessions...",
    diagnosing:
      "Diagnosing workflow breakdowns (this may take a minute)...",
  };

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text bold color="cyan">
        {"  "}AgentScout
      </Text>
      <Text dimColor>
        {"  "}Your agents should shop for their own tools.
      </Text>
      <Text> </Text>
      <Spinner label={PHASE_LABELS[phase] || "Working..."} />
      <Text> </Text>
    </Box>
  );
}

import pkg from "../package.json" with { type: "json" };

const args = process.argv.slice(2);

if (args.includes("--inventory")) {
  // Headless mode: output tooling inventory as JSON to stdout
  (async () => {
    console.error(`[agentscout] v${pkg.version} inventory mode`);
    const inventory = await buildToolingInventory();
    process.stdout.write(JSON.stringify(inventory, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (args.includes("--emit-prompts")) {
  // Headless mode: run scan + heuristic diagnosis, output prompts as JSON to stdout
  (async () => {
    console.error(`[agentscout] v${pkg.version} emit-prompts mode`);
    const [scan, installed] = await Promise.all([
      scanSessions(),
      discoverInstalledTools(),
    ]);
    if (scan.totalProjects === 0) {
      console.error("[agentscout] No sessions found");
      process.exit(1);
    }
    const sessionSignalData = scan.projects.map((p) => ({
      toolUses: p.rawToolUses,
      userMessages: p.parsedUserMessages,
      projectName: p.projectName,
    }));
    const detectedSignals = detectWorkflowSignals(sessionSignalData);
    const computedDiag = computeDiagnosis(scan, detectedSignals, installed);
    const { briefs, prompts } = buildDiagnosisData(scan, detectedSignals, computedDiag, installed);
    process.stdout.write(JSON.stringify({ briefs, prompts, projectCount: computedDiag.projects.length }, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (args.includes("--apply-answers")) {
  // Headless mode: read answers from stdin, synthesize, output full report JSON
  (async () => {
    console.error(`[agentscout] v${pkg.version} apply-answers mode`);
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(chunks.join("")) as { answers: { project: string; json: unknown }[] };

    const [scan, installed] = await Promise.all([
      scanSessions(),
      discoverInstalledTools(),
    ]);
    const sessionSignalData = scan.projects.map((p) => ({
      toolUses: p.rawToolUses,
      userMessages: p.parsedUserMessages,
      projectName: p.projectName,
    }));
    const detectedSignals = detectWorkflowSignals(sessionSignalData);
    const computedDiag = computeDiagnosis(scan, detectedSignals, installed);
    const llmRun = synthesizeFromExternalAnswers(computedDiag, input.answers);
    process.stdout.write(JSON.stringify(llmRun, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error(`[agentscout] v${pkg.version} starting...`);
  render(<App />);
}
