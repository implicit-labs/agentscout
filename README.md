# AgentScout

Analyzes your Claude Code sessions to find where you're doing work the agent could handle, then recommends tools to close the gaps.

## Install

Requires Node.js >= 18 and Claude Code (needs session history in `~/.claude/projects/`).

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

## Usage

Inside Claude Code:

```
/diagnose            # analyze your workflow
/diagnose myproject  # scope to one project
/recommend           # generate recommendations from latest diagnosis
```

`/diagnose` scans your session history, spawns subagents to deep-dive each project, and classifies every human intervention as either taste/judgment (keep) or mechanical relay (automate). Outputs `agentscout-answers-{timestamp}.json`.

`/recommend` takes that diagnosis and matches it against a catalog of 60+ tools, MCPs, CLIs, and techniques. Outputs a tiered playbook (quick wins → explore) with preflight checks and setup code.

## Update

```bash
cd agentscout
git pull && npm install && npm run build
```

Then re-copy the skill files to your projects.

## License

MIT
