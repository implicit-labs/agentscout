import { readFile, readdir, stat, realpath, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────

export interface McpServerInfo {
  name: string;
  type: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  scope: "global" | "project";
  project?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  source: "global" | "project" | "external";
  path: string;
}

export interface CommandInfo {
  name: string;
  description: string;
  scope: "global" | "project";
}

export interface HookInfo {
  event: string;
  matcher: string;
  command: string;
  timeout?: number;
}

export interface ToolingInventory {
  mcpServers: McpServerInfo[];
  skills: SkillInfo[];
  commands: CommandInfo[];
  hooks: HookInfo[];
  plugins: string[];
  clis: Record<string, boolean>;
  claudeMd: {
    global: string | null;
    project: string | null;
  };
}

// ── Helpers ────────────────────────────────────────────────────────

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function readTextSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (m) result[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

function whichSync(cmd: string): boolean {
  try {
    execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

// ── Scanners ───────────────────────────────────────────────────────

async function scanMcpServers(): Promise<McpServerInfo[]> {
  const servers: McpServerInfo[] = [];

  // Global ~/.claude/mcp.json
  const globalMcp = await readJsonSafe<{ mcpServers?: Record<string, any> }>(
    join(homedir(), ".claude", "mcp.json")
  );
  if (globalMcp?.mcpServers) {
    for (const [name, config] of Object.entries(globalMcp.mcpServers)) {
      servers.push({
        name,
        type: config.type || (config.command ? "stdio" : config.url ? "http" : "unknown"),
        command: config.command,
        args: config.args,
        url: config.url,
        env: config.env,
        scope: "global",
      });
    }
  }

  // Also check ~/.mcp.json (older location)
  const oldMcp = await readJsonSafe<{ mcpServers?: Record<string, any> }>(
    join(homedir(), ".mcp.json")
  );
  if (oldMcp?.mcpServers) {
    const existingNames = new Set(servers.map((s) => s.name));
    for (const [name, config] of Object.entries(oldMcp.mcpServers)) {
      if (existingNames.has(name)) continue;
      servers.push({
        name,
        type: config.type || (config.command ? "stdio" : config.url ? "http" : "unknown"),
        command: config.command,
        args: config.args,
        url: config.url,
        env: config.env,
        scope: "global",
      });
    }
  }

  // Project-level: check cwd/.mcp.json
  const projectMcp = await readJsonSafe<{ mcpServers?: Record<string, any> }>(
    join(process.cwd(), ".mcp.json")
  );
  if (projectMcp?.mcpServers) {
    for (const [name, config] of Object.entries(projectMcp.mcpServers)) {
      servers.push({
        name,
        type: config.type || (config.command ? "stdio" : config.url ? "http" : "unknown"),
        command: config.command,
        args: config.args,
        url: config.url,
        env: config.env,
        scope: "project",
        project: basename(process.cwd()),
      });
    }
  }

  return servers;
}

async function scanSkills(): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  // Global skills: ~/.claude/skills/
  const globalSkillsDir = join(homedir(), ".claude", "skills");
  if (await dirExists(globalSkillsDir)) {
    try {
      const entries = await readdir(globalSkillsDir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const skillDir = join(globalSkillsDir, entry);
        const s = await stat(skillDir);
        if (!s.isDirectory()) continue;

        // Check if it's a symlink (external skill)
        let source: "global" | "external" = "global";
        try {
          const real = await realpath(skillDir);
          if (real !== skillDir) source = "external";
        } catch { /* not a symlink */ }

        // Read SKILL.md
        const skillMd = await readTextSafe(join(skillDir, "SKILL.md"));
        if (skillMd) {
          const fm = parseFrontmatter(skillMd);
          skills.push({
            name: fm.name || entry,
            description: fm.description || "",
            source,
            path: skillDir,
          });
        } else {
          skills.push({
            name: entry,
            description: "(no SKILL.md)",
            source,
            path: skillDir,
          });
        }
      }
    } catch { /* dir not readable */ }
  }

  // Project skills: .claude/skills/ in cwd
  const projectSkillsDir = join(process.cwd(), ".claude", "skills");
  if (await dirExists(projectSkillsDir)) {
    try {
      const entries = await readdir(projectSkillsDir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const skillDir = join(projectSkillsDir, entry);
        const s = await stat(skillDir);
        if (!s.isDirectory()) continue;

        const skillMd = await readTextSafe(join(skillDir, "SKILL.md"));
        const fm = skillMd ? parseFrontmatter(skillMd) : {};
        skills.push({
          name: fm.name || entry,
          description: fm.description || "",
          source: "project",
          path: skillDir,
        });
      }
    } catch { /* dir not readable */ }
  }

  return skills;
}

async function scanCommands(): Promise<CommandInfo[]> {
  const commands: CommandInfo[] = [];

  async function readCommandsDir(dir: string, scope: "global" | "project") {
    if (!(await dirExists(dir))) return;
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const name = entry.replace(/\.md$/, "");
        const content = await readTextSafe(join(dir, entry));
        const fm = content ? parseFrontmatter(content) : {};
        commands.push({
          name,
          description: fm.description || "",
          scope,
        });
      }
    } catch { /* dir not readable */ }
  }

  await readCommandsDir(join(homedir(), ".claude", "commands"), "global");
  await readCommandsDir(join(process.cwd(), ".claude", "commands"), "project");

  return commands;
}

async function scanHooks(): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];

  const settings = await readJsonSafe<{ hooks?: Record<string, any[]> }>(
    join(homedir(), ".claude", "settings.json")
  );
  if (!settings?.hooks) return hooks;

  for (const [event, handlers] of Object.entries(settings.hooks)) {
    if (!Array.isArray(handlers)) continue;
    for (const handler of handlers) {
      const matcher = handler.matcher || "*";
      const hookList = handler.hooks || [];
      for (const hook of hookList) {
        if (hook.type === "command" && hook.command) {
          hooks.push({
            event,
            matcher,
            command: hook.command,
            timeout: hook.timeout,
          });
        }
      }
    }
  }

  return hooks;
}

