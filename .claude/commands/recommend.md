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

**Consolidation: Per-project CLAUDE.md files**

When multiple findings affect the same project, do NOT generate separate CLAUDE.md rule snippets. Instead, consolidate into a **single project-level CLAUDE.md file** that includes:
- **Project name & description** — what the project is
- **Architecture** — monorepo structure, key directories, tech stack
- **Build commands** — exact commands to build, run, and test
- **Verification** — how to verify changes (which MCP, which skill, which tool)
- **Linear integration** — how to search/update issues if Linear MCP is available
- **Active decisions** — what's being overhauled, what not to touch
- **What NOT to do** — anti-patterns observed in diagnosis (e.g., "Don't propose complex abstractions when simple fix exists", "Don't ask 'how should I test this' — use the available tools")

This produces a comprehensive project context file instead of scattered rule fragments. A project that has never had a CLAUDE.md is often the single highest-leverage Tier 1 fix — it gives the agent direction, build commands, and verification steps all at once.

**80/20 tier splitting**: If a CLAUDE.md rule with a Bash workaround provides 80% of the value, put the rule in Tier 1 and the full MCP/hook solution in a higher tier. Example: a CLAUDE.md rule that tells the agent to run `xcrun simctl spawn booted log stream` via Bash is Tier 1; a dedicated log-streaming MCP server is Tier 3.

### Step 2a: Preflight dry-run for every recommendation

For EVERY tool recommendation (Tiers 2-4, and Tier 1 if it involves a tool install), run a **preflight check** before including it. This surfaces requirements, limitations, and annoyances upfront so the user knows what they're signing up for.

**What to check:**

1. **Runtime requirements** — Does it need Node.js, Python, Go, Rust, Docker, Xcode CLI tools? Check if they exist on the user's system by running quick checks:
   ```bash
   which node && node --version 2>/dev/null
   which python3 && python3 --version 2>/dev/null
   which go && go version 2>/dev/null
   which docker && docker --version 2>/dev/null
   which xcodebuild && xcodebuild -version 2>/dev/null | head -1
   ```

2. **API keys / auth required** — Does the tool need an API key, OAuth token, or service account? Flag this as a setup friction point.

3. **Known limitations** — Check the tool's GitHub README for:
   - Rate limits (free tier caps)
   - Platform restrictions (Linux-only, macOS-only)
   - Missing features / beta warnings
   - Large dependency footprints
   - Privacy concerns (sends data to external service)

4. **Install test** — For npm/brew tools, check if the package exists:
   ```bash
   npm view <package-name> version 2>/dev/null
   brew info <package-name> 2>/dev/null | head -1
   ```

5. **Conflicts** — Does it conflict with something already installed? (e.g., Puppeteer when Playwright is already configured)

**Preflight output format** (include in both JSON and HTML):

```json
{
  "preflight": [
    { "status": "pass", "check": "Node.js ≥18 detected", "detail": "required runtime" },
    { "status": "pass", "check": "npm available", "detail": "install via npm" },
    { "status": "warn", "check": "Requires API key", "detail": "set SENTRY_API_KEY in env" },
    { "status": "fail", "check": "Docker not found", "detail": "optional but needed for sandboxing" },
    { "status": "info", "check": "Known: rate-limited to 100 req/hr on free tier", "detail": "" }
  ]
}
```

Statuses: `pass` (green ✓), `warn` (yellow !), `fail` (red ✗), `info` (gray →).

**In the HTML output**, render preflight as a `.preflight` block on each recommendation card (see template). Place it between `.rec-body` and `<details>` (setup/code).

**Rules for preflight:**
- A `fail` on a required dependency should move the recommendation to a lower tier or add a note: "Install X first"
- A `warn` is informational — the tool still works but the user should know about friction
- Don't skip preflight for "obvious" tools — even `gh` needs auth
- For techniques/prompting hacks (no install), skip preflight entirely
- For CLAUDE.md rules and config fixes, skip preflight (nothing to install)
- Keep checks fast — don't install anything, just probe

### Step 2b: Explore the catalog for proactive recommendations

This step works in the OPPOSITE direction from Step 2. Instead of finding a fix for each problem, browse the catalog and find tools that match the user's tech stack and workflow — even if no diagnosis finding triggered them.

**How to explore:**

