# Claude Code Native Features

Built-in mechanisms that solve workflow problems without third-party tools. Always prefer these first.

## Hooks (`.claude/settings.json` → `hooks`)

Event-driven shell scripts that run automatically on tool use.

| Event | When it fires | Use case |
|-------|--------------|----------|
| `PreToolUse` | Before a tool executes | Validate inputs, block dangerous commands, lint before edit |
| `PostToolUse` | After a tool succeeds | Auto-screenshot after UI edit, run type-check after code change, update changelog |
| `PostToolUseFailure` | After a tool fails | Log errors, alert user, auto-retry with different approach |
| `UserPromptSubmit` | When user sends a message | Inject context, route to skills, log interactions |
| `Stop` | When agent finishes a turn | Cleanup, notifications, session summary |
| `Notification` | On agent notifications | Forward to Slack, phone, etc. |
| `SubagentStop` | When a subagent finishes | Aggregate results, chain workflows |
| `PermissionRequest` | When agent needs permission | Custom approval flows |

**Hook receives JSON on stdin:**
```json
{
  "hook_type": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": { "file_path": "...", "old_string": "...", "new_string": "..." },
  "session_id": "...",
  "cwd": "/path/to/project"
}
```

**Hook can return JSON on stdout to modify behavior:**
```json
{ "decision": "block", "reason": "File is read-only" }
```

**Example: Auto-screenshot after UI file edit:**
```bash
#!/bin/bash
# .claude/hooks/auto-screenshot.sh
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [[ "$FILE" == *.tsx || "$FILE" == *.vue || "$FILE" == *.svelte ]]; then
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q 200; then
    npx playwright screenshot --url http://localhost:3000 /tmp/auto-verify.png 2>/dev/null
  fi
fi
```

**Example: Swift type-check after edit:**
```bash
#!/bin/bash
# .claude/hooks/swift-typecheck.sh
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [[ "$FILE" == *.swift ]]; then
  xcrun swiftc -typecheck -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
    -target arm64-apple-ios17.0-simulator "$FILE" 2>&1 | head -20
fi
```

## Memory (`~/.claude/projects/*/memory/`)

Persistent file-based memory across sessions. Agent reads/writes `.md` files with frontmatter.

**Types:** user, feedback, project, reference

**Solves:** Human re-explaining preferences, context dying between sessions, agent repeating mistakes.

**Example:** After user says "sort by recency not pain score", save a feedback memory so next session knows.

## Skills (`~/.claude/skills/`)

Reusable instruction sets the agent auto-invokes. Each skill is a directory with `SKILL.md`.

**Solves:** Repeated multi-step workflows, missing conventions, agent not following project patterns.

**Example:** `ios-verify` skill that orchestrates build → install → launch → screenshot → describe after code changes.

## Commands (`~/.claude/commands/`)

Slash commands (`.md` files) users invoke explicitly. Can contain multi-step instructions with bash blocks.

**Solves:** Standardizing workflows, ensuring consistency, packaging expertise.

## CLAUDE.md Rules

Project-level instructions the agent always follows. Lives at project root or `.claude/CLAUDE.md`.

**Solves:** Agent not using available tools, missing conventions, repeated mistakes.

**Example rules:**
```markdown
## iOS Verification
After editing .swift files and successful xcodebuild, use ios-simulator MCP
to screenshot and ui_describe_all before reporting done.

## Linear Issue Lookup
When the user references a Linear issue by description, use mcp__linear__list_issues
to search rather than asking for the issue number.

## Deploy Verification
After git push on this project, run `vercel ls` to check deployment status.
```

## Plugins

Marketplace plugins that extend Claude Code with specialized tools.

| Plugin | What it adds |
|--------|-------------|
| `swift-lsp` | Swift language server integration |
| `playwright` | Browser automation (navigate, click, screenshot, snapshot) |
| `superpowers` | Enhanced skills, code review, worktrees, parallel agents |

## Built-in Tools

Already available without any configuration:

| Tool | Purpose |
|------|---------|
| `Read` / `Edit` / `Write` | File operations |
| `Bash` | Shell command execution |
| `Glob` / `Grep` | File search |
| `Agent` | Spawn subagents for parallel work |
| `WebSearch` / `WebFetch` | Web research |
| `AskUserQuestion` | Ask clarifying questions |

## MCP Servers (`.claude/mcp.json`)

Model Context Protocol servers that give the agent access to external systems.

**Global:** `~/.claude/mcp.json` — available in all projects
**Project:** `.claude/settings.json` or `.mcp.json` — scoped to one project

**Key pattern:** When the diagnosis says "human reads from dashboard X and pastes into agent", the fix is often an MCP server wrapping X's API.

## Project-Level Overrides (`.claude/settings.local.json`)

Override global MCP configs, permissions per project.

**Solves:** MCP pointing to wrong project/org, permissions too broad/narrow for specific repo.
