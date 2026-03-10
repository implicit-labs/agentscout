import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface InstalledTool {
  name: string;
  source: "global-mcp" | "project-mcp" | "permission" | "plugin";
  project?: string;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
  };
  enabledPlugins?: Record<string, boolean>;
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function extractMcpNames(config: McpConfig): string[] {
  if (!config.mcpServers) return [];
  return Object.keys(config.mcpServers);
}

function extractPermissionMcpNames(settings: ClaudeSettings): string[] {
  const names = new Set<string>();
  const allows = settings.permissions?.allow || [];

  for (const perm of allows) {
    // Match patterns like "mcp__linear__*" or "mcp__ios-simulator__*"
    const match = perm.match(/^mcp__([^_]+(?:-[^_]+)*)__/);
    if (match) {
      names.add(match[1]);
    }
  }

  return Array.from(names);
}

function extractPluginNames(settings: ClaudeSettings): string[] {
  if (!settings.enabledPlugins) return [];
  return Object.entries(settings.enabledPlugins)
    .filter(([, enabled]) => enabled)
    .map(([name]) => {
      // Extract the tool name from "name@marketplace" format
      const parts = name.split("@");
      return parts[0];
    });
}

export async function discoverInstalledTools(): Promise<InstalledTool[]> {
  const tools: InstalledTool[] = [];
  const seen = new Set<string>();

  const addTool = (
    name: string,
    source: InstalledTool["source"],
    project?: string
  ) => {
    const key = `${name}:${source}:${project || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    tools.push({ name, source, project });
  };

  // 1. Global ~/.mcp.json
  const globalMcp = await readJsonFile<McpConfig>(
    join(homedir(), ".mcp.json")
  );
  if (globalMcp) {
    for (const name of extractMcpNames(globalMcp)) {
      addTool(name, "global-mcp");
    }
  }

  // 2. ~/.claude/settings.json — permissions and plugins
  const settings = await readJsonFile<ClaudeSettings>(
    join(homedir(), ".claude", "settings.json")
  );
  if (settings) {
    for (const name of extractPermissionMcpNames(settings)) {
      addTool(name, "permission");
    }
    for (const name of extractPluginNames(settings)) {
      addTool(name, "plugin");
    }
  }

  // 3. Project-level .mcp.json files
  // Check common locations based on known project paths
  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  try {
    const projectDirs = await readdir(claudeProjectsDir);
    for (const dir of projectDirs) {
      if (dir.startsWith(".")) continue;

      // Reconstruct the actual project path from the encoded directory name
      const projectPath = "/" + dir.replace(/-/g, "/");

      const projectMcp = await readJsonFile<McpConfig>(
        join(projectPath, ".mcp.json")
      );
      if (projectMcp) {
        const projectName = projectPath.split("/").pop() || projectPath;
        for (const name of extractMcpNames(projectMcp)) {
          addTool(name, "project-mcp", projectName);
        }
      }
    }
  } catch {
    // Projects dir not accessible
  }

  return tools;
}

/**
 * Check if a catalog tool name matches any installed tool.
 * Uses fuzzy matching since naming conventions differ.
 */
export function isToolInstalled(
  toolId: string,
  toolName: string,
  installed: InstalledTool[]
): InstalledTool | undefined {
  const toolIdLower = toolId.toLowerCase();
  const toolNameLower = toolName.toLowerCase();

  for (const t of installed) {
    const installedLower = t.name.toLowerCase();

    // Exact match on id segments
    if (toolIdLower.includes(installedLower)) return t;
    if (installedLower.includes(toolIdLower.replace(/-mcp$/, ""))) return t;

    // Name-based matching
    if (toolNameLower.includes(installedLower)) return t;

    // Common aliases
    const aliases: Record<string, string[]> = {
      linear: ["linear"],
      todoist: ["todoist"],
      supabase: ["supabase"],
      "ios-simulator": ["ios-simulator", "ios_simulator"],
      xcodebuild: ["xcodebuild", "xcode"],
      playwright: ["playwright"],
      github: ["github", "gh"],
      postgres: ["postgres", "postgresql"],
      sqlite: ["sqlite"],
      docker: ["docker"],
      slack: ["slack"],
      sentry: ["sentry"],
      stripe: ["stripe"],
      cloudflare: ["cloudflare"],
      voice: ["voice"],
    };

    for (const [key, vals] of Object.entries(aliases)) {
      if (
        toolIdLower.includes(key) &&
        vals.some((v) => installedLower.includes(v))
      ) {
        return t;
      }
    }
  }

  return undefined;
}