1. From the diagnosis answers, extract the user's tech stack: what languages, frameworks, platforms, and services do they use across projects? (e.g., iOS/Swift, React/Next.js, Supabase, Vercel, Linear)

2. From the inventory, extract what they already have configured.

3. Scan `catalog/potential-solutions.md` entry by entry. For each tool:
   - Does it match the user's tech stack?
   - Is it already installed? (check inventory — skip if so)
   - Could it plausibly help based on the workflow patterns seen? (e.g., if they do iOS work, Maestro for automated testing is relevant even if no finding says "missing mobile testing")
   - Is the Handoff Index or Time Reclaimed score high in the catalog?

4. Select the top 3-5 catalog entries that are NOT already covered by Tiers 1-3 recommendations. These are "you might not know you need this" suggestions.

For each exploration recommendation, provide:
- What it is and what it does
- Why it's relevant to their specific workflow (not generic — tie it to observed projects/patterns)
- Pillar scores from the catalog
- Install command or setup steps
- What it would change about their workflow
- If the catalog entry has a known author or source (e.g., @joelhooks, @tolibear_), include the attribution — this adds credibility and lets the user research further

**Key rule:** Tier 4 is explicitly exploratory. Label these as "explore" recommendations, not prescriptive fixes. The user should understand these are suggestions based on catalog matching, not diagnosed problems.

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
        "evidence": ["Quotes from diagnosis that drive this recommendation"],
        "preflight": [
          { "status": "pass|warn|fail|info", "check": "What was checked", "detail": "Extra context" }
        ]
      }
    }
  ],
  "quickWins": [
    "List of recommendations that are type config-fix or claude-md-rule — things that can be done in under 5 minutes"
  ],
  "buildList": [
    "List of recommendations that require development (type new-mcp or complex hooks)"
  ],
  "explore": [
    {
      "tool": "Name from catalog",
      "catalogEntry": "MCP / CLI / Skill / Technique",
      "description": "What it does",
      "relevance": "Why it matters for THIS user's workflow — cite specific projects or patterns",
      "pillarScores": {
        "handoffIndex": "low | med | high",
        "timeReclaimed": "low | med | high",
        "agentReadiness": "low | med | high"
      },
      "setupSteps": "Install command or config steps",
      "alreadyInstalled": false,
      "preflight": [
        { "status": "pass|warn|fail|info", "check": "What was checked", "detail": "Extra context" }
      ]
    }
  ]
}
```

### Step 4: Present as an actionable playbook

Write prose, not tables. Each recommendation is a mini-essay: what file to create/edit, why, the evidence, and the full copy-paste-ready content. The user should be able to implement every Tier 1 item by copying from the output directly.

Number items within each tier (1, 2, 3...), NOT across tiers.

**Format for each recommendation:**
```
### N. Title

**File:** `exact/file/path` (create or append)
**Fixes:** One-line summary — project name, session count, what was broken
**Handoff Index:** high | **Time Reclaimed:** high | **Agent Readiness:** high

