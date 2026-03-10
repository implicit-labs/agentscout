# Feature: AgentScout CLI

**Source:** User Request
**Created:** 2026-03-10
**Status:** Planning Complete

## Problem Statement

Developers using Claude Code accumulate hundreds of sessions with patterns of manual work, repetitive tool calls, and workflow friction — but have no way to identify these inefficiencies or discover tools that could eliminate them. Existing analytics tools (ccusage, claude-devtools) focus on cost/token tracking, not workflow improvement.

AgentScout analyzes your Claude Code session logs to answer:
1. **What am I doing by hand?** — Identify manual, repetitive patterns
2. **Where am I getting yelled at?** — Find error-prone workflows
3. **Is there a solution?** — Match patterns to MCP servers, CLI tools, OSS packages
4. **How do I convince my human?** — Present compelling, pain-focused recommendations

## Core Philosophy

The #1 selling point of any recommended tool is: **agents can own part of the workflow that humans are currently doing manually.**

- Supabase MCP = "never open the Supabase dashboard again"
- ASC CLI = "never touch Xcode, App Store Connect, or TestFlight manually again"
- Linear MCP = "never leave your editor to manage tickets"

Descriptions focus on **human suffering eliminated**, not technical features.

## 3-Pillar Evaluation Framework

### Workflow Ownership (Low / Med / High)
What manual process does this kill? Is it relevant to this user's actual workflow?
- **High:** Agent fully owns an end-to-end workflow (e.g., Supabase MCP owns entire DB layer)
- **Med:** Agent handles significant chunks but human still involved (e.g., a linter tool)
- **Low:** Minor convenience, human still drives (e.g., a formatting utility)

### Pain Eliminated (Low / Med / High)
How much time/frustration does this save? How impactful for the user's actual workflow?
- **High:** Eliminates a daily annoyance or multi-step manual process (e.g., TestFlight deployment)
- **Med:** Saves meaningful time on a weekly task
- **Low:** Nice-to-have, marginal improvement

### Agent Readiness (Low / Med / High)
Can you actually trust this thing? How battle-tested is it?
- **High:** Well-starred, endorsed by known devs, security-audited, minimal permissions needed
- **Med:** Growing community, reasonable permissions, some production usage
- **Low:** New/unproven, requires broad permissions, limited community validation

## Requirements

- [ ] R1: Scan `~/.claude/projects/` to discover all session data
- [ ] R2: Parse JSONL session logs to extract tool call patterns, error patterns, and workflow signatures
- [ ] R3: Match detected patterns against a curated database of ~20-30 tools/MCP servers
- [ ] R4: Query MCP Registry API (`registry.modelcontextprotocol.io`) for additional matches
- [ ] R5: Shell out to `claude -p` to generate context-aware, pain-focused "sell" descriptions
- [ ] R6: Display rich terminal output with recommendation cards showing Low/Med/High scores
- [ ] R7: Publishable as `npx agentscout`

## User Stories

- US-001: User runs `npx agentscout` and gets a full analysis report with tool recommendations in their terminal
- US-002: User sees WHY a tool is recommended based on their actual session patterns
- US-003: User sees honest trust signals (stars, permissions risk) for each recommendation

## Acceptance Criteria

- [ ] AC1: Running `npx agentscout` scans sessions and produces a report within 60 seconds
- [ ] AC2: Report shows at least 3 recommendations with all 3 pillar scores (Low/Med/High)
- [ ] AC3: Each recommendation has a compelling "sell" description focused on pain eliminated
- [ ] AC4: Tool works with zero configuration (reads `~/.claude/` automatically)
- [ ] AC5: No data leaves the machine except MCP registry API queries

## Technical Approach

### Stack
- **Runtime:** Node.js (>=18), TypeScript
- **TUI:** Ink v6 + chalk for rich terminal output
- **Build:** tsup (esbuild-based bundler)
- **Package:** ESM-only, published to npm with `bin` field

### Architecture
```
src/
  cli.tsx              # Entry point (shebang + Ink render)
  scanner/
    sessions.ts        # Reads ~/.claude/ session logs
    patterns.ts        # Pattern detection (tool calls, errors, workflows)
  analyzer/
    matcher.ts         # Matches patterns → curated tool database
    registry.ts        # MCP Registry API client
    claude-pipe.ts     # Shells out to `claude -p` for AI descriptions
  catalog/
    tools.json         # Curated tool database (~20-30 entries)
    patterns.json      # Pattern signatures that map to tools
  ui/
    Report.tsx         # Main report Ink component
    RecommendationCard.tsx  # Individual tool card with scores
    ScoreBar.tsx       # Low/Med/High score display
    Spinner.tsx        # Analysis progress indicator
```

### Data Flow
1. **Scan** — Read `sessions-index.json` files for metadata, parse recent JSONL sessions for tool call patterns
2. **Detect** — Identify manual work patterns (e.g., "user runs Bash git commands 47 times" → needs git MCP)
3. **Match** — Cross-reference patterns against curated `tools.json` + live MCP Registry queries
4. **Describe** — Pipe matched tools + context to `claude -p` for compelling descriptions
5. **Report** — Render recommendation cards in terminal via Ink

### Pattern Detection Strategy
Key signals to look for in session logs:
- **Repeated Bash commands** for tasks that have MCP/tool alternatives (git, docker, database queries)
- **Browser/manual workflow mentions** in user messages ("I went to App Store Connect and...")
- **Error clusters** around specific tools or workflows
- **High token burn** on tasks that could be automated
- **Tool call sequences** that suggest manual orchestration (Read → Edit → Bash → Read → Edit loop)

### AI Pipe (`claude -p`)
```bash
echo '<session_analysis_json>' | claude -p 'Given these Claude Code usage patterns, generate a compelling 2-sentence description for why this user should adopt <tool_name>. Focus on the human suffering it eliminates, not technical features. Be specific to their workflow.'
```

## Premortem

### Tigers
- Session log format changes → Parse defensively, version-check
- `claude -p` latency → Batch into single prompt, show spinner
- Large session dirs → Sample last 30 days, use index files for metadata
- Curated DB goes stale → Supplement with live MCP registry, easy to update

### Elephants
- Privacy concerns about scanning sessions → Everything local, be explicit about it
- Curated recs may feel generic → Focus on high-signal patterns, quality over quantity
- "Convince my human" is the real product challenge → AI-generated descriptions are key differentiator

## Testing Plan
1. Test session scanner against real `~/.claude/` directory structure
2. Test pattern detection with known session logs (git-heavy, web-heavy, iOS-heavy)
3. Test MCP Registry API integration
4. Test `claude -p` pipe and description generation
5. Test `npx agentscout` installation and execution flow
6. Verify no data leaves machine (except registry queries)
