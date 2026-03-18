# AgentScout

Full pipeline: scan sessions → deep-dive per project → synthesize → recommend → HTML report.

If the user specified a project (e.g., `/agentscout primitive`), pass `--project <name>` to scope to that project only. The filter matches by project short name, path substring, or directory name.

---

## Phase 1: Gather Data

Run both commands. These are deterministic scrapers — no LLM needed.

**1a. Session data:**

```bash
# All projects (default):
AGENTSCOUT_LLM_PROJECT_LIMIT=10 node dist/cli.js --emit-prompts 2>/dev/null

# Single project (if user specified one):
AGENTSCOUT_LLM_PROJECT_LIMIT=10 node dist/cli.js --emit-prompts --project <name> 2>/dev/null
```
Save this output — you'll split it by project in Phase 2. It contains `briefs[]` with per-project: `rawUserMessages`, `rawBashCommands`, `rawToolErrors`, `rawAssistantHandoffs`, `heuristicFindings`, and `implicitSignals`.

The `implicitSignals` field is pre-computed by deterministic fingerprint detectors. It contains:
- `signals[]` — each with `type` (pasted-logs, pasted-errors, pasted-stacktrace, pasted-config, pasted-output, external-observation, proactive-info, url-reference, system-reference, activity-gap), `source` (inferred external system), `evidence`, `messageSnippet`, and `confidence`
- `systemsConsulted[]` — unique external systems the human interacted with
- `totalGapMinutes` — time the human spent outside the session (from tool timestamp gaps)
- `topSources[]` — most-referenced external systems with counts

**1b. Tooling inventory:**
```bash
node dist/cli.js --inventory 2>/dev/null
```
Save this output — every subagent needs it. It contains:
- `mcpServers[]` — every MCP server configured (name, type, command/url, scope)
- `skills[]` — every skill installed (name, description, global/project/external)
- `commands[]` — every slash command available
- `hooks[]` — every hook configured (event, matcher, command)
- `plugins[]` — enabled plugins
- `clis{}` — which common CLIs are in PATH
- `claudeMd{}` — global and project CLAUDE.md content

---

## Phase 2: Per-Project Deep Dive (parallel subagents)

For EACH project brief from Phase 1, spawn a subagent using the Agent tool. Run them in parallel — they are independent.

Each subagent receives:
1. That project's brief (one entry from `briefs[]`)
2. The full tooling inventory
3. The analysis prompt below

**Subagent prompt (copy this exactly, filling in `{PROJECT_BRIEF}` and `{INVENTORY}`):**

---

You are analyzing one project's Claude Code session data to find every place the human acts as glue between systems.

## Project Data
```json
{PROJECT_BRIEF}
```

## Tooling Inventory (what the agent already has access to)
```json
{INVENTORY}
```

## Your Task

Read through `rawUserMessages`, `rawBashCommands`, `rawToolErrors`, and `rawAssistantHandoffs` as a **chronological story**. These are real things the human typed and did.

### Step A: List EVERY human intervention

Go message by message. For each human action that is NOT purely creative direction or aesthetic judgment, create an entry. Do not filter yet — list everything. Be exhaustive.

For each intervention:
- **What the human did**: Quote the message or command verbatim
- **What system they were reading from or writing to**: Name it specifically
- **Why the agent couldn't do this itself**: What's missing?

### Step B: Inventory cross-reference

For EACH intervention from Step A, check the inventory:

1. **Is there an MCP server that covers this?** Check `mcpServers[]` by name. If yes:
   - Is it configured for the right project/org/scope?
   - Was it actually called in the session data? (check tool calls)
   - If available but unused: WHY? Possible reasons:
     - **Misconfigured**: Points to wrong project/org (e.g., Supabase MCP for project A used in project B)
     - **Wrong scope**: Global MCP but project needs different config
     - **No trigger rule**: Agent doesn't know when to use it — no CLAUDE.md rule or skill tells it to
     - **Partial coverage**: MCP exists but doesn't expose the specific tool needed (e.g., ios-simulator has screenshot but no log stream)
     - **Agent tried and failed**: Tool was called but errored — check `rawToolErrors`
     - **Underutilized**: Agent uses some tools from this MCP but not the one that would help here