One paragraph explaining why this matters. Quote the user or diagnosis directly.
Include session counts and specific evidence ("42 edits to foil.html without seeing
output", "the user said 'never mind you are quite useless'"). Explain what the agent
was doing wrong and why this fix changes that.

Then the full file content in a fenced code block. Copy-paste ready.
```

Organize into four tiers:

**Tier 1: Do Right Now (config fixes + CLAUDE.md rules)**

Zero infrastructure. All markdown files and JSON configs. State the total time estimate at the top ("Under 30 minutes total").

For **project-level CLAUDE.md** recommendations: include the FULL file content — architecture, build commands, verification steps, Linear integration, active decisions, and anti-patterns. NOT just a single rule snippet. A comprehensive project CLAUDE.md is more valuable than five scattered rules because it gives the agent complete context in one read.

For **global CLAUDE.md** rules: include the exact text to append, with the `## Section Header`.

For **config fixes**: include the exact JSON file to create with the full path.

**Tier 2: Build This Week (hooks)**

Shell scripts + settings.json entries. For each:
- The complete hook script (copy-paste ready)
- The exact settings.json entry
- Which projects benefit (name them)
- Evidence with specific counts (e.g., "Command 'npm run build' exited with 2 — 29 times across two projects")

**Tier 3: Build When Ready (custom MCPs + tools to build)**

Requires development. For each:
- What it wraps (CLI, API, service)
- Why the Tier 1 CLAUDE.md rule isn't enough (explain the remaining 20%)
- Development scope
- Which diagnosis finding it addresses

**Tier 4: Explore (catalog-driven suggestions)**

These are NOT driven by specific diagnosis findings. They come from matching the catalog against the user's tech stack.

For each:
- Lead with attribution if available: "**Tool Name (@author)**"
- Tie relevance to a specific project and observed pattern — not generic
- Pillar scores
- Setup steps (install command or CLAUDE.md convention)
- Make clear this is exploratory

**Closing summary**

End the playbook with this structure (adapt the specifics to the actual recommendations):

```
---

**Tier 1** items are config fixes and CLAUDE.md rules — do these now, under 30 minutes total.
**Tier 2** items are shell hooks — build this week, ~15 minutes each.
**Tier 3** items need development — build when you have a free afternoon.
**Tier 4** contains tools and techniques from the broader ecosystem that you may not have
encountered yet. They're not driven by diagnosed problems — they come from matching your
stack against the catalog. Worth exploring once the foundation from Tiers 1-3 is solid.
```

**Within each tier, sort by composite pillar score:**
- high/high/high = do first
- high/high/low = high value but not ready yet (move to tier 3)
- low/low/high = easy but low impact (deprioritize)

### Step 5: Generate HTML report

After presenting the prose playbook, generate a self-contained HTML file using the template at `templates/recommend.html` as a structural and styling reference.

**File name:** same timestamp as the JSON file but with `.html` extension:
```bash
# If JSON was agentscout-recs-20260312T165011.json, HTML is:
agentscout-recs-20260312T165011.html
```

**How to generate:**
1. Read `templates/recommend.html` for the CSS and HTML structure
2. Populate each `.rec` card using the recommendation data from Step 3
3. Use the exact CSS from the template — do not modify styles
4. For each recommendation, include:
   - `.rec-file` — file path and action (create/append)
   - `.rec-title` with `.rec-number` — numbered within tier
   - `.rec-fixes` — one-line summary
   - `.pillars` — three pill badges with correct `.high`/`.med`/`.low` classes
   - `.rec-body` — explanation paragraph
   - `<details>` — collapsible code block with full file content
   - `.evidence` — quoted diagnosis evidence
5. For Tier 4 items, include `.attribution` span if author is known
6. For every recommendation with a `preflight` array, render a `.preflight` block between `.rec-body` and `<details>`. Each preflight item is a `.preflight-item` with icon (✓ pass/green, ! warn/yellow, ✗ fail/red, → info/gray) and text. See template for exact HTML structure.
7. Include the closing summary div
7. Fill in the header meta: date, project count, session count

Write the HTML file alongside the JSON file. Open it for the user:
```bash
open agentscout-recs-TIMESTAMP.html
```

### Rules

- **Claude-native first.** If a CLAUDE.md rule, hook, or config fix solves the problem, do NOT recommend a third-party tool. The user explicitly does not want a sales pitch.
- **Be implementation-specific.** "Add a hook" is not a recommendation. The exact script, the exact settings.json entry, the exact file path — that's a recommendation.
- **Quote the diagnosis.** Every recommendation must trace back to a specific diagnosis finding with quoted evidence.
- **Don't recommend what's already installed.** Cross-reference with the inventory. If the tool exists, the recommendation is "configure it" or "use it", not "install it".
- **Don't recommend generic improvements.** "Better error handling" is not a recommendation. "A PostToolUse hook on Edit that runs `swiftc -typecheck` and surfaces the first 20 lines of errors" is a recommendation.
- **Hooks cannot call MCP tools.** Hooks are shell scripts — they can run CLI commands, not MCP tools. If a recommendation needs MCP tools (Playwright, ios-simulator, circuit-electron), the right mechanism is a CLAUDE.md rule, not a hook. Don't recommend hooks that silently depend on MCP.
- **Tier 4 attribution.** If a Tier 4 item comes from the catalog with a known author, lead with the attribution. If it's a novel synthesis (not from the catalog), say so: "Not a catalog entry — synthesized from patterns across your projects."
- **Closing summary framing.** End with "you may not have encountered yet" for Tier 4, not just "matches your stack." The point is to introduce new tech.
