# AgentScout

Analyzes your Claude Code sessions to find where you're doing work the agent could handle, then recommends tools to close the gaps.

## Install

Requires Node.js >= 18 and Claude Code (needs session history in `~/.claude/projects/`).

```bash
npm install -g agentscout
```

Or from source:

```bash
git clone https://github.com/implicit-labs/agentscout.git
cd agentscout
npm install && npm run build
```

Copy the skills into your project:

```bash
mkdir -p /path/to/your/project/.claude/commands
cp .claude/commands/diagnose.md /path/to/your/project/.claude/commands/
cp .claude/commands/recommend.md /path/to/your/project/.claude/commands/
```

## Token Usage Warning

`/diagnose` spawns **one subagent per project** in Phase 2 (deep-dive). Each subagent is a full Claude Code session that consumes tokens against your Claude Code usage. The number of subagents scales with the number of projects analyzed — by default up to 10 projects.

To limit scope and reduce token usage:

```
/diagnose myproject    # scope to one project
```

Or set the project limit:

```bash
AGENTSCOUT_LLM_PROJECT_LIMIT=3 node dist/cli.js --emit-prompts
```

`/recommend` does **not** spawn subagents — it runs entirely in the current session.

## Usage

Inside Claude Code:

```
/diagnose            # analyze your workflow
/diagnose myproject  # scope to one project
/recommend           # generate recommendations from latest diagnosis
```

### `/diagnose`

Runs in three phases:

1. **Scan.** Reads your Claude Code session history across all projects. Extracts tool uses, user messages, bash commands, and errors. Also detects implicit signals — things like pasted logs, pasted stack traces, activity gaps, and references to external systems. These are signs you were acting as a relay between some tool and the agent.

2. **Deep-dive.** Spawns a subagent per project to analyze every human intervention in that project's sessions. Each intervention gets classified: was this a genuine taste/judgment call (the human should keep doing this), or was it mechanical relay work (the human was just copying information the agent could have accessed directly)? The subagents also extract the user's raw voice — frustration, corrections, typos — as evidence of real pain.

3. **Synthesize.** Merges findings across all projects. Looks for the same gap appearing in multiple places — same tool misconfigured everywhere, same external dashboard brokered repeatedly, same implicit relay pattern. These cross-project patterns are the highest-leverage things to fix.

Activity gaps (time between tool calls) are interpreted with nuance: short gaps (5-15 min) likely mean the user was actively doing something outside the session. Longer gaps (30-60 min) are more likely breaks, meetings, or context switches — not continuous testing. The subagents use surrounding messages to infer what actually happened during each gap.

Outputs `agentscout-answers-{timestamp}.json`.

### `/recommend`

Starts by taking an inventory of what you already have installed — every MCP server, skill, command, hook, and plugin across all your projects. This way it won't recommend something you already have, and it can spot tools that are installed but misconfigured.

Then it reads the diagnosis and matches each finding against a curated catalog of 60+ tools, MCPs, CLIs, and techniques. Recommendations are tiered:

- **Tier 1** — Quick wins. CLAUDE.md rules, config fixes. Zero install.
- **Tier 2** — Build this week. MCP servers, hooks, skills.
- **Tier 3** — Build when ready. Larger integrations, custom MCPs.
- **Tier 4** — Explore. Tools from the catalog that match your stack, even if diagnosis didn't flag them.

Each recommendation gets preflight checks (runtime requirements, API keys, conflicts) and setup code.

Outputs `agentscout-recs-{timestamp}.json` and an HTML report.

## Catalog Updates

The tool catalog is fetched from GitHub at runtime and cached locally for 24 hours (`~/.agentscout/catalog-cache.json`). This means you get catalog updates — new tools, updated scores, new techniques — without needing to reinstall or update the package. If the fetch fails (offline, rate limited), the bundled catalog is used as a fallback.

## Update

```bash
npm update -g agentscout
```

Or from source:

```bash
cd agentscout
git pull && npm install && npm run build
```

Then re-copy the skill files to your projects.

## License

MIT
