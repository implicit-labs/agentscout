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
  errorCount: number;
  totalTokens: number;
}> {
  const toolCalls: ToolCall[] = [];
  const userMessages: string[] = [];
  const bashCommands: string[] = [];
  let errorCount = 0;
  let totalTokens = 0;

  try {
    const fileInfo = await stat(filePath);
    // Skip files larger than 100MB
    if (fileInfo.size > 100 * 1024 * 1024) {
      return { toolCalls, userMessages, bashCommands, errorCount, totalTokens };
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

  return { toolCalls, userMessages, bashCommands, errorCount, totalTokens };
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
    let projectErrors = 0;
    let projectTokens = 0;
    let sessionCount = 0;

    if (indexSessions.length > 0) {
      // Use index — scan most recent sessions
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
        projectErrors += result.errorCount;
        projectTokens += result.totalTokens;
      }
    } else {
      // No index — discover JSONL files directly
      const jsonlFiles = await discoverJSONLFiles(projectDir);
      if (jsonlFiles.length === 0) continue;

      // Sort by file modification time (newest first), scan up to limit
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
        projectErrors += result.errorCount;
        projectTokens += result.totalTokens;
      }
    }

    if (allToolCalls.length === 0 && allBashCommands.length === 0) continue;

    projects.push({
      projectPath: projectName,
      projectName: projectName.split("/").pop() || projectName,
      sessionCount,
      sessions: indexSessions,
      toolCalls: allToolCalls,
      userMessages: allUserMessages,
      bashCommands: allBashCommands,
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
