# Diagnosis

## Problem

`AgentScout` is not reliably producing LLM-backed workflow diagnosis.

The intended path is:

1. Compute deterministic per-project forensics.
2. Send a small project-level extraction prompt to Claude via the Agent SDK.
3. Synthesize extracted interactions locally in code.

In practice, the LLM path frequently falls back to heuristics because the SDK stage either:

- times out with no usable output, or
- returns prose instead of structured JSON.

## Current Symptom

Typical failure output:

- `Workflow Diagnosis (heuristic fallback)`
- `Projects analyzed: 0 / 8`
- `Stage project:*: timeout`
- `Claude Agent SDK timed out after 18000ms`

Recent failing example:

- total prompt chars: `9,617`
- per-project prompt chars:
  - `agentscout`: `3,708`
  - `pack`: `2,537`
  - `landing`: `3,372`
- all three timed out at `18.0s`

## Important Context

This is not a simple transport failure.

We have already observed three distinct SDK behaviors:

1. `timeout`
Claude emits no usable result before the stage timeout.

2. `unparseable prose`
Claude returns normal assistant text like:
`I need to load and analyze the agentscout project's forensics data...`
This means the SDK call succeeded, but Claude behaved like an agent, not a strict classifier.

3. `success`
A 1-project run has succeeded locally with:
- `Workflow Diagnosis (LLM project extractions)`
- `Stages: 1 total | 1 success | 0 timeout | 0 error`

So the system is in a mixed state:

- the architecture can work
- the behavior is not reliable enough across runs or environments

## What We Changed Already

### Architecture

- moved from one monolithic diagnosis prompt to project-level extraction
- removed LLM synthesis from the critical path
- local code now handles grouping, ranking, and cross-project synthesis

### SDK worker

- switched to `@anthropic-ai/claude-agent-sdk`
- disabled built-in tools with `tools: []`
- isolated settings with `settingSources: []`
- disabled thinking
- lowered effort
- reduced to `maxTurns: 1`
- removed `permissionMode: "plan"`

### Prompt shape

- shrank project prompt substantially
- changed from broad diagnosis to small extraction contract
- removed many inferred fields from the LLM schema
- now asks only for:
  - `engineerPerspective`
  - up to 2 `fixableInteractions`
  - `nonFixableJudgment`
  - `commodityToIgnore`
  - `confidenceNotes`

### Observability

- added diagnosis-engine metadata to the report
- added SDK worker event telemetry:
  - event counts
  - event trace
  - first-event latency
  - first-assistant latency
  - result latency
  - last assistant preview

## What The Failure Likely Means

The current bottleneck is probably one of these:

### 1. Claude Code SDK is not honoring structured output strictly enough

Evidence:

- sometimes returns prose instead of schema output
- prose is agent-like and meta-reasoning-heavy

Implication:

- even a good prompt may not be enough
- we may need a much smaller schema or a different invocation path

### 2. Timeout is happening before useful assistant output is surfaced

Evidence:

- some runs time out with `Output: 0 chars`
- per-project prompts are already relatively small

Implication:

- either the model is not starting quickly enough
- or the SDK stream is not surfacing partial progress before timeout

### 3. The multi-project default path is too aggressive

Evidence:

- one-project runs can succeed
- 8-project runs often abort after the first 3 failures

Implication:

- diagnosis should probably default to a smaller project subset
- or degrade to fewer projects faster

### 4. Local environment / runtime differences matter

Evidence:

- some verification runs succeeded in one environment
- the user still sees broad timeouts in their normal run

Implication:

- we need deterministic debugging output from the exact runtime they are using

## What To Look For In The Next Run

The report should now expose stage-level stream internals.

For each failed stage, we want to know:

- `model`
- `result`
- `stop`
- `turns`
- `stream: first event / first assistant / result`
- `events`
- `trace`
- `assistant`

Interpretation guide:

### No first event

Likely process startup or session initialization problem.

### First event exists, no assistant

Claude session initialized, but no usable generation began before timeout.

### Assistant exists, no result

Claude started responding but did not complete the turn before timeout.

### Result subtype is structured-output retry failure

The schema is still too ambitious or underspecified.

### Assistant preview contains planning prose

Claude is still treating the task as agent work instead of extraction.

## Likely Next Experiments

### A. Make the extraction schema even smaller

Candidate minimal shape:

- `project`
- `fixableInteractions[]`
  - `title`
  - `interactionSurface`
  - `severity`
  - `minimalPermission`
  - `observableSuccess`
  - `evidence`

Everything else inferred in code.

### B. Lower project fanout by default

Instead of up to 8 projects, try:

- 1 by default for debugging mode
- 3 for normal mode

### C. Increase project timeout temporarily for diagnosis

The current per-project timeout is `18s`.

Useful debugging run:

```bash
AGENTSCOUT_LLM_PROJECT_LIMIT=1 \
AGENTSCOUT_CLAUDE_PROJECT_TIMEOUT_MS=60000 \
node dist/cli.js
```

If this succeeds reliably, latency rather than schema is the dominant issue.

### D. Log raw SDK event trace for one-project runs

If the report output is still too compressed, dump the exact event trace to stderr in debug mode.

### E. Consider abandoning the Agent SDK for diagnosis-only use

If Claude Code continues behaving like an agent rather than a strict extractor, diagnosis may need:

- direct API structured output
- or `claude -p` if it proves more stable

## Success Criteria

We should consider diagnosis healthy only when:

1. Default run produces `Workflow Diagnosis (LLM project extractions)` more often than heuristic fallback.
2. At least one project extraction succeeds consistently on the user’s normal machine.
3. Failure cases are attributable from the report itself without guessing.
4. Extracted interactions stay generic and bounded, not tool-prescriptive.

## Operational Note

If a run does **not** show the new per-stage telemetry fields (`model`, `stream`, `events`, `trace`, `assistant`), then the user is almost certainly not running the latest built `dist/cli.js`.

## Recommended Debug Command

```bash
npm run build
env CI=1 FORCE_COLOR=0 AGENTSCOUT_LLM_PROJECT_LIMIT=1 AGENTSCOUT_CLAUDE_PROJECT_TIMEOUT_MS=30000 node dist/cli.js
```

If that still fails, capture the full `Diagnosis Engine` block from that run.