2. **Is there a skill or command?** Check `skills[]` and `commands[]`. Same analysis — exists but unused? Why?

3. **Is there a hook that should catch this?** Check `hooks[]`. Is there a PostToolUse or PreToolUse that should fire here?

4. **Is there a CLI in PATH?** Check `clis{}`. Could the agent just run this command?

5. **Does CLAUDE.md already address this?** Check `claudeMd{}`. Is there a rule that's being ignored, or is the rule too vague to trigger the right behavior?

For each check, record the result — even "no relevant tool found" is important.

### Step C: Classify each intervention

Assign each intervention to one of these categories:

1. **Missing MCP server**: Human reads from a system with an API that has no MCP server configured. Name the API.

2. **Missing CLI tool / hook**: Human runs a command and feeds output back. That command could be automated.

3. **Missing persistent context**: Human re-explains something from a prior session. Should be in memory/file.

4. **Missing event subscription**: Human polls a status and reports it. Should push into agent context.

5. **Misconfigured or unused existing tool**: The inventory HAS a tool for this, but it's not working. Subcategorize:
   - 5a: **Misconfigured** — tool exists, wrong config (wrong project, wrong scope, missing env var)
   - 5b: **No trigger** — tool exists, right config, but agent doesn't know when to use it (missing CLAUDE.md rule)
   - 5c: **Partial coverage** — tool exists but doesn't expose the needed capability
   - 5d: **Underutilized** — agent uses some capabilities but misses the relevant one
   - 5e: **Better usage possible** — agent uses the tool but in a suboptimal way (e.g., using screenshot when ui_describe_all would be more informative, or not combining tools that work better together)

6. **Missing verification feedback loop**: Agent edits blind, human becomes the runtime's eyes.

7. **Missing inter-agent context**: Human carries context between agent sessions.

8. **Missing skill or workflow convention**: Solvable with a `.md` file, not new infrastructure.

### Step D: Collect raw user voice

Scan `rawUserMessages` for the user's unfiltered reactions. Extract **every** quote where the user:
- Corrects the agent ("no", "wrong", "that's not what I said", "revert", "go back")
- Expresses frustration (expletives, "wtf", "useless", "still broken", "again")
- Resignedly re-explains ("I already told you", "like I said")
- Types fast/angry (visible typos: "dind't", "sam ehook", "impossibel", "shoudn't")
- Bluntly rejects ("I don't like this", "stop", "don't make changes yet")
- Repeats a request 2+ times in a row
- Gives up ("never mind", "forget it", "I'll do it myself")

Keep quotes short — trim to the punchiest part (under ~80 chars). Keep ALL typos. These are the user's real voice. Collect as many as you find — do not filter for "best," collect them all.

### Step E: Separate judgment from integration

For each intervention, ask: **Is this genuinely a taste/judgment call, or is the human doing mechanical work?**

- "make the animation slower" → taste (human-owned)
- "the animation isn't playing at all" → mechanical (agent should verify)
- "use trapezoid designs" → taste
- "the line down the middle is still there" → mechanical (screenshot would catch this)
- "reword for audio" → taste
- "the TTS isn't playing" → mechanical (runtime log would show this)

### Step F: Read between the lines (Implicit Analysis)

The `implicitSignals` field contains pre-detected patterns suggesting the human consulted external systems before or during their messages. This is the "unsaid" layer — what the human DID that they didn't explicitly describe.

**For each implicit signal:**

1. **Validate the inferred source.** The `source` field is a best-guess from pattern matching. Is it correct? Adjust if you can infer better from context.

