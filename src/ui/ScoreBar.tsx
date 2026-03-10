import React from "react";
import { Text } from "ink";
import type { ScoreLevel } from "../analyzer/matcher.js";

interface ScoreBarProps {
  label: string;
  score: ScoreLevel;
}

const SCORE_CONFIG = {
  high: { color: "green" as const, bar: "███████████", text: "High" },
  med: { color: "yellow" as const, bar: "███████░░░░", text: "Med" },
  low: { color: "red" as const, bar: "████░░░░░░░", text: "Low" },
};

export function ScoreBar({ label, score }: ScoreBarProps) {
  const config = SCORE_CONFIG[score];
  const paddedLabel = label.padEnd(20);

  return (
    <Text>
      {"  "}
      <Text dimColor>{paddedLabel}</Text>
      <Text color={config.color}>{config.bar}</Text>
      <Text> </Text>
      <Text color={config.color} bold>
        {config.text}
      </Text>
    </Text>
  );
}
