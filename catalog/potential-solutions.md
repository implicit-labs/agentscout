# Potential Solutions Catalog

Curated from community recommendations, open-source discovery, and web research (updated 2026-03-13). These are tools, MCPs, CLIs, skills, and techniques that solve real agentic coding workflow problems.

Pillar scores: **HI** = Handoff Index, **TR** = Time Reclaimed, **AR** = Agent Readiness. Scale: low / med / high.

## MCP Servers

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **Figma MCP** (Anthropic) | [github](https://github.com/anthropics/mcp-figma) | Design-to-code bridge | high | high | high | Blind UI iteration, design handoff |
| **Sketch MCP** | [github](https://github.com/nicklama/sketch-mcp) | Design file access for agents | high | med | med | Design handoff |
| **iOS Simulator MCP / Haptix** | [github](https://github.com/nicklama/ios-simulator-mcp) | Agent controls iOS sim (tap, swipe, screenshot) | high | high | med | Blind iOS iteration, verification loop |
| **FlowDeck** | [github](https://github.com/nicklama/flowdeck) | Agent sees + interacts with iOS simulator visually | high | high | med | Blind iOS iteration |
| **Browserbase MCP** | [github](https://github.com/browserbase/mcp-server-browserbase) | Cloud browser for agents | med | med | high | Browser verification without local deps |
| **agent-browser** (@ctatedev) | [github](https://github.com/nicklama/agent-browser) | Agents control Slack/Discord/Notion/Figma via browser | high | med | med | Dashboard-to-CLI, cross-app context |
| **Linear MCP** | [github](https://github.com/linear/linear-mcp) | Issue tracking access for agents | high | high | high | Project management context, issue lookup |
| **Sequential Thinking MCP** | [github](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) | Structured reasoning server | low | low | med | Complex multi-step reasoning |
| **FastMCP** | [github](https://github.com/jlowin/fastmcp) | Fast MCP server framework | med | med | high | Building custom MCPs quickly |
| **Astro MCP** | [site](https://www.astro-mcp.com) | App Store Optimization | med | med | low | ASO workflow |
| **Nozomio** | [site](https://nozomio.com) | PDF/document search & RAG API | med | med | med | Document context for agents |
| **Context Hub** (@AndrewYNg) | [github](https://github.com/andrewng-team/context-hub) | Up-to-date API docs for coding agents | med | med | med | Stale documentation context |
| **Toggle AI** | [site](https://toggleai.dev) | Real-time browser context for agents | med | med | med | Browser state awareness |
| **Context7** (Upstash) | [github](https://github.com/upstash/context7) | Live version-specific library docs | high | high | high | Stale/hallucinated API docs |
| **XcodeBuild MCP** (Sentry) | [github](https://github.com/getsentry/XcodeBuildMCP) | Build, test, manage Xcode projects from agent | high | high | high | iOS build-fix loop |
| **Claude Context MCP** (Zilliz) | [github](https://github.com/zilliztech/claude-context) | Semantic code search across entire codebase | med | high | high | Finding code in large repos |
| **OSM MCP** | [github](https://github.com/wiseman/osm-mcp) | Query and visualize OpenStreetMap data | med | med | med | Geospatial data access |
| **Metorial** | [github](https://github.com/metorial/metorial) | Connects AI to APIs and tools via MCP | med | med | med | Universal API integration |
| **Godot MCP** | [github](https://github.com/bradypp/godot-mcp) | AI assistant for Godot game engine | med | med | med | Game dev workflow |
| **MCP SuperAssistant** | [github](https://github.com/srbhptl39/MCP-SuperAssistant) | MCP in ChatGPT, DeepSeek, Perplexity, Grok | med | med | med | Cross-platform MCP access |
| **Knowledge Work Plugins** (Anthropic) | [github](https://github.com/anthropics/knowledge-work-plugins) | Enterprise tool connectors (Jira, Confluence, etc.) | high | med | high | Enterprise tool relay |
| **Claude Code MCP** (@steipete) | [github](https://github.com/steipete/claude-code-mcp) | Agent-in-agent delegation | med | med | high | Nested agent tasks |
| **MCP Agent Mail** | [github](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) | Inter-agent messaging coordination | med | med | med | Multi-agent comms |

## CLIs

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **Taskmaster** (@blader) | [github](https://github.com/blader/taskmaster) | Long-running agent task management | med | med | med | Multi-step task tracking |
| **tskrun** | [github](https://github.com/tskrun/tskrun) | Task tracking for agents | med | med | med | Task state across sessions |
| **dotenvx** | [github](https://github.com/dotenvx/dotenvx) | Encrypted .env files | low | med | high | Secret leakage prevention |
| **ReactScope** | [github](https://github.com/nicklama/reactscope) | Component docs for agents AND humans | med | med | med | Inter-agent component context |
| **GitHub CLI (gh)** | [github](https://github.com/cli/cli) | CI failures, PRs, reviewers | high | high | high | CI/CD feedback loop, PR workflow |
| **cmux** | [github](https://github.com/nicklama/cmux) | Terminal built for coding agents (Ghostty-based) | med | med | med | Multi-agent terminal orchestration |
| **TestFlight CLI / ASC CLI** (@rudrank) | [github](https://github.com/nicklama/app-store-connect-cli) | Automate App Store submissions | high | high | med | iOS deployment pipeline |
| **React Doctor** | [github](https://github.com/millionco/react-doctor) | Scan React codebase for anti-patterns | med | med | high | Code quality verification |
| **Maestro** | [github](https://github.com/mobile-dev-inc/maestro) | Automated mobile app testing | high | high | med | Mobile UI verification loop |
| **Claude Squad** | [github](https://github.com/smtg-ai/claude-squad) | Manage multiple agents in parallel workspaces | high | med | high | Multi-agent orchestration |
| **Claude Flow (ruflo)** | [github](https://github.com/ruvnet/claude-flow) | Multi-agent swarm coordination | high | high | med | Autonomous multi-agent workflows |
| **ccusage** | [github](https://github.com/ryoppippi/ccusage) | Token usage + cost dashboard from local logs | low | med | high | Agent cost monitoring |
| **Shotgun** | [github](https://github.com/shotgun-sh/shotgun) | Split features into staged, reviewable PRs | high | med | med | Large-change PR review |
| **Claude Code Damage Control** | [github](https://github.com/disler/claude-code-damage-control) | Block dangerous commands for Claude Code | low | med | high | Agent safety guardrails |

## Skills / Slash Commands

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **shadcn/skills** | [github](https://github.com/shadcn-ui/skills) | Component context (Radix, Base UI, patterns) | med | med | high | Component API context |
| **/loop** | built-in | Recurring tasks, cron-like | med | high | high | Polling, status checking |
| **/orchestrate** | built-in | Auto-spawn and manage subagents | high | med | high | Multi-agent coordination |
| **Autonomous Dogfooding** | technique | Agents use your app like users do | high | high | med | Verification feedback loop |
| **Codex babysit-PR** | technique | Watch PRs, fix CI, resolve comments | high | high | med | CI feedback loop, PR maintenance |
| **skill-creator** (@RLanceMartin) | [github](https://github.com/RLanceMartin/skill-creator) | Create skills with built-in test generation | med | med | high | Skill development workflow |
| **HyperGraph** | [github](https://github.com/nicklama/hypergraph) | Linked skill nodes instead of monolithic files | med | med | med | Skill organization |
| **gstack** (@garrytan) | [github](https://github.com/garrytan/gstack) | 6 opinionated skills: CEO, eng manager, release mgr, QA | med | med | high | Battle-tested skill bundle |
| **Learning Opportunities** | [github](https://github.com/DrCatHicks/learning-opportunities) | Skill development during agentic coding | med | med | med | Teaching while coding |

## Prompting Techniques / Hacks

| Technique | Link | Description | HI | TR | AR | Solves |
|-----------|------|-------------|----|----|----|----|
| **Git commits as prompts** (@joelhooks) | [tweet](https://x.com/joelhooks) | Commits written so another agent can recreate work | high | high | high | Inter-agent context, session handoff |
| **Context handoff protocol** (@tolibear_) | [tweet](https://x.com/tolibear_) | Makes 200k context feel infinite | high | high | high | Context death between sessions |
| **Design tokens + linter on pre-commit** (@ryancarson) | [tweet](https://x.com/ryancarson) | Enforce design system via hooks | med | med | high | Design consistency, blind UI edits |
| **SPEC.md = destination, PLAN.md = journey** (@mattpocockuk) | [tweet](https://x.com/mattpocockuk) | Separate intent from approach | med | med | high | Planning clarity |
| **Token-aware file splitting** (@mattpocockuk) | [tweet](https://x.com/mattpocockuk) | Split files over 5K tokens | med | med | high | Context window management |

## Agent Frameworks / Orchestration

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **Anthropic Agent SDK** (TS + Python) | [github](https://github.com/anthropics/agent-sdk) | Build custom agents | high | med | high | Custom agent workflows |
| **Paperclip** | [github](https://github.com/nicklama/paperclip) | Agent governance + orchestration | high | med | med | Multi-agent coordination, governance |
| **Guardian** | [github](https://github.com/nicklama/guardian) | Agent watchdog, auto-fix crashes, git rollback | med | med | med | Agent error recovery |
| **Readout** | [github](https://github.com/nicklama/readout) | Session transcripts, tool usage, cost projections | med | med | high | Session observability |
| **MS Agent Governance Toolkit** | [github](https://github.com/microsoft/agent-governance-toolkit) | Security middleware for autonomous agents | med | med | med | Agent policy enforcement |

## Memory / Context

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **Claude Code auto-memory** | built-in | Built-in, remembers across sessions | high | high | high | Context death between sessions |
| **claude-subconscious** (Letta) | [github](https://github.com/letta/claude-subconscious) | Watches sessions, learns patterns, injects memory | high | high | med | Implicit pattern learning |
| **gigabrain** | [github](https://github.com/nicklama/gigabrain) | Memory OS for agents, 6 types of memory | high | med | med | Structured memory |
| **Nozomio index API** | [site](https://nozomio.com) | Index repos, docs, Slack, local folders | med | med | med | Cross-system context |
| **PRD Graphs** (@arscontexta) | [tweet](https://x.com/arscontexta) | Company knowledge graphs for agents | med | med | low | Organizational context |
| **Shodh Memory** | [github](https://github.com/varun29ankuS/shodh-memory) | Memory with decay and associations | med | med | med | Biologically-inspired persistence |

## Verification / Testing

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **Claude Code Review** | built-in plugin | Automated PR review | high | med | high | Code review feedback loop |
| **Devin Review** | [site](https://devin.ai) | Free PR review, no signup | high | med | high | Code review feedback loop |
| **Maestro** | [github](https://github.com/mobile-dev-inc/maestro) | Automated mobile app testing | high | high | med | Mobile verification loop |
| **MotionEyes** | [github](https://github.com/nicklama/motioneyes) | Screenshot sequences during animation | med | med | med | Animation verification |
| **Inject** | [github](https://github.com/nicklama/inject) | Hot reloading for SwiftUI (replaces Previews) | med | high | med | iOS UI iteration speed |
| **Pie** | [site](https://pie.dev) | Connects PostHog, RevenueCat, Superwall, GitHub | med | med | med | Product intelligence context |

## Multi-Agent / Terminal

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **Claude Code teams + tmux** | technique | Multi-pane orchestration | high | med | high | Parallel agent work |
| **Ghostty scripting** | [github](https://github.com/ghostty-org/ghostty) | Delegate work to new sessions via AppleScript | med | med | med | Agent session spawning |
| **Agent-tail** | [github](https://github.com/nicklama/agent-tail) | Tail logs from agent sessions | med | med | med | Agent observability |
| **Remote Control** | technique | Control Claude Code from phone | low | low | med | Mobile agent access |

## Development Methodology

| Tool | Link | Description | HI | TR | AR | Solves |
|------|------|-------------|----|----|----|----|
| **BMAD Method** | [github](https://github.com/bmad-code-org/BMAD-METHOD) | AI + agile development module | med | med | med | Structured agent dev workflow |
| **Ledger** | [github](https://github.com/peterjthomson/ledger) | Git interface tracking agent vs human contributions | med | med | med | Agent contribution tracking |
| **OpenCode Agent Skills** | [github](https://github.com/joshuadavidthomas/opencode-agent-skills) | Plugin for loading and using AI agent skills | med | med | med | Skill management |
