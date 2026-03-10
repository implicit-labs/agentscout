import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import { Spinner } from "./ui/Spinner.js";
import { Report } from "./ui/Report.js";
import { scanSessions } from "./scanner/sessions.js";
import { detectPatterns } from "./scanner/patterns.js";
import { matchToolsToPatterns } from "./analyzer/matcher.js";
import { generateDescriptions } from "./analyzer/claude-pipe.js";
import {
  discoverInstalledTools,
  type InstalledTool,
} from "./scanner/installed.js";
import type { ScanResult } from "./scanner/sessions.js";
import type { DetectedPattern } from "./scanner/patterns.js";
import type { ToolRecommendation } from "./analyzer/matcher.js";

type Phase =
  | "scanning"
  | "detecting"
  | "matching"
  | "describing"
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
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function run() {
      try {
        // Phase 1: Scan sessions + discover installed tools in parallel
        setPhase("scanning");
        const [scan, installed] = await Promise.all([
          scanSessions(),
          discoverInstalledTools(),
        ]);
        setScanResult(scan);
        setInstalledTools(installed);

        if (scan.totalProjects === 0) {
          setError(
            "No Claude Code sessions found in ~/.claude/projects/. Use Claude Code for a while first, then run AgentScout again."
          );
          setPhase("error");
          return;
        }

        // Phase 2: Detect patterns
        setPhase("detecting");
        const detected = detectPatterns(scan);
        setPatterns(detected);

        // Phase 3: Match to tools (with installed tool awareness)
        setPhase("matching");
        const matched = matchToolsToPatterns(detected, installed);

        // Phase 4: Generate AI descriptions (only for new recommendations)
        const newRecs = matched.filter((r) => !r.alreadyInstalled);
        if (newRecs.length > 0) {
          setPhase("describing");
          const descriptions = await generateDescriptions(
            newRecs.slice(0, 10),
            detected
          );

          // Apply AI-generated descriptions where available
          for (const rec of matched) {
            const aiDesc = descriptions.get(rec.id);
            if (aiDesc) {
              rec.sellDescription = aiDesc;
            }
          }
        }

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

  if (phase === "done" && scanResult) {
    return (
      <Report
        scanResult={scanResult}
        patterns={patterns}
        recommendations={recommendations}
        installedTools={installedTools}
      />
    );
  }

  const PHASE_LABELS: Record<string, string> = {
    scanning: "Scanning Claude Code sessions...",
    detecting: "Identifying manual work patterns...",
    matching: "Finding tools to automate your workflow...",
    describing: "Crafting recommendations (via claude)...",
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

render(<App />);
