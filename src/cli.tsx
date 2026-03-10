import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import { Spinner } from "./ui/Spinner.js";
import { Report } from "./ui/Report.js";
import { scanSessions } from "./scanner/sessions.js";
import { detectPatterns } from "./scanner/patterns.js";
import { matchToolsToPatterns } from "./analyzer/matcher.js";
import {
  analyzeWithClaude,
  type AIRecommendation,
} from "./analyzer/claude-pipe.js";
import {
  discoverInstalledTools,
  type InstalledTool,
} from "./scanner/installed.js";
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
  | "analyzing"
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
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [aiRecommendations, setAiRecommendations] = useState<
    AIRecommendation[]
  >([]);
  const [signals, setSignals] = useState<WorkflowSignal[]>([]);
  const [githubData, setGithubData] = useState<Map<string, RepoMetadata>>(new Map());
  const [readinessData, setReadinessData] = useState<Map<string, ReadinessBreakdown>>(new Map());
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function run() {
      try {
        // Phase 1: Scan sessions + discover installed tools + GitHub metadata in parallel
        setPhase("scanning");
        const [scan, installed, github] = await Promise.all([
          scanSessions(),
          discoverInstalledTools(),
          enrichWithGitHub(toolsCatalog.map((t) => ({ id: t.id, url: t.url }))),
        ]);
        setScanResult(scan);
        setInstalledTools(installed);
        setGithubData(github);

        // Compute readiness from combined signals
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

        // Detect patterns (needed for fallback + stats display)
        const detected = detectPatterns(scan);
        setPatterns(detected);

        // Detect workflow signals (frustration, retry loops, yoyo files, etc.)
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

        // Phase 2: AI analysis (the real deal)
        setPhase("analyzing");
        const aiResult = await analyzeWithClaude(scan, installed, detectedSignals);

        if (aiResult) {
          // AI analysis succeeded — use it
          setAiInsights(aiResult.insights);
          setAiRecommendations(aiResult.recommendations);
        } else {
          // Fallback to regex-based matching
          const matched = matchToolsToPatterns(detected, installed);
          setRecommendations(matched);
        }

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

  if (phase === "done" && scanResult) {
    return (
      <Report
        scanResult={scanResult}
        patterns={patterns}
        installedTools={installedTools}
        signals={signals}
        githubData={githubData}
        readinessData={readinessData}
        aiInsights={aiInsights.length > 0 ? aiInsights : undefined}
        aiRecommendations={
          aiRecommendations.length > 0 ? aiRecommendations : undefined
        }
        recommendations={
          recommendations.length > 0 ? recommendations : undefined
        }
      />
    );
  }

  const PHASE_LABELS: Record<string, string> = {
    scanning: "Scanning Claude Code sessions...",
    analyzing:
      "Analyzing your workflow with Claude (this may take a minute)...",
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

console.error("[agentscout] Starting CLI (build includes workflow signals)...");
render(<App />);
