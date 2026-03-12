# AgentScout Live Diagnosis

3-phase workflow diagnosis: gather data, deep-dive per project with subagents, synthesize across projects.

## Phase 1: Gather Data

Run both commands. These are deterministic scrapers — no LLM needed.

**1a. Session data:**
```bash
AGENTSCOUT_LLM_PROJECT_LIMIT=10 node dist/cli.js --emit-prompts 2>/dev/null
```
Save this output — you'll split it by project in Phase 2. It contains `briefs[]` with per-project: `rawUserMessages`, `rawBashCommands`, `rawToolErrors`, `rawAssistantHandoffs`, `heuristicFindings`.

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

### Step D: Separate judgment from integration

For each intervention, ask: **Is this genuinely a taste/judgment call, or is the human doing mechanical work?**

- "make the animation slower" → taste (human-owned)
- "the animation isn't playing at all" → mechanical (agent should verify)
- "use trapezoid designs" → taste
- "the line down the middle is still there" → mechanical (screenshot would catch this)
- "reword for audio" → taste
- "the TTS isn't playing" → mechanical (runtime log would show this)

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
      "whyNotJudgment": "Why this is mechanical, not taste (null if isJudgmentCall=true)"
    }
  ],
  "judgmentCalls": [
    {
      "quote": "Direct quote",
      "why": "Why this genuinely requires human taste"
    }
  ],
  "confidenceNotes": ["What you're unsure about"]
}

---

**End of subagent prompt.**

Wait for ALL subagents to complete before proceeding to Phase 3.

## Phase 3: Cross-Project Synthesis

You now have deep analysis from every subagent. Your job is to synthesize.

### Step 1: Collect all subagent outputs

Read each subagent's JSON output. You should have one per project.

### Step 2: Find cross-project patterns

Look for the SAME integration gap appearing across multiple projects:
- Same MCP server unused across projects → systemic awareness problem
- Same category appearing frequently → systemic gap
- Same tool misconfigured in the same way → one config fix covers many projects

### Step 3: Rank findings

Deduplicate findings across projects, then rank using your judgment. Consider:
- Does this gap appear in multiple projects? A gap in 5 projects matters more than one in 1.
- How many sessions does it touch? 200 sessions > 5 sessions.
- How mechanical is the human's role? Pure relay work (pasting logs) ranks higher than nuanced brokering.
- How easy is the fix? A config change that solves it ranks higher than a new MCP to build.

Use these signals holistically — don't formula your way to a ranking. Put the most impactful, most fixable findings first.

### Step 4: Build answers

Generate a timestamped filename:
```bash
echo "agentscout-answers-$(date +%Y%m%dT%H%M%S).json"
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
        "nonFixableJudgment": ["From subagent judgmentCalls"],
        "commodityToIgnore": ["Routine chores identified"],
        "confidenceNotes": ["From subagent + your own"]
      }
    }
  ]
}
```

IMPORTANT: Do NOT write a bare array. The top-level MUST be `{ "answers": [...] }`.

Write the answers file, then pipe it:
```bash
cat <timestamped-filename>.json | node dist/cli.js --apply-answers 2>/dev/null
```

### Step 5: Present as an agentic systems debrief

Write prose, not tables. For each project:
- What system boundary is the human brokering? (1-2 sentences)
- How many total interventions were found? How many are category 5 (existing tool issues)?
- The top 2-3 findings, with:
  - The systems involved
  - Quoted evidence from the human
  - For category 5: name the tool, the subcategory (5a-5e), and the specific fix
  - For other categories: the integration that would remove the human from this loop
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
