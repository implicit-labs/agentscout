# AgentScout Recommend

Takes diagnosis findings and recommends concrete fixes, scored on three pillars. Runs independently after `/diagnose`.

## Instructions

### Step 1: Load diagnosis + catalogs

**1a. Find the most recent diagnosis:**
```bash
ls -t agentscout-answers-*.json 2>/dev/null | head -1
```

Read that file. If none exists, tell the user to run `/diagnose` first.

**1b. Load the tooling inventory:**
```bash
AGENTSCOUT_LLM_PROJECT_LIMIT=10 node dist/cli.js --inventory 2>/dev/null
```

**1c. Read the catalogs:**
- `catalog/claude-native.md` — built-in Claude Code features (hooks, memory, skills, CLAUDE.md rules, plugins)
- `catalog/potential-solutions.md` — curated third-party tools, MCPs, CLIs, skills, techniques
- `catalog/tools.json` — structured tool catalog with pillar scores

### Step 2: For each diagnosis finding, generate a recommendation

For each `fixableInteraction` in the diagnosis answers, propose the **most concrete fix**.

**Priority order** (claude-native first):
1. **Config fix** — MCP pointing to wrong project, plugin installed but not configured, permission missing. Zero new infrastructure.
2. **CLAUDE.md rule** — A convention the agent should follow. One markdown file.
3. **Hook** — A PostToolUse/PreToolUse script. One shell script + settings.json entry.
4. **Skill** — A reusable instruction set. One SKILL.md file.
5. **Memory entry** — Persistent context the agent should remember. One memory file.
6. **Existing third-party tool** — From `catalog/potential-solutions.md` or `catalog/tools.json`. Requires install.
7. **New MCP server to build** — Custom integration. Requires development.

For each recommendation, score the **three pillars**:

| Pillar | Question | Scale |
|--------|----------|-------|
| **Handoff Index** | How much of the human's glue work does this eliminate? Does the agent own the full loop end-to-end, or just one step? | low / med / high |
| **Time Reclaimed** | How frequently does this pain occur and how disruptive is it? A daily annoyance across 28 sessions > a one-time config issue. | low / med / high |
| **Agent Readiness** | How ready is this solution for agent use today? Config fix = high. Mature MCP with 5K stars = high. Custom MCP to build = low. | low / med / high |

**IMPORTANT: Always use these exact pillar names in prose output.** Write `Handoff Index: high` not `Ownership: high`. Write `Time Reclaimed: high` not `Pain: high`. The three labels are: Handoff Index, Time Reclaimed, Agent Readiness.

### Step 3: Build the recommendation output

Write to a timestamped file:
```bash
echo "agentscout-recs-$(date +%Y%m%dT%H%M%S).json"
```

Format:
```json
{
  "recommendations": [
    {
      "project": "project-name",
      "finding": "Title from diagnosis fixableInteraction",
      "category": "1-8 (from diagnosis)",
      "recommendation": {
        "title": "Name of the fix",
        "type": "config-fix | claude-md-rule | hook | skill | memory | third-party-tool | new-mcp",
        "implementation": "Exact steps. For config fixes: the JSON to write. For hooks: the script. For CLAUDE.md rules: the rule text. For third-party tools: the install command.",
        "pillarScores": {
          "handoffIndex": "low | med | high",
          "timeReclaimed": "low | med | high",
          "agentReadiness": "low | med | high"
        },
        "whyThisOverAlternatives": "Why this specific fix over other options. If a claude-native fix exists, explain why you chose it (or why you didn't).",
        "evidence": ["Quotes from diagnosis that drive this recommendation"]
      }
    }
  ],
  "quickWins": [
    "List of recommendations that are type config-fix or claude-md-rule — things that can be done in under 5 minutes"
  ],
  "buildList": [
    "List of recommendations that require development (type new-mcp or complex hooks)"
  ]
}
```

### Step 4: Present as an actionable playbook

Write prose, not tables. Organize into three tiers:

**Tier 1: Do right now (config fixes + CLAUDE.md rules)**
These require zero new infrastructure. For each:
- What to change (exact file path, exact content)
- Which diagnosis finding it addresses
- Pillar scores
- Copy-pasteable implementation

**Tier 2: Build this week (hooks + skills)**
These require a small script or instruction file. For each:
- The hook script or SKILL.md content
- Where it goes in the file system
- Which diagnosis finding it addresses
- Pillar scores

**Tier 3: Build when ready (third-party tools + new MCPs)**
These require installation or development. For each:
- Install command or development scope
- What API/CLI it wraps
- Which diagnosis finding it addresses
- Pillar scores
- Link to repo/docs

**Within each tier, sort by a composite score:**
- high/high/high = do first
- high/high/low = high value but not ready yet (move to tier 3)
- low/low/high = easy but low impact (skip or deprioritize)

### Rules

- **Claude-native first.** If a CLAUDE.md rule, hook, or config fix solves the problem, do NOT recommend a third-party tool. The user explicitly does not want a sales pitch.
- **Be implementation-specific.** "Add a hook" is not a recommendation. The exact script, the exact settings.json entry, the exact file path — that's a recommendation.
- **Quote the diagnosis.** Every recommendation must trace back to a specific diagnosis finding with quoted evidence.
- **Don't recommend what's already installed.** Cross-reference with the inventory. If the tool exists, the recommendation is "configure it" or "use it", not "install it".
- **Don't recommend generic improvements.** "Better error handling" is not a recommendation. "A PostToolUse hook on Edit that runs `swiftc -typecheck` and surfaces the first 20 lines of errors" is a recommendation.