2. **Connect to explicit interventions.** Does this implicit signal explain WHY the human sent a particular message? For example:
   - A `pasted-logs` signal from "Xcode console" followed by a message about "I'm seeing tcp errors" → the human read Xcode console and relayed what they saw
   - An `activity-gap` of 10 minutes followed by "the deploy is working now" → the human was checking deployment status
   - An `external-observation` "I see..." followed by a UI bug report → the human was looking at the running app

3. **Find INVISIBLE interventions.** Some human actions leave NO trace in the messages:
   - The human checks a dashboard and everything is fine → no message generated, but they still spent time checking
   - The human reads logs and filters mentally → they only paste the relevant part, hiding the reading+filtering work
   - The human switches between browser tabs to compare states → the comparison is implicit
   - The human refreshes a page to see if a deploy landed → the refreshing is invisible

   For `activity-gap` signals, ask: **What was the human probably doing during this gap?** Use surrounding messages as context. **Important:** Longer gaps (30-60 min) are more likely breaks, meetings, or context switches — do NOT assume the user was continuously testing or working outside the session for that entire duration. Only short gaps (5-15 min) reliably indicate active work outside the session (e.g., checking a dashboard, reading logs). Weight your interpretation accordingly.

4. **Identify systems the agent should have been reading.** For each `systemsConsulted` entry:
   - Does the inventory have a tool that can read from this system?
   - If yes, why wasn't the agent reading it directly?
   - If no, what tool would be needed?

5. **Look for the RELAY pattern.** The highest-value implicit finding is:
   > Human reads from System A → mentally processes → types summary into Claude Code

   This is mechanical relay work. The agent should be reading System A directly. Examples:
   - Human reads Railway logs → pastes relevant error → tells agent what to fix
   - Human checks Vercel dashboard → reports deployment failed → agent troubleshoots
   - Human reads Xcode console → filters to relevant error → copies error text
   - Human screenshots iOS Simulator → describes what they see → agent edits code

   For each relay pattern found, add an intervention with `isImplicit: true`.

**Create entries for implicit findings with the same format as Step A, but add:**
- `"isImplicit": true` — this was inferred, not directly quoted
- `"implicitSource"` — the signal type and source that triggered the inference
- For the `quote` field, use the closest user message that connects to the implicit action

### Output Format

Return a JSON object (just the object, no markdown fences):

{
  "project": "project-name",
  "sessionCount": N,
  "interventionCount": N,
  "engineerPerspective": "One sentence: what system boundary is the human brokering?",
  "interventions": [
    {
      "quote": "Direct quote from rawUserMessages or rawBashCommands",
      "humanAction": "What the human physically did",
      "systemBrokered": "What system they were reading from / writing to",
      "inventoryCheck": {
        "mcpServer": "name of relevant MCP or null",
        "skill": "name of relevant skill or null",
        "hook": "relevant hook or null",
        "cli": "relevant CLI or null",
        "claudeMdRule": "relevant rule or null",
        "verdict": "available-and-working | available-but-misconfigured | available-but-no-trigger | available-but-partial | available-but-underutilized | available-but-suboptimal | not-available"
      },
      "category": "1 | 2 | 3 | 4 | 5a | 5b | 5c | 5d | 5e | 6 | 7 | 8",
      "severity": "low | med | high | critical",
      "isJudgmentCall": false,
      "isImplicit": false,
      "implicitSource": null,
      "whyNotJudgment": "Why this is mechanical, not taste (null if isJudgmentCall=true)"
    }
  ],
  "implicitFindings": [
    {
      "quote": "Closest user message connected to this implicit action",
      "humanAction": "What the human actually did (reading logs, checking dashboard, etc.)",
      "systemBrokered": "The external system they consulted",
      "relayPattern": "Human reads [system] → processes → types [action] into Claude Code",
      "inventoryCheck": { "...same as above..." },
      "category": "1 | 2 | 3 | 4 | 5a | 5b | 5c | 5d | 5e | 6 | 7 | 8",
      "severity": "low | med | high | critical",
      "confidence": "low | med | high",
      "whatAgentShouldDo": "Specific action: read logs via X, check dashboard via Y, etc."
    }
  ],
  "judgmentCalls": [
    {
      "quote": "Direct quote",
      "why": "Why this genuinely requires human taste"
    }
  ],
  "rawUserVoice": [
    {
      "quote": "Exact user quote, typos and all",
      "type": "correction | frustration | re-explanation | anger-typo | rejection | repeated-request | giving-up"
    }
  ],
  "systemsHumanBrokered": ["List of ALL external systems the human consulted, from both explicit interventions and implicit signals"],
  "confidenceNotes": ["What you're unsure about"]
}

