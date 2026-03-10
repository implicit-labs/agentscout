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

export interface ProjectScan {
  projectPath: string;
  projectName: string;
  sessionCount: number;
  sessions: SessionEntry[];
  toolCalls: ToolCall[];
  userMessages: string[];
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
  userMessages: string[];
  bashCommands: string[];
  assistantHandoffs: string[];
  errorCount: number;
  totalTokens: number;
}> {
  const toolCalls: ToolCall[] = [];
  const userMessages: string[] = [];
  const bashCommands: string[] = [];
  const assistantHandoffs: string[] = [];
  let errorCount = 0;
  let totalTokens = 0;

  try {
    const fileInfo = await stat(filePath);
    // Skip files larger than 100MB
    if (fileInfo.size > 100 * 1024 * 1024) {
      return { toolCalls, userMessages, bashCommands, assistantHandoffs, errorCount, totalTokens };
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
          const content =
            typeof entry.message.content === "string"
              ? entry.message.content
              : JSON.stringify(entry.message.content);
          userMessages.push(content);
        }

        if (entry.type === "assistant" && entry.message?.content) {
          const contents = Array.isArray(entry.message.content)
            ? entry.message.content
            : [entry.message.content];

          for (const block of contents) {
            if (block.type === "tool_use") {
              const toolCall: ToolCall = {
                name: block.name,
                input: block.input || {},
                timestamp: entry.timestamp || "",
                sessionId,
                projectPath,
              };
              toolCalls.push(toolCall);

              // Extract Bash commands specifically
              if (
                block.name === "Bash" &&
                typeof block.input?.command === "string"
              ) {
                bashCommands.push(block.input.command);
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
                  // Extract the relevant sentence (up to 200 chars around the match)
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

  return { toolCalls, userMessages, bashCommands, assistantHandoffs, errorCount, totalTokens };
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
    const allUserMessages: string[] = [];
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
        allUserMessages.push(...result.userMessages);
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
        allUserMessages.push(...result.userMessages);
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
      userMessages: allUserMessages,
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
