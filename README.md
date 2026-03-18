# AgentScout

Analyzes your Claude Code sessions to find where you're doing work the agent could handle, then recommends tools to close the gaps.

## Install

```bash
npm install -g @implicit-ai/agentscout
```

That's it. The `/agentscout` command is automatically installed to `~/.claude/commands/` and available in every project.

## Token Usage Warning

`/agentscout` spawns **one subagent per project** during the deep-dive phase. Each subagent is a full Claude Code session that consumes tokens against your Claude Code usage. The number of subagents scales with the number of projects analyzed — by default up to 10 projects.

To limit scope and reduce token usage:

```
/agentscout myproject    # scope to one project
```

Or set the project limit:

```bash
AGENTSCOUT_LLM_PROJECT_LIMIT=3 node dist/cli.js --emit-prompts
```

## Usage

Inside Claude Code:

```
/agentscout              # full pipeline: diagnose + recommend
/agentscout myproject    # scope to one project
```

Runs in six phases:

1. **Scan.** Reads your Claude Code session history across all projects. Extracts tool uses, user messages, bash commands, and errors. Detects implicit signals — pasted logs, stack traces, activity gaps, references to external systems. These are signs you were acting as a relay between some tool and the agent. Sessions from git worktrees are automatically clustered under their main repo.

2. **Deep-dive.** Spawns a subagent per project to analyze every human intervention. Each intervention gets classified: genuine taste/judgment call (human-owned), or mechanical relay work (the human was copying information the agent could have accessed directly). Subagents also extract the user's raw voice — frustration, corrections, typos — as evidence of real pain.

3. **Synthesize.** Merges findings across all projects. Looks for the same gap appearing in multiple places — same tool misconfigured everywhere, same external dashboard brokered repeatedly, same implicit relay pattern. Cross-project patterns are the highest-leverage things to fix.

4. **Recommend.** Inventories everything you already have installed (MCP servers, skills, hooks, plugins). Matches each diagnosis finding against a curated catalog of 60+ tools, MCPs, CLIs, and techniques. Scores each recommendation on three pillars: Handoff Index, Time Reclaimed, and Agent Readiness.

5. **Playbook.** Presents recommendations as tiered, copy-paste-ready instructions:
   - **Tier 1** — Quick wins. CLAUDE.md rules, config fixes. Zero install.
   - **Tier 2** — Build this week. Hooks, skills.
   - **Tier 3** — Build when ready. Custom MCPs, larger integrations.
   - **Tier 4** — Explore. Catalog tools matching your stack.

6. **Report.** Generates an HTML report with all findings and recommendations.

Outputs to `~/Downloads/`:
- `agentscout-answers-{timestamp}.json` — diagnosis data
- `agentscout-recs-{timestamp}.json` — recommendations data
- `agentscout-recs-{timestamp}.html` — HTML report (auto-opened)

## Catalog Updates

The tool catalog is fetched from GitHub at runtime and cached locally for 24 hours (`~/.agentscout/catalog-cache.json`). This means you get catalog updates — new tools, updated scores, new techniques — without needing to reinstall or update the package. If the fetch fails (offline, rate limited), the bundled catalog is used as a fallback.

## Update

```bash
npm update -g @implicit-ai/agentscout
```

## License

MIT
