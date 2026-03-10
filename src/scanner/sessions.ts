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

export async function scanSessions(
  maxSessionsPerProject: number = 10
): Promise<ScanResult> {
  const startTime = Date.now();

  const projectDirs = await discoverProjects();
  const projects: ProjectScan[] = [];
  let totalToolCalls = 0;
  let totalBashCommands = 0;
  let totalSessions = 0;

  for (const projectDir of projectDirs) {
    // Try sessions-index.json first, fall back to direct JSONL discovery
    const indexSessions = await readSessionIndex(projectDir);
    const projectName = projectDir.replace(/-/g, "/").replace(/^\//, "");

    const allToolCalls: ToolCall[] = [];
    const allRawToolUses: RawToolUse[] = [];
    const allUserMessages: string[] = [];
    const allParsedUserMessages: UserMessage[] = [];
    const allBashCommands: string[] = [];
    const allHandoffs: string[] = [];
    let projectErrors = 0;
    let projectTokens = 0;
    let sessionCount = 0;

    if (indexSessions.length > 0) {
      const sessionsToScan = indexSessions
        .sort(
          (a, b) =>
            new Date(b.modified).getTime() -
            new Date(a.modified).getTime()
        )
        .slice(0, maxSessionsPerProject);

      sessionCount = indexSessions.length;

      for (const session of sessionsToScan) {
        const sessionPath = join(
          getProjectsDir(),
          projectDir,
          `${session.sessionId}.jsonl`
        );

        const result = await parseJSONLFile(
          sessionPath,
          session.sessionId,
          projectName
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

      sessionCount = jsonlFiles.length;

      for (const file of sorted) {
        const result = await parseJSONLFile(
          file.filePath,
          file.sessionId,
          projectName
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

    if (allToolCalls.length === 0 && allBashCommands.length === 0 && allHandoffs.length === 0) continue;

    projects.push({
      projectPath: projectName,
      projectName: projectName.split("/").pop() || projectName,
      sessionCount,
      sessions: indexSessions,
      toolCalls: allToolCalls,
      rawToolUses: allRawToolUses,
      userMessages: allUserMessages,
      parsedUserMessages: allParsedUserMessages,
      bashCommands: allBashCommands,
      assistantHandoffs: allHandoffs,
      errorCount: projectErrors,
      totalTokens: projectTokens,
    });

    totalToolCalls += allToolCalls.length;
    totalBashCommands += allBashCommands.length;
    totalSessions += sessionCount;
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