---

**End of subagent prompt.**

Wait for ALL subagents to complete before proceeding to Phase 3.

---

## Phase 3: Cross-Project Synthesis

You now have deep analysis from every subagent. Your job is to synthesize.

### Step 1: Collect all subagent outputs

Read each subagent's JSON output. You should have one per project. Merge all `rawUserVoice` arrays — these flow into the answers JSON per-project and are used by Phase 5 to populate the quote wall.

### Step 2: Find cross-project patterns

Look for the SAME integration gap appearing across multiple projects:
- Same MCP server unused across projects → systemic awareness problem
- Same category appearing frequently → systemic gap
- Same tool misconfigured in the same way → one config fix covers many projects
- Same external system appearing in `systemsHumanBrokered` across projects → systemic relay pattern
- Same implicit relay pattern (human reads X, tells agent) across projects → highest-leverage integration to build
- Same frustration patterns in `rawUserVoice` across projects → systemic UX failure

### Step 3: Rank findings

Deduplicate findings across projects, then rank using your judgment. Consider:
- Does this gap appear in multiple projects? A gap in 5 projects matters more than one in 1.
- How many sessions does it touch? 200 sessions > 5 sessions.
- How mechanical is the human's role? Pure relay work (pasting logs) ranks higher than nuanced brokering.
- How easy is the fix? A config change that solves it ranks higher than a new MCP to build.

Use these signals holistically — don't formula your way to a ranking. Put the most impactful, most fixable findings first.

### Step 4: Build answers

Generate a timestamped filename in ~/Downloads:
```bash
echo ~/Downloads/"agentscout-answers-$(date +%Y%m%dT%H%M%S).json"
```

Merge the subagent outputs into the answers format. For each project, take the subagent's interventions and select the top findings (by severity) as `fixableInteractions`:

```json
{
  "answers": [
    {
      "project": "project-name",
      "json": {
        "project": "project-name",
        "engineerPerspective": "From subagent output",
        "fixableInteractions": [
          {
            "title": "Name of the finding",
            "category": "1-8 (use 5a/5b/5c/5d/5e for category 5 subcategories)",
            "interactionSurface": "System A <-> Agent (brokered by human)",
            "humanRole": "What the human is physically doing",
            "description": "What happened, with evidence. Quote the user.",
            "severity": "low|med|high|critical",
            "existingToolCheck": "From subagent inventoryCheck — what was checked and the verdict",
            "integration": "The specific fix. Be concrete.",
            "observableSuccess": "How you'd know the human is no longer in this loop",
            "whyNotJustJudgment": "From subagent whyNotJudgment field",
            "evidence": ["Direct quotes"]
          }
        ],
        "implicitFindings": [
          {
            "title": "Name of the implicit finding",
            "relayPattern": "Human reads [system] → processes → types [action]",
            "systemBrokered": "The external system",
            "category": "1-8",
            "severity": "low|med|high|critical",
            "confidence": "low|med|high",
            "integration": "How to remove the human from this relay loop",
            "evidence": ["Closest user messages + implicit signal data"]
          }
        ],
        "systemsHumanBrokered": ["All external systems from both explicit and implicit"],
        "rawUserVoice": [
          {
            "quote": "From subagent rawUserVoice — every frustrated/corrective quote",
            "type": "correction | frustration | re-explanation | anger-typo | rejection | repeated-request | giving-up"
          }
        ],
        "nonFixableJudgment": ["From subagent judgmentCalls"],
        "commodityToIgnore": ["Routine chores identified"],
        "confidenceNotes": ["From subagent + your own"]
      }
    }
  ]
}
```

