import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface SessionIndex {
  version: number;
  entries: SessionEntry[];
  originalPath: string;
}

export interface SessionEntry {
  sessionId: string;
  fullPath: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
  sessionId: string;
  projectPath: string;
}

export interface SessionMessage {
  type: "user" | "assistant" | "progress";
  content: string;
  toolCalls: ToolCall[];
  timestamp: string;
  sessionId: string;
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export interface RawToolUse {
  name: string;
  inputKey: string;
  filePath?: string;
  command?: string;
  isError: boolean;
  errorMessage?: string;
  timestamp: string;
}

export interface UserMessage {
  text: string;
  isInterrupted: boolean;
}

export interface ProjectScan {
  projectPath: string;
  projectName: string;
  sessionCount: number;
  sessions: SessionEntry[];
  toolCalls: ToolCall[];
  rawToolUses: RawToolUse[];
  userMessages: string[];
  parsedUserMessages: UserMessage[];
  bashCommands: string[];
  assistantHandoffs: string[];
  errorCount: number;
  totalTokens: number;
}

export interface ScanResult {
  projects: ProjectScan[];
  totalProjects: number;
  totalSessions: number;
  totalToolCalls: number;
  totalBashCommands: number;
  scanDuration: number;
}

function getClaudeDir(): string {
  return join(homedir(), ".claude");
}

function getProjectsDir(): string {
  return join(getClaudeDir(), "projects");
}

export async function discoverProjects(): Promise<string[]> {
  const projectsDir = getProjectsDir();
  try {
    const entries = await readdir(projectsDir);
    return entries.filter((e) => !e.startsWith("."));
  } catch {
    return [];
  }
}

export async function readSessionIndex(
  projectDir: string
): Promise<SessionEntry[]> {
  const indexPath = join(
    getProjectsDir(),
    projectDir,
    "sessions-index.json"
  );
  try {
    const data = await readFile(indexPath, "utf-8");
    const index: SessionIndex = JSON.parse(data);
    return index.entries || [];
  } catch {
    return [];
  }
}

async function parseJSONLFile(
  filePath: string,
  sessionId: string,
  projectPath: string
): Promise<{
  toolCalls: ToolCall[];
  rawToolUses: RawToolUse[];
  userMessages: string[];
  parsedUserMessages: UserMessage[];
  bashCommands: string[];
  assistantHandoffs: string[];
  errorCount: number;
  totalTokens: number;
}> {
  const toolCalls: ToolCall[] = [];
  const rawToolUses: RawToolUse[] = [];
  const userMessages: string[] = [];
  const parsedUserMessages: UserMessage[] = [];
  const bashCommands: string[] = [];
  const assistantHandoffs: string[] = [];
  let errorCount = 0;
  let totalTokens = 0;

  // Track pending tool_use IDs so we can match them with tool_result errors
  const pendingToolUses = new Map<string, RawToolUse>();

  try {
    const fileInfo = await stat(filePath);
    // Skip files larger than 100MB
    if (fileInfo.size > 100 * 1024 * 1024) {
      return { toolCalls, rawToolUses, userMessages, parsedUserMessages, bashCommands, assistantHandoffs, errorCount, totalTokens };
    }

    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    // Cap at 5000 lines per file to keep scan under ~30s total
    let lineCount = 0;
    const maxLines = 5000;

    for await (const line of rl) {
      if (!line.trim()) continue;
      if (++lineCount > maxLines) break;
      try {
        const entry = JSON.parse(line);

        if (entry.type === "user" && entry.message?.content) {
          const content = entry.message.content;

          if (typeof content === "string") {
            const isInterrupted = content === "[Request interrupted by user]";
            userMessages.push(content);
            parsedUserMessages.push({ text: content, isInterrupted });
          } else if (Array.isArray(content)) {
            // Process text blocks and tool_result blocks
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                const isInterrupted = block.text === "[Request interrupted by user]";
                userMessages.push(block.text);
                parsedUserMessages.push({ text: block.text, isInterrupted });
              }

              // Tool results — check for errors
              if (block.type === "tool_result") {
                const toolUseId = block.tool_use_id;
                const isError = !!block.is_error;
                const pending = pendingToolUses.get(toolUseId);

                if (pending && isError) {
                  pending.isError = true;
                  // Extract error message from content
                  let errMsg = "";
                  if (typeof block.content === "string") {
                    errMsg = block.content;
                  } else if (Array.isArray(block.content)) {
                    errMsg = block.content
                      .map((b: { text?: string }) => b.text || "")
                      .join(" ");
                  }
                  pending.errorMessage = errMsg.substring(0, 200);
                }
              }
            }
          }
        }

        if (entry.type === "assistant" && entry.message?.content) {
          const contents = Array.isArray(entry.message.content)
            ? entry.message.content
            : [entry.message.content];

          for (const block of contents) {
            if (block.type === "tool_use") {
              const inp = block.input || {};
              const toolCall: ToolCall = {
                name: block.name,
                input: inp,
                timestamp: entry.timestamp || "",
                sessionId,
                projectPath,
              };
              toolCalls.push(toolCall);

              // Build inputKey for dedup/retry detection
              let inputKey = block.name;
              if (block.name === "Bash" && typeof inp.command === "string") {
                inputKey = `Bash:${inp.command.substring(0, 60)}`;
                bashCommands.push(inp.command);
              } else if (
                (block.name === "Edit" || block.name === "Write" || block.name === "Read") &&
                typeof inp.file_path === "string"
              ) {
                inputKey = `${block.name}:${inp.file_path}`;
              } else if (block.name === "Grep" && typeof inp.pattern === "string") {
                inputKey = `Grep:${inp.pattern}`;
              }

              const rawUse: RawToolUse = {
                name: block.name,
                inputKey,
                filePath: typeof inp.file_path === "string" ? inp.file_path : undefined,
                command: typeof inp.command === "string" ? inp.command : undefined,
                isError: false,
                timestamp: entry.timestamp || "",
              };
              rawToolUses.push(rawUse);

              // Track by tool_use_id so we can match with tool_result
              if (block.id) {
                pendingToolUses.set(block.id, rawUse);
              }
            }

            // Detect when Claude tells the user to do something manually
            if (block.type === "text" && typeof block.text === "string") {
              const text = block.text;
              const handoffPatterns = [
                /you(?:'ll| will| need to| should| can| must) (?:manually |now )?(?:go to|open|navigate to|visit|log into|sign into)/i,
                /(?:open|go to|navigate to|visit) (?:the )?(xcode|app store connect|testflight|dashboard|console|browser|website|portal|admin|settings)/i,
                /(?:manually |now )?(?:run|execute|type|enter|paste|copy) (?:this|the following|these) (?:command|step|instruction)/i,
                /(?:you(?:'ll| will) need to|unfortunately.*(?:can't|cannot|unable)|i (?:can't|cannot) (?:do this|handle this|access))/i,
                /(?:outside (?:of )?(?:this|the) (?:editor|terminal|session)|in your browser|on the website)/i,
              ];

              for (const pattern of handoffPatterns) {
                if (pattern.test(text)) {
                  const match = text.match(pattern);
                  if (match && match.index !== undefined) {
                    const start = Math.max(0, match.index - 50);
                    const end = Math.min(text.length, match.index + 200);
                    const snippet = text.substring(start, end).replace(/\n/g, " ").trim();
                    assistantHandoffs.push(snippet);
                  }
                  break;
                }
              }
            }
          }

          // Token usage
          if (entry.message?.usage) {
            const u = entry.message.usage;
            totalTokens +=
              (u.input_tokens || 0) + (u.output_tokens || 0);
          }
        }
      } catch {
        errorCount++;
      }
    }
  } catch {
    // File not readable, skip
  }

  return { toolCalls, rawToolUses, userMessages, parsedUserMessages, bashCommands, assistantHandoffs, errorCount, totalTokens };
}

async function discoverJSONLFiles(
  projectDir: string
): Promise<{ sessionId: string; filePath: string }[]> {
  const fullDir = join(getProjectsDir(), projectDir);
  try {
    const entries = await readdir(fullDir);
    return entries
      .filter((e) => e.endsWith(".jsonl"))
      .map((e) => ({
        sessionId: e.replace(".jsonl", ""),
        filePath: join(fullDir, e),
      }));
  } catch {
    return [];
  }
}

/**
 * Cluster worktree project directories under their main repo.
 *
 * Claude Code stores sessions by absolute path, so worktrees like
 *   /Users/tom/myapp/.worktrees/feat-auth
 * get their own directory:
 *   -Users-tom-myapp--worktrees-feat-auth
 *
 * This function groups those under the canonical repo path so they
 * appear as a single project in the scan output.
 *
 * Returns Map<canonicalDir, relatedDirs[]> where canonicalDir is the
 * main repo's encoded directory name.
 */
function clusterWorktreeProjects(
  projectDirs: string[]
): Map<string, string[]> {
  const clusters = new Map<string, string[]>();

  // Worktree pattern: the encoded path contains --worktrees- (which decodes to /.worktrees/)
  // or --claude-worktrees- (/.claude/worktrees/)
  const worktreePatterns = [/^(.+?)--worktrees-/, /^(.+?)--claude-worktrees-/];

  for (const dir of projectDirs) {
    let canonicalDir: string | null = null;

    for (const pattern of worktreePatterns) {
      const match = dir.match(pattern);
      if (match) {
        canonicalDir = match[1];
        break;
      }
    }

    if (canonicalDir) {
      const existing = clusters.get(canonicalDir) || [];
      existing.push(dir);
      clusters.set(canonicalDir, existing);
    } else {
      // Not a worktree — it's a standalone project (or the main repo itself)
      const existing = clusters.get(dir) || [];
      existing.push(dir);
      clusters.set(dir, existing);
    }
  }

  return clusters;
}

async function scanProjectDirs(
  dirs: string[],
  canonicalName: string,
  maxSessionsPerProject: number,
): Promise<{
  project: ProjectScan | null;
  toolCallCount: number;
  bashCommandCount: number;
  sessionCount: number;
}> {
  const allToolCalls: ToolCall[] = [];
  const allRawToolUses: RawToolUse[] = [];
  const allUserMessages: string[] = [];
  const allParsedUserMessages: UserMessage[] = [];
  const allBashCommands: string[] = [];
  const allHandoffs: string[] = [];
  let projectErrors = 0;
  let projectTokens = 0;
  let totalSessionCount = 0;
  const allIndexSessions: SessionEntry[] = [];

  for (const projectDir of dirs) {
    const indexSessions = await readSessionIndex(projectDir);

    if (indexSessions.length > 0) {
      allIndexSessions.push(...indexSessions);
      const sessionsToScan = indexSessions
        .sort(
          (a, b) =>
            new Date(b.modified).getTime() -
            new Date(a.modified).getTime()
        )
        .slice(0, maxSessionsPerProject);

      totalSessionCount += indexSessions.length;

      for (const session of sessionsToScan) {
        const sessionPath = join(
          getProjectsDir(),
          projectDir,
          `${session.sessionId}.jsonl`
        );

        const result = await parseJSONLFile(
          sessionPath,
          session.sessionId,
          canonicalName
        );
        allToolCalls.push(...result.toolCalls);
        allRawToolUses.push(...result.rawToolUses);
        allUserMessages.push(...result.userMessages);
        allParsedUserMessages.push(...result.parsedUserMessages);
        allBashCommands.push(...result.bashCommands);
        allHandoffs.push(...result.assistantHandoffs);
        projectErrors += result.errorCount;
        projectTokens += result.totalTokens;
      }
    } else {
      const jsonlFiles = await discoverJSONLFiles(projectDir);
      if (jsonlFiles.length === 0) continue;

      const fileStats = await Promise.all(
        jsonlFiles.map(async (f) => {
          try {
            const s = await stat(f.filePath);
            return { ...f, mtime: s.mtimeMs };
          } catch {
            return { ...f, mtime: 0 };
          }
        })
      );

      const sorted = fileStats
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, maxSessionsPerProject);

      totalSessionCount += jsonlFiles.length;

      for (const file of sorted) {
        const result = await parseJSONLFile(
          file.filePath,
          file.sessionId,
          canonicalName
        );
        allToolCalls.push(...result.toolCalls);
        allRawToolUses.push(...result.rawToolUses);
        allUserMessages.push(...result.userMessages);
        allParsedUserMessages.push(...result.parsedUserMessages);
        allBashCommands.push(...result.bashCommands);
        allHandoffs.push(...result.assistantHandoffs);
        projectErrors += result.errorCount;
        projectTokens += result.totalTokens;
      }
    }
  }

  if (allToolCalls.length === 0 && allBashCommands.length === 0 && allHandoffs.length === 0) {
    return { project: null, toolCallCount: 0, bashCommandCount: 0, sessionCount: totalSessionCount };
  }

  return {
    project: {
      projectPath: canonicalName,
      projectName: canonicalName.split("/").pop() || canonicalName,
      sessionCount: totalSessionCount,
      sessions: allIndexSessions,
      toolCalls: allToolCalls,
      rawToolUses: allRawToolUses,
      userMessages: allUserMessages,
      parsedUserMessages: allParsedUserMessages,
      bashCommands: allBashCommands,
      assistantHandoffs: allHandoffs,
      errorCount: projectErrors,
      totalTokens: projectTokens,
    },
    toolCallCount: allToolCalls.length,
    bashCommandCount: allBashCommands.length,
    sessionCount: totalSessionCount,
  };
}

export async function scanSessions(
  maxSessionsPerProject: number = 10,
  projectFilter?: string
): Promise<ScanResult> {
  const startTime = Date.now();

  let projectDirs = await discoverProjects();

  // Filter to a single project if --project flag is used
  if (projectFilter) {
    const normalizedFilter = projectFilter.replace(/\//g, "-").replace(/^-/, "");
    projectDirs = projectDirs.filter((dir) => {
      // Match by: exact dir name, decoded path contains filter, or project short name
      const decoded = dir.replace(/-/g, "/").replace(/^\//, "");
      const shortName = decoded.split("/").pop() || "";
      return (
        dir === normalizedFilter ||
        dir.includes(normalizedFilter) ||
        decoded.includes(projectFilter) ||
        shortName === projectFilter ||
        shortName.includes(projectFilter)
      );
    });
  }

  // Cluster worktree directories under their main repo
  const clusters = clusterWorktreeProjects(projectDirs);

  const projects: ProjectScan[] = [];
  let totalToolCalls = 0;
  let totalBashCommands = 0;
  let totalSessions = 0;

  for (const [canonicalDir, dirs] of clusters) {
    const canonicalName = canonicalDir.replace(/-/g, "/").replace(/^\//, "");

    const result = await scanProjectDirs(dirs, canonicalName, maxSessionsPerProject);

    if (result.project) {
      projects.push(result.project);
    }
    totalToolCalls += result.toolCallCount;
    totalBashCommands += result.bashCommandCount;
    totalSessions += result.sessionCount;
  }

  return {
    projects,
    totalProjects: projects.length,
    totalSessions,
    totalToolCalls,
    totalBashCommands,
    scanDuration: Date.now() - startTime,
  };
}

export interface WrappedStats {
  totalProjects: number;
  totalSessions: number;
  totalTokens: number;
  totalTokensFormatted: string;
  firstSessionDate: string | null;
  firstSessionRelative: string | null;
  mostActiveProject: { name: string; sessions: number } | null;
  uniqueToolsUsed: number;
  totalBashCommands: number;
  busiestVsAverage: string | null;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

function relativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (months < 1) return "this month";
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return years === 1 ? "1 year ago" : `${years} years ago`;
  return years === 1 ? `1 year, ${remainingMonths}mo ago` : `${years} years, ${remainingMonths}mo ago`;
}

function formatMonthYear(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function computeWrappedStats(scan: ScanResult): WrappedStats {
  // Total tokens across all projects
  const totalTokens = scan.projects.reduce((sum, p) => sum + p.totalTokens, 0);

  // Earliest session date across all projects
  let earliest: string | null = null;
  for (const project of scan.projects) {
    for (const session of project.sessions) {
      if (session.created && (!earliest || session.created < earliest)) {
        earliest = session.created;
      }
    }
  }

  // Most active project by session count
  let mostActive: { name: string; sessions: number } | null = null;
  for (const project of scan.projects) {
    if (!mostActive || project.sessionCount > mostActive.sessions) {
      mostActive = { name: project.projectName, sessions: project.sessionCount };
    }
  }

  // Unique tools used
  const toolNames = new Set<string>();
  for (const project of scan.projects) {
    for (const tc of project.toolCalls) {
      toolNames.add(tc.name);
    }
  }

  // Busiest vs average
  let busiestVsAverage: string | null = null;
  if (scan.projects.length > 1 && mostActive) {
    const avgSessions = scan.totalSessions / scan.projects.length;
    if (avgSessions > 0) {
      const ratio = Math.round(mostActive.sessions / avgSessions);
      if (ratio >= 2) {
        busiestVsAverage = `${ratio}x more sessions than your average project`;
      }
    }
  }

  return {
    totalProjects: scan.totalProjects,
    totalSessions: scan.totalSessions,
    totalTokens,
    totalTokensFormatted: formatTokens(totalTokens),
    firstSessionDate: earliest ? formatMonthYear(earliest) : null,
    firstSessionRelative: earliest ? relativeDate(earliest) : null,
    mostActiveProject: mostActive,
    uniqueToolsUsed: toolNames.size,
    totalBashCommands: scan.totalBashCommands,
    busiestVsAverage,
  };
}
