# Potential Solutions Catalog

Curated from Twitter bookmarks (2026-03-11). These are tools, MCPs, CLIs, skills, and techniques that solve real agentic coding workflow problems.

Pillar scores: **HI** = Handoff Index, **TR** = Time Reclaimed, **AR** = Agent Readiness. Scale: low / med / high.

## MCP Servers

| Tool | Description | HI | TR | AR | Solves |
|------|-------------|----|----|----|----|
| **Figma MCP** (Anthropic) | Design-to-code bridge | high | high | high | Blind UI iteration, design handoff |
| **Sketch MCP** | Design file access for agents | high | med | med | Design handoff |
| **iOS Simulator MCP / Haptix** | Agent controls iOS sim (tap, swipe, screenshot) | high | high | med | Blind iOS iteration, verification loop |
| **FlowDeck** | Agent sees + interacts with iOS simulator visually | high | high | med | Blind iOS iteration |
| **Browserbase MCP** | Cloud browser for agents | med | med | high | Browser verification without local deps |
| **agent-browser** (@ctatedev) | Agents control Slack/Discord/Notion/Figma via browser | high | med | med | Dashboard-to-CLI, cross-app context |
| **Linear MCP** | Issue tracking access for agents | high | high | high | Project management context, issue lookup |
| **Sequential thinking MCP** | Structured reasoning server | low | low | med | Complex multi-step reasoning |
| **FastMCP** | Fast MCP server framework | med | med | high | Building custom MCPs quickly |
| **Astro MCP** | App Store Optimization | med | med | low | ASO workflow |
| **Nozomio** | PDF/document search & RAG API | med | med | med | Document context for agents |
| **Context Hub** (@AndrewYNg) | Up-to-date API docs for coding agents | med | med | med | Stale documentation context |
| **Toggle AI** | Real-time browser context for agents | med | med | med | Browser state awareness |

## CLIs

| Tool | Description | HI | TR | AR | Solves |
|------|-------------|----|----|----|----|
| **Taskmaster** (@blader) | Long-running agent task management | med | med | med | Multi-step task tracking |
| **tskrun** | Task tracking for agents | med | med | med | Task state across sessions |
| **dotenvx** | Encrypted .env files | low | med | high | Secret leakage prevention |
| **ReactScope** | Component docs for agents AND humans | med | med | med | Inter-agent component context |
| **GitHub CLI (gh)** | CI failures, PRs, reviewers | high | high | high | CI/CD feedback loop, PR workflow |
| **cmux** | Terminal built for coding agents (Ghostty-based) | med | med | med | Multi-agent terminal orchestration |
| **TestFlight CLI / ASC CLI** (@rudrank) | Automate App Store submissions | high | high | med | iOS deployment pipeline |
| **React Doctor** | Scan React codebase for anti-patterns | med | med | high | Code quality verification |
| **Maestro** | Automated mobile app testing | high | high | med | Mobile UI verification loop |

## Skills / Slash Commands

| Tool | Description | HI | TR | AR | Solves |
|------|-------------|----|----|----|----|
| **shadcn/skills** | Component context (Radix, Base UI, patterns) | med | med | high | Component API context |
| **/loop** | Recurring tasks, cron-like | med | high | high | Polling, status checking |
| **/orchestrate** | Auto-spawn and manage subagents | high | med | high | Multi-agent coordination |
| **Autonomous Dogfooding** | Agents use your app like users do | high | high | med | Verification feedback loop |
| **Codex babysit-PR** | Watch PRs, fix CI, resolve comments | high | high | med | CI feedback loop, PR maintenance |
| **skill-creator** (@RLanceMartin) | Create skills with built-in test generation | med | med | high | Skill development workflow |
| **HyperGraph** | Linked skill nodes instead of monolithic files | med | med | med | Skill organization |

## Prompting Techniques / Hacks

| Technique | Description | HI | TR | AR | Solves |
|-----------|-------------|----|----|----|----|
| **Git commits as prompts** (@joelhooks) | Commits written so another agent can recreate work | high | high | high | Inter-agent context, session handoff |
| **Context handoff protocol** (@tolibear_) | Makes 200k context feel infinite | high | high | high | Context death between sessions |
| **Design tokens + linter on pre-commit** (@ryancarson) | Enforce design system via hooks | med | med | high | Design consistency, blind UI edits |
| **SPEC.md = destination, PLAN.md = journey** (@mattpocockuk) | Separate intent from approach | med | med | high | Planning clarity |
| **Token-aware file splitting** (@mattpocockuk) | Split files over 5K tokens | med | med | high | Context window management |

## Agent Frameworks / Orchestration

| Tool | Description | HI | TR | AR | Solves |
|------|-------------|----|----|----|----|
| **Anthropic Agent SDK** (TS + Python) | Build custom agents | high | med | high | Custom agent workflows |
| **Paperclip** | Agent governance + orchestration | high | med | med | Multi-agent coordination, governance |
| **Guardian** | Agent watchdog, auto-fix crashes, git rollback | med | med | med | Agent error recovery |
| **Readout** | Session transcripts, tool usage, cost projections | med | med | high | Session observability |

## Memory / Context

| Tool | Description | HI | TR | AR | Solves |
|------|-------------|----|----|----|----|
| **Claude Code auto-memory** | Built-in, remembers across sessions | high | high | high | Context death between sessions |
| **claude-subconscious** (Letta) | Watches sessions, learns patterns, injects memory | high | high | med | Implicit pattern learning |
| **gigabrain** | Memory OS for agents, 6 types of memory | high | med | med | Structured memory |
| **Nozomio index API** | Index repos, docs, Slack, local folders | med | med | med | Cross-system context |
| **PRD Graphs** (@arscontexta) | Company knowledge graphs for agents | med | med | low | Organizational context |

## Verification / Testing

| Tool | Description | HI | TR | AR | Solves |
|------|-------------|----|----|----|----|
| **Claude Code Review** | Automated PR review | high | med | high | Code review feedback loop |
| **Devin Review** | Free PR review, no signup | high | med | high | Code review feedback loop |
| **Maestro** | Automated mobile app testing | high | high | med | Mobile verification loop |
| **MotionEyes** | Screenshot sequences during animation | med | med | med | Animation verification |
| **Inject** | Hot reloading for SwiftUI (replaces Previews) | med | high | med | iOS UI iteration speed |
| **Pie** | Connects PostHog, RevenueCat, Superwall, GitHub | med | med | med | Product intelligence context |

## Multi-Agent / Terminal

| Tool | Description | HI | TR | AR | Solves |
|------|-------------|----|----|----|----|
| **Claude Code teams + tmux** | Multi-pane orchestration | high | med | high | Parallel agent work |
| **Ghostty scripting** | Delegate work to new sessions via AppleScript | med | med | med | Agent session spawning |
| **Agent-tail** | Tail logs from agent sessions | med | med | med | Agent observability |
| **Remote Control** | Control Claude Code from phone | low | low | med | Mobile agent access |