IMPORTANT: Do NOT write a bare array. The top-level MUST be `{ "answers": [...] }`.

Write the answers file to ~/Downloads, then pipe it:
```bash
cat ~/Downloads/<timestamped-filename>.json | node dist/cli.js --apply-answers 2>/dev/null
```

### Step 5: Present diagnosis as an agentic systems debrief

Write prose, not tables. For each project:
- What system boundary is the human brokering? (1-2 sentences)
- How many total interventions were found? How many are explicit vs implicit? How many are category 5?
- **Explicit findings** (top 2-3): what the human said or did directly
  - The systems involved
  - Quoted evidence from the human
  - For category 5: name the tool, the subcategory (5a-5e), and the specific fix
  - For other categories: the integration that would remove the human from this loop
- **Implicit findings** (top 2-3): what the human was doing BETWEEN messages
  - The relay pattern: "Human reads [X] → filters mentally → types [Y]"
  - What system they were consulting and how we know (fingerprint evidence)
  - What the agent should be doing instead (specific tool/MCP/hook)
  - Confidence level and what would increase it
- What genuinely stays human-owned and why?

Then across ALL projects, list the **top 5 concrete things to fix or build**, ranked by the cross-project scoring from Step 3. For each:
- Name it
- Type: config fix / CLAUDE.md rule / hook / skill / new MCP / new CLI
- What it changes or wraps
- Which projects and how many sessions it affects
- Quoted evidence from at least 2 projects if it appears cross-project
- Why it's highest leverage

For category 5 findings, be specific about the subcategory:
- 5a (misconfigured): "Change the Supabase MCP project_ref from X to Y in .claude/settings.json"
- 5b (no trigger): "Add CLAUDE.md rule: after editing .swift files, use ios-simulator screenshot"
- 5c (partial): "ios-simulator MCP has screenshot but no log stream — need to build log stream tool"
- 5d (underutilized): "Agent calls screenshot but never calls ui_describe_all, which would catch layout bugs"
- 5e (suboptimal): "Agent screenshots the whole page but should screenshot specific components for faster verification"

DO NOT abstract back up. No "the deepest pattern is X" summaries. Stay at the level of "build this specific thing, here's what it wraps, here's the tool it exposes." If you catch yourself writing a sentence that could appear in a McKinsey deck, delete it and write an implementation spec instead.

Be opinionated. Be specific. Quote the data.

---

## Phase 4: Generate Recommendations

Now take the diagnosis findings and recommend concrete fixes, scored on three pillars.

### Step 1: Load catalogs

**1a. Update claude-native.md with the latest Claude Code features:**

Before reading the catalogs, fetch the latest Claude Code documentation to ensure `catalog/claude-native.md` reflects current capabilities:

```
Use WebFetch to read https://docs.anthropic.com/en/docs/claude-code/overview
```

Compare the fetched content against `catalog/claude-native.md`. If there are new features, hooks, tools, or capabilities not yet documented in the file, update it. Common things to check:
- New hook events (beyond PreToolUse, PostToolUse, etc.)
- New built-in tools
- New plugin types
- New MCP configuration options
- New memory or skill capabilities

**1b. Read the catalogs:**
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

Statuses: `pass` (green check), `warn` (yellow !), `fail` (red x), `info` (gray arrow).

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

