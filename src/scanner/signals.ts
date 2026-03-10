/**
 * Workflow Smell Detectors
 *
 * Analyzes raw session data to surface behavioral signals that indicate
 * pain points, inefficiencies, and automation opportunities.
 */

import type { RawToolUse, UserMessage } from "./sessions.js";

export interface WorkflowSignal {
  type:
    | "frustration"
    | "retry-loop"
    | "yoyo-file"
    | "tool-error"
    | "repeated-command"
    | "interrupted"
    | "correction";
  severity: "low" | "med" | "high";
  description: string;
  project: string;
  evidence: string;
  count: number;
}

export interface SessionSignalData {
  toolUses: RawToolUse[];
  userMessages: UserMessage[];
  projectName: string;
}

// ── Frustration Detector ──────────────────────────────────────
// Detects user anger/frustration from message patterns.
// Filters out skill content and system messages to avoid false positives.

const FRUSTRATION_PATTERNS: { pattern: RegExp; weight: number }[] = [
  // Direct frustration
  { pattern: /\bstill not working\b/i, weight: 3 },
  { pattern: /\bstill broken\b/i, weight: 3 },
  { pattern: /\bsame (?:error|issue|problem|bug)\b/i, weight: 3 },
  { pattern: /\bnot what i (?:asked|wanted|meant)\b/i, weight: 3 },
  { pattern: /\bthat'?s (?:not |in)?correct\b/i, weight: 2 },
  { pattern: /\byou (?:already|just) (?:did|broke|removed)\b/i, weight: 3 },
  { pattern: /\bi (?:already|just) (?:told|said|asked)\b/i, weight: 3 },
  // Corrections
  { pattern: /^no[,.]?\s/i, weight: 1 },
  { pattern: /\bundo\b/i, weight: 2 },
  { pattern: /\brevert\b/i, weight: 2 },
  { pattern: /\bwrong\b/i, weight: 1 },
  // Exasperation
  { pattern: /\bwhy (?:is|does|did|are|isn't|doesn't|won't)\b/i, weight: 1 },
  { pattern: /\bwtf\b/i, weight: 3 },
  { pattern: /\bseriously\b/i, weight: 2 },
  { pattern: /\bcome on\b/i, weight: 2 },
  { pattern: /\bjust (?:do|make|fix)\b/i, weight: 2 },
  // Urgency / impatience
  { pattern: /!!+/, weight: 2 },
  { pattern: /\bplease just\b/i, weight: 2 },
  { pattern: /\bagain\b(?!st)/i, weight: 1 },
];

function isSkillContent(text: string): boolean {
  // Skill content is injected as user messages but starts with these patterns
  return (
    text.startsWith("Base directory for this skill:") ||
    text.startsWith("# ") ||
    text.startsWith("This session is being continued") ||
    text.includes("SKILL.md") ||
    text.length > 500 // Very long "user messages" are almost always injected system content
  );
}

function detectFrustration(sessions: SessionSignalData[]): WorkflowSignal[] {
  const signals: WorkflowSignal[] = [];

  for (const session of sessions) {
    let frustrationScore = 0;
    const frustrationEvidence: string[] = [];

    for (const msg of session.userMessages) {
      if (isSkillContent(msg.text)) continue;
      if (msg.text.length < 3) continue;

      for (const { pattern, weight } of FRUSTRATION_PATTERNS) {
        if (pattern.test(msg.text)) {
          frustrationScore += weight;
          const snippet =
            msg.text.length > 100
              ? msg.text.substring(0, 97) + "..."
              : msg.text;
          frustrationEvidence.push(snippet);
          break; // one match per message
        }
      }
    }

    if (frustrationScore >= 3) {
      signals.push({
        type: "frustration",
        severity: frustrationScore >= 8 ? "high" : frustrationScore >= 5 ? "med" : "low",
        description: `User showed frustration signals (score: ${frustrationScore})`,
        project: session.projectName,
        evidence: frustrationEvidence.slice(0, 3).join(" | "),
        count: frustrationEvidence.length,
      });
    }
  }

  return signals;
}

// ── Interruption Detector ──────────────────────────────────────
// Frequent Escape/Ctrl+C means Claude is going down the wrong path.

function detectInterruptions(sessions: SessionSignalData[]): WorkflowSignal[] {
  const signals: WorkflowSignal[] = [];

  for (const session of sessions) {
    const interruptions = session.userMessages.filter((m) => m.isInterrupted);

    if (interruptions.length >= 2) {
      signals.push({
        type: "interrupted",
        severity: interruptions.length >= 5 ? "high" : interruptions.length >= 3 ? "med" : "low",
        description: `User interrupted Claude ${interruptions.length} times — agent going down wrong path`,
        project: session.projectName,
        evidence: `${interruptions.length} interruptions detected`,
        count: interruptions.length,
      });
    }
  }

  return signals;
}

// ── Retry Loop Detector ──────────────────────────────────────
// Same tool called 3+ times consecutively = agent is stuck spinning.

function detectRetryLoops(sessions: SessionSignalData[]): WorkflowSignal[] {
  const signals: WorkflowSignal[] = [];

  for (const session of sessions) {
    const tools = session.toolUses;
    let i = 0;

    while (i < tools.length) {
      let runLength = 1;
      while (
        i + runLength < tools.length &&
        tools[i].inputKey === tools[i + runLength].inputKey
      ) {
        runLength++;
      }

      if (runLength >= 3) {
        signals.push({
          type: "retry-loop",
          severity: runLength >= 5 ? "high" : "med",
          description: `${tools[i].name} called ${runLength}x in a row with same input — agent stuck`,
          project: session.projectName,
          evidence: tools[i].inputKey.substring(0, 100),
          count: runLength,
        });
      }

      i += Math.max(runLength, 1);
    }
  }

  return signals;
}

// ── Yoyo File Detector ──────────────────────────────────────
// Same file edited 4+ times in a session = indecision / back-and-forth.

function detectYoyoFiles(sessions: SessionSignalData[]): WorkflowSignal[] {
  const signals: WorkflowSignal[] = [];

  for (const session of sessions) {
    const editCounts = new Map<string, number>();

    for (const tool of session.toolUses) {
      if ((tool.name === "Edit" || tool.name === "Write") && tool.filePath) {
        editCounts.set(tool.filePath, (editCounts.get(tool.filePath) || 0) + 1);
      }
    }

    for (const [file, count] of editCounts) {
      if (count >= 4) {
        const fileName = file.split("/").pop() || file;
        signals.push({
          type: "yoyo-file",
          severity: count >= 8 ? "high" : count >= 5 ? "med" : "low",
          description: `${fileName} edited ${count}x — excessive back-and-forth`,
          project: session.projectName,
          evidence: file,
          count,
        });
      }
    }
  }

  return signals;
}

// ── Tool Error Detector ──────────────────────────────────────
// Groups tool errors by type to find unreliable tools / permission issues.

function detectToolErrors(sessions: SessionSignalData[]): WorkflowSignal[] {
  const signals: WorkflowSignal[] = [];

  for (const session of sessions) {
    const errorsByTool = new Map<string, { count: number; samples: string[] }>();

    for (const tool of session.toolUses) {
      if (tool.isError) {
        const existing = errorsByTool.get(tool.name) || { count: 0, samples: [] };
        existing.count++;
        if (existing.samples.length < 2 && tool.errorMessage) {
          existing.samples.push(
            tool.errorMessage.length > 80
              ? tool.errorMessage.substring(0, 77) + "..."
              : tool.errorMessage
          );
        }
        errorsByTool.set(tool.name, existing);
      }
    }

    for (const [toolName, { count, samples }] of errorsByTool) {
      if (count >= 2) {
        signals.push({
          type: "tool-error",
          severity: count >= 5 ? "high" : count >= 3 ? "med" : "low",
          description: `${toolName} failed ${count}x`,
          project: session.projectName,
          evidence: samples.join(" | ") || `${count} errors`,
          count,
        });
      }
    }
  }

  return signals;
}

// ── Repeated Command Detector ──────────────────────────────────────
// Exact same bash command run 3+ times = manual retry or missing automation.

function detectRepeatedCommands(sessions: SessionSignalData[]): WorkflowSignal[] {
  const signals: WorkflowSignal[] = [];

  for (const session of sessions) {
    const cmdCounts = new Map<string, number>();

    for (const tool of session.toolUses) {
      if (tool.name === "Bash" && tool.command) {
        // Normalize: trim, collapse whitespace
        const normalized = tool.command.trim().replace(/\s+/g, " ");
        if (normalized.length > 5) {
          cmdCounts.set(normalized, (cmdCounts.get(normalized) || 0) + 1);
        }
      }
    }

    for (const [cmd, count] of cmdCounts) {
      if (count >= 3) {
        signals.push({
          type: "repeated-command",
          severity: count >= 8 ? "high" : count >= 5 ? "med" : "low",
          description: `"${cmd.substring(0, 60)}" run ${count}x — candidate for automation`,
          project: session.projectName,
          evidence: cmd.substring(0, 100),
          count,
        });
      }
    }
  }

  return signals;
}

// ── Correction Detector ──────────────────────────────────────
// User immediately corrects Claude after an assistant response.
// Looks for "no", "wrong", "that's not" right after assistant acted.

function detectCorrections(sessions: SessionSignalData[]): WorkflowSignal[] {
  const signals: WorkflowSignal[] = [];

  for (const session of sessions) {
    let correctionCount = 0;
    const correctionSamples: string[] = [];
    const correctionPatterns = [
      /^no[,.\s]/i,
      /\bthat'?s (?:not|wrong|incorrect)\b/i,
      /\bdon'?t do that\b/i,
      /\bundo (?:that|this|it)\b/i,
      /\brevert (?:that|this|it)\b/i,
      /\bwait\b.*\bnot\b/i,
      /\bactually[,]?\s+(?:i want|let's|we should|don't)\b/i,
    ];

    for (const msg of session.userMessages) {
      if (isSkillContent(msg.text)) continue;
      for (const pattern of correctionPatterns) {
        if (pattern.test(msg.text)) {
          correctionCount++;
          if (correctionSamples.length < 3) {
            correctionSamples.push(
              msg.text.length > 80 ? msg.text.substring(0, 77) + "..." : msg.text
            );
          }
          break;
        }
      }
    }

    if (correctionCount >= 2) {
      signals.push({
        type: "correction",
        severity: correctionCount >= 5 ? "high" : correctionCount >= 3 ? "med" : "low",
        description: `User corrected Claude ${correctionCount}x — agent misunderstanding intent`,
        project: session.projectName,
        evidence: correctionSamples.join(" | "),
        count: correctionCount,
      });
    }
  }

  return signals;
}

// ── Main Entry Point ──────────────────────────────────────

export function detectWorkflowSignals(
  sessions: SessionSignalData[]
): WorkflowSignal[] {
  const allSignals = [
    ...detectFrustration(sessions),
    ...detectInterruptions(sessions),
    ...detectRetryLoops(sessions),
    ...detectYoyoFiles(sessions),
    ...detectToolErrors(sessions),
    ...detectRepeatedCommands(sessions),
    ...detectCorrections(sessions),
  ];

  // Sort by severity (high first), then by count
  const severityOrder = { high: 0, med: 1, low: 2 };
  allSignals.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] || b.count - a.count
  );

  return allSignals;
}
