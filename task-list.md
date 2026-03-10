# Task List: AgentScout CLI

## Phase 1: Project Setup
- [ ] 1.1 Initialize npm package (package.json with bin field, tsconfig, tsup config)
- [ ] 1.2 Set up TypeScript + Ink v6 + chalk dependencies
- [ ] 1.3 Create CLI entry point with shebang, verify `npx` works locally
- [ ] 1.4 Set up project structure (scanner/, analyzer/, catalog/, ui/)

## Phase 2: Session Scanner
- [ ] 2.1 Discover `~/.claude/projects/` directory and enumerate projects
- [ ] 2.2 Read `sessions-index.json` files for fast metadata access
- [ ] 2.3 Parse JSONL session logs (tool calls, user messages, errors, token usage)
- [ ] 2.4 Build pattern extraction (tool call frequency, Bash command analysis, error clusters)

## Phase 3: Pattern Detection & Curated Catalog
- [ ] 3.1 Define pattern signatures (e.g., "frequent git Bash commands", "database queries in Bash", "manual file management")
- [ ] 3.2 Build curated tools.json with ~20-30 entries (MCP servers, CLI tools, packages)
- [ ] 3.3 Write matcher that maps detected patterns → curated tool recommendations
- [ ] 3.4 Implement relevance filtering (only recommend tools relevant to detected patterns)

## Phase 4: AI Description Generation
- [ ] 4.1 Build `claude -p` pipe utility (shell out, handle errors, timeout)
- [ ] 4.2 Craft prompt template for pain-focused descriptions
- [ ] 4.3 Batch analysis to minimize subprocess calls
- [ ] 4.4 Fallback to template descriptions if `claude` CLI unavailable

## Phase 5: Scoring Engine
- [ ] 5.1 Implement Workflow Ownership scoring (Low/Med/High based on pattern + tool metadata)
- [ ] 5.2 Implement Pain Eliminated scoring (Low/Med/High based on frequency + user workflow)
- [ ] 5.3 Implement Agent Readiness scoring (Low/Med/High based on stars, maturity, permissions)
- [ ] 5.4 Combine scores into final recommendation ranking

## Phase 6: Terminal UI
- [ ] 6.1 Build Report component (header, scan summary, recommendation list)
- [ ] 6.2 Build RecommendationCard component (tool name, scores, description, install command)
- [ ] 6.3 Build score display (Low/Med/High with color coding)
- [ ] 6.4 Build analysis spinner/progress indicator
- [ ] 6.5 Polish layout, colors, spacing

## Phase 7: MCP Registry Integration
- [ ] 7.1 Build MCP Registry API client (GET /v0/servers?search=)
- [ ] 7.2 Supplement curated recommendations with live registry results
- [ ] 7.3 Pull star counts / metadata for Agent Readiness scoring

## Phase 8: Package & Ship
- [ ] 8.1 Test `npx agentscout` end-to-end
- [ ] 8.2 Add README with usage instructions
- [ ] 8.3 Publish to npm
- [ ] 8.4 Update landing page link

---
Progress: 0/27 tasks complete
