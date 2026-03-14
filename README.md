# AgentScout

**Your agents should shop for their own tools.**

AgentScout analyzes your [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) sessions to find where *you're* doing work the agent could handle — then recommends the exact tools, configs, and skills to close those gaps.

## How it works

1. **Scans** your Claude Code session history (`~/.claude/projects/`)
2. **Diagnoses** workflow breakdowns — where you interrupted the agent, pasted logs, relayed errors, or manually verified output
3. **Recommends** concrete fixes: MCP servers, CLI tools, CLAUDE.md rules, hooks, and skills — scored on three pillars

| Pillar | What it measures |
|--------|-----------------|
| **Handoff Index** | Can the agent own the full workflow without human relay? |
| **Time Reclaimed** | How much human interruption time does this eliminate? |
| **Agent Readiness** | Is the tool mature, maintained, and safe to install? |

## Installation

### Prerequisites

- **Node.js >= 18** — check with `node --version`
- **Claude Code** — installed and used for a while (AgentScout needs session history in `~/.claude/projects/`)
- **GitHub CLI (`gh`)** — optional, used to enrich tool recommendations with live GitHub metadata. Install: `brew install gh && gh auth login`

### Option A: Clone the repo (recommended)

```bash
git clone https://github.com/implicit-labs/agentscout.git
cd agentscout
npm install
npm run build
```

Then copy the two skill files into any project you want to diagnose:

```bash
# Create the commands directory if it doesn't exist
mkdir -p /path/to/your/project/.claude/commands

# Copy the skills
cp .claude/commands/diagnose.md /path/to/your/project/.claude/commands/
cp .claude/commands/recommend.md /path/to/your/project/.claude/commands/
```

### Option B: Install globally via npm

```bash
npm install -g agentscout
```

You still need the skill files in your project — the npm package provides the CLI that the skills call under the hood:

```bash
mkdir -p /path/to/your/project/.claude/commands

# Download the skills directly from GitHub
curl -o /path/to/your/project/.claude/commands/diagnose.md \
  https://raw.githubusercontent.com/implicit-labs/agentscout/main/.claude/commands/diagnose.md

curl -o /path/to/your/project/.claude/commands/recommend.md \
  https://raw.githubusercontent.com/implicit-labs/agentscout/main/.claude/commands/recommend.md
```

## Usage

Open Claude Code in any project that has the skill files installed, then:

```
/diagnose              Analyze your workflow across all projects
/diagnose myproject    Scope diagnosis to a single project
/recommend             Generate tool recommendations from the latest diagnosis
```

That's it. The skills orchestrate everything — scanning sessions, spawning subagents for per-project analysis, and synthesizing results.

### What `/diagnose` does

**Phase 1 — Gather data.** Deterministic scanners extract tool uses, user messages, bash commands, errors, and implicit signals (pasted logs, activity gaps, external system references) from your session history.

**Phase 2 — Deep-dive per project.** Subagents analyze each project independently. Every human intervention is classified: taste/judgment (keep it) or mechanical relay (automate it). The user's raw voice — frustration, corrections, typos — is extracted as evidence.

**Phase 3 — Cross-project synthesis.** Same tool misconfigured everywhere? One fix. Same external dashboard brokered across projects? Systemic pattern.

Outputs `agentscout-answers-{timestamp}.json` in your working directory.

### What `/recommend` does

Reads the diagnosis and matches findings against a curated catalog of 60+ tools, MCPs, CLIs, and techniques. Generates a tiered playbook:

| Tier | What | Examples |
|------|------|---------|
| **1 — Quick wins** | Zero-install fixes | CLAUDE.md rules, config changes, shell aliases |
| **2 — Build this week** | Single-tool installs | MCP servers, hooks, skills |
| **3 — Build when ready** | Larger integrations | CI/CD pipelines, custom MCPs |
| **4 — Explore** | Catalog matches | Tools that match your stack but weren't flagged by diagnosis |

Every recommendation includes preflight checks (runtime requirements, API keys, conflicts) and setup code.

Outputs `agentscout-recs-{timestamp}.json` and an HTML report.

## Updating

### If you cloned the repo

```bash
cd agentscout
git pull
npm install
npm run build
```

Then re-copy the skill files to your projects (they may have been updated):

```bash
cp .claude/commands/diagnose.md /path/to/your/project/.claude/commands/
cp .claude/commands/recommend.md /path/to/your/project/.claude/commands/
```

### If you installed via npm

```bash
npm update -g agentscout
```

Re-download the skill files:

```bash
curl -o /path/to/your/project/.claude/commands/diagnose.md \
  https://raw.githubusercontent.com/implicit-labs/agentscout/main/.claude/commands/diagnose.md

curl -o /path/to/your/project/.claude/commands/recommend.md \
  https://raw.githubusercontent.com/implicit-labs/agentscout/main/.claude/commands/recommend.md
```

## CLI reference

The skills call the CLI under the hood, but you can use it directly:

```
agentscout --help                Show usage
agentscout --inventory           Output your current tooling inventory as JSON
agentscout --emit-prompts        Scan sessions and output diagnosis prompts as JSON
agentscout --apply-answers       Read subagent answers from stdin and output synthesized report
agentscout --project <name>      Scope to a single project (combine with --emit-prompts or --apply-answers)
```

## Project structure

```
.claude/commands/
  diagnose.md             3-phase diagnosis skill (copy this to your project)
  recommend.md            Recommendation generation skill (copy this to your project)

src/
  cli.ts                  CLI entry point
  scanner/                Session data extraction
    sessions.ts           Parse Claude Code session JSONs
    patterns.ts           Workflow pattern detection
    signals.ts            Behavioral pain signal detectors
    implicit.ts           Infer what external systems you consulted
    installed.ts          Discover your installed tools, MCPs, skills
    inventory.ts          Build complete tooling snapshot
    github.ts             Enrich tools with live GitHub metadata
  analyzer/               Interpretation and diagnosis
    diagnosis.ts          Core diagnosis engine
    matcher.ts            Tool-to-pattern recommender
    readiness.ts          Tool adoption readiness scoring
  catalog/
    tools.json            Structured tool database with pillar scores

catalog/
  potential-solutions.md  60+ curated tools, MCPs, CLIs, techniques
  claude-native.md        Built-in Claude Code features (hooks, memory, skills)
  candidates.json         Pipeline for new tool additions
  trusted-curators.json   Source tracking for catalog entries

templates/
  recommend.html          HTML report template
```

## License

MIT — see [LICENSE](LICENSE)
