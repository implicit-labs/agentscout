# AgentScout Live Diagnosis

3-phase workflow diagnosis: gather data, deep-dive per project with subagents, synthesize across projects.

## Phase 1: Gather Data

Run both commands. These are deterministic scrapers — no LLM needed.

**1a. Session data:**

If the user specified a project (e.g., `/diagnose primitive`), pass `--project <name>` to scope to that project only. The filter matches by project short name, path substring, or directory name.

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

### Step E: Read between the lines (Implicit Analysis)

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

## Phase 3: Cross-Project Synthesis

You now have deep analysis from every subagent. Your job is to synthesize.

### Step 1: Collect all subagent outputs

Read each subagent's JSON output. You should have one per project. Merge all `rawUserVoice` arrays — these flow into the answers JSON per-project and are used by `/recommend` to populate the quote wall.

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

Write the answers file, then pipe it:
```bash
cat <timestamped-filename>.json | node dist/cli.js --apply-answers 2>/dev/null
```

### Step 5: Present as an agentic systems debrief

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