Write to a timestamped file in ~/Downloads:
```bash
echo ~/Downloads/"agentscout-recs-$(date +%Y%m%dT%H%M%S).json"
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

---

## Phase 5: Present as Actionable Playbook

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

---

## Phase 6: Generate HTML Report

After presenting the prose playbook, generate a self-contained HTML file using the template at `templates/recommend.html` as a structural and styling reference.

**File name:** same timestamp as the JSON file but with `.html` extension, in ~/Downloads:
```bash
# If JSON was ~/Downloads/agentscout-recs-20260312T165011.json, HTML is:
~/Downloads/agentscout-recs-20260312T165011.html
```

**How to generate:**
1. Read `templates/recommend.html` for the CSS and HTML structure
2. **Populate the Wrapped card** at the top of the report using `wrappedStats` from the Phase 1 emit-prompts output. Fill in:
   - `{{totalProjects}}`, `{{totalSessions}}`, `{{totalTokensFormatted}}` — the three big stat numbers
   - `{{firstSessionDate}}` — e.g. "Oct 2024"
   - `{{mostActiveProject}}` — project name, `{{mostActiveProjectSessions}}` — its session count
   - `{{busiestVsAverage}}` — e.g. "4x more sessions than your average project" (omit this insight line if null)
   - `{{uniqueToolsUsed}}` — number of unique tools
   - `{{totalBashCommands}}` — formatted with commas (e.g. "1,847")
3. Populate each `.rec` card using the recommendation data from Phase 4 Step 3
4. Use the exact CSS from the template — do not modify styles
5. For each recommendation, include:
   - `.rec-file` — file path and action (create/append)
   - `.rec-title` with `.rec-number` — numbered within tier
   - `.rec-fixes` — one-line summary
   - `.pillars` — three pill badges with correct `.high`/`.med`/`.low` classes
   - `.rec-body` — explanation paragraph
   - `<details>` — collapsible code block with full file content
   - `.evidence` — quoted diagnosis evidence
6. For Tier 4 items, include `.attribution` span if author is known
7. For every recommendation with a `preflight` array, render a `.preflight` block between `.rec-body` and `<details>`. Each preflight item is a `.preflight-item` with icon (check pass/green, ! warn/yellow, x fail/red, arrow info/gray) and text. See template for exact HTML structure.
8. Include the closing summary div
9. Fill in the header meta: date, project count, session count

Write the HTML file alongside the JSON file in ~/Downloads. Open it for the user:
```bash
open ~/Downloads/agentscout-recs-TIMESTAMP.html
```

**Tell the user where the files are saved.** After opening the HTML, print a message like:

> Your AgentScout report and data files have been saved to **~/Downloads/**:
> - `agentscout-recs-TIMESTAMP.html` (report)
> - `agentscout-recs-TIMESTAMP.json` (recommendations data)
> - `agentscout-answers-TIMESTAMP.json` (diagnosis data)


---

## Rules

- **Claude-native first.** If a CLAUDE.md rule, hook, or config fix solves the problem, do NOT recommend a third-party tool. The user explicitly does not want a sales pitch.
- **Be implementation-specific.** "Add a hook" is not a recommendation. The exact script, the exact settings.json entry, the exact file path — that's a recommendation.
- **Quote the diagnosis.** Every recommendation must trace back to a specific diagnosis finding with quoted evidence.
- **Don't recommend what's already installed.** Cross-reference with the inventory. If the tool exists, the recommendation is "configure it" or "use it", not "install it".
- **Don't recommend generic improvements.** "Better error handling" is not a recommendation. "A PostToolUse hook on Edit that runs `swiftc -typecheck` and surfaces the first 20 lines of errors" is a recommendation.
- **Hooks cannot call MCP tools.** Hooks are shell scripts — they can run CLI commands, not MCP tools. If a recommendation needs MCP tools (Playwright, ios-simulator, circuit-electron), the right mechanism is a CLAUDE.md rule, not a hook. Don't recommend hooks that silently depend on MCP.
- **Tier 4 attribution.** If a Tier 4 item comes from the catalog with a known author, lead with the attribution. If it's a novel synthesis (not from the catalog), say so: "Not a catalog entry — synthesized from patterns across your projects."
- **Closing summary framing.** End with "you may not have encountered yet" for Tier 4, not just "matches your stack." The point is to introduce new tech.