async function scanPlugins(): Promise<string[]> {
  const settings = await readJsonSafe<{ enabledPlugins?: Record<string, boolean> }>(
    join(homedir(), ".claude", "settings.json")
  );
  if (!settings?.enabledPlugins) return [];

  return Object.entries(settings.enabledPlugins)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

async function scanClis(): Promise<Record<string, boolean>> {
  const cliNames = [
    "gh", "vercel", "supabase", "firebase", "netlify",
    "fly", "railway", "heroku", "aws", "gcloud", "az",
    "docker", "kubectl", "terraform",
    "xcrun", "xcodebuild", "swift", "swiftc",
    "npx", "pnpm", "yarn", "bun",
    "pytest", "jest", "vitest",
    "eslint", "prettier", "biome",
    "curl", "jq", "fzf",
    "maestro", "fastlane",
  ];

  const result: Record<string, boolean> = {};
  for (const cli of cliNames) {
    result[cli] = whichSync(cli);
  }
  return result;
}

async function scanClaudeMd(): Promise<{ global: string | null; project: string | null }> {
  const global = await readTextSafe(join(homedir(), ".claude", "CLAUDE.md"));
  // Check project root CLAUDE.md and .claude/CLAUDE.md
  const projectRoot = await readTextSafe(join(process.cwd(), "CLAUDE.md"));
  const projectDotClaude = await readTextSafe(join(process.cwd(), ".claude", "CLAUDE.md"));
  const project = projectRoot || projectDotClaude;

  return { global, project };
}

// ── Main ───────────────────────────────────────────────────────────

export async function buildToolingInventory(): Promise<ToolingInventory> {
  const [mcpServers, skills, commands, hooks, plugins, clis, claudeMd] = await Promise.all([
    scanMcpServers(),
    scanSkills(),
    scanCommands(),
    scanHooks(),
    scanPlugins(),
    scanClis(),
    scanClaudeMd(),
  ]);

  return { mcpServers, skills, commands, hooks, plugins, clis, claudeMd };
}
