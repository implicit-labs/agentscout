# AgentScout

**Your agents should shop for their own tools.**

AgentScout analyzes your [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) sessions to find where you're doing work the agent could handle — then recommends the exact tools, configs, and skills to close those gaps.

## What it does

1. **Scans** your Claude Code session history (`~/.claude/projects/`)
2. **Diagnoses** workflow breakdowns — where you interrupted the agent, pasted logs, relayed errors, or manually verified output
3. **Recommends** concrete fixes: MCP servers, CLI tools, CLAUDE.md rules, hooks, and skills — scored on three pillars

### The three pillars

| Pillar | Question it answers |
|--------|-------------------|
| **Handoff Index** | Does this tool let the agent own the full workflow without human relay? |
| **Time Reclaimed** | How much human interruption time does this eliminate? |
| **Agent Readiness** | Is this tool mature, maintained, and safe to install? |

## Quick start

```bash
# Clone and build
git clone https://github.com/implicit-labs/agentscout.git
cd agentscout
npm install && npm run build

# Copy the skills into your project
cp -r .claude/commands/diagnose.md YOUR_PROJECT/.claude/commands/
cp -r .claude/commands/recommend.md YOUR_PROJECT/.claude/commands/
```

Then inside Claude Code:

```
/diagnose          # Analyze your workflow across all projects
/diagnose myapp    # Scope to a single project
/recommend         # Generate recommendations from the latest diagnosis
```

## How it works

### `/diagnose` — 3-phase workflow analysis

**Phase 1:** Deterministic scanners extract session data — tool uses, user messages, bash commands, errors, and implicit signals (pasted logs, activity gaps, external system references).

**Phase 2:** Subagents deep-dive each project independently. They classify every human intervention: Was it taste/judgment (keep it), or mechanical relay (automate it)? They extract the user's raw voice — frustration, corrections, typos — as evidence.

**Phase 3:** Cross-project synthesis. The same tool misconfigured everywhere? One fix. The same external dashboard brokered across projects? Systemic pattern.

Output: `agentscout-answers-{timestamp}.json`

### `/recommend` — tiered recommendations

Reads the diagnosis and matches findings against a curated catalog of 60+ tools, MCPs, CLIs, and techniques.

**Tier 1 — Quick wins:** CLAUDE.md rules, config fixes, shell aliases. Zero install, immediate value.

**Tier 2 — Build this week:** MCP servers, hooks, skills that close a specific workflow gap.

**Tier 3 — Build when ready:** Larger integrations (CI/CD pipelines, custom MCPs) that require setup.

**Tier 4 — Explore:** Proactive recommendations from the catalog that match your tech stack, even if the diagnosis didn't flag them.

Every recommendation includes preflight checks (runtime requirements, API keys, conflicts) and setup code.

Output: `agentscout-recs-{timestamp}.json` + HTML report

## Using as an `npx` skill

You can reference AgentScout's skills directly from any project without cloning:

```bash
# In your project's .claude/settings.json, add the skill source:
{
  "skills": ["github:implicit-labs/agentscout/.claude/commands/diagnose.md",
             "github:implicit-labs/agentscout/.claude/commands/recommend.md"]
}
```

Or install globally and use the CLI directly:

```bash
npm install -g agentscout
agentscout --emit-prompts    # Output diagnosis prompts as JSON
agentscout --inventory       # Output tooling inventory as JSON
agentscout --apply-answers   # Synthesize subagent answers into report
```

## Project structure

```
.claude/commands/
  diagnose.md          # 3-phase diagnosis skill
  recommend.md         # Recommendation generation skill

src/
  cli.ts               # CLI entry point (headless modes for skills)
  scanner/
    sessions.ts        # Parse Claude Code session JSONs
    patterns.ts        # Regex-based workflow pattern detection
    signals.ts         # Behavioral pain signal detectors
    implicit.ts        # Fingerprint external system reads
    installed.ts       # Discover installed tools, MCPs, skills
    inventory.ts       # Build complete tooling snapshot
    github.ts          # Enrich tools with GitHub metadata
  analyzer/
    diagnosis.ts       # Core diagnosis engine
    matcher.ts         # Tool-to-pattern recommender
    readiness.ts       # Tool adoption readiness scoring
    claude-pipe.ts     # LLM integration
    sdk-worker.ts      # Subagent worker (Claude Agent SDK)
  catalog/
    tools.json         # Structured tool database with pillar scores

catalog/
  potential-solutions.md    # Curated tools, MCPs, CLIs, techniques
  claude-native.md          # Built-in Claude Code features
  candidates.json           # Pipeline for new tool additions
  trusted-curators.json     # Source/curator tracking

templates/
  recommend.html       # HTML report template
```

## Requirements

- Node.js >= 18
- Claude Code installed and used (needs session history in `~/.claude/projects/`)

## License

MIT - see [LICENSE](LICENSE)
