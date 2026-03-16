#!/usr/bin/env node

import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = join(__dirname, "..", ".claude", "commands");
const dest = join(homedir(), ".claude", "commands");

try {
  mkdirSync(dest, { recursive: true });

  for (const file of ["diagnose.md", "recommend.md"]) {
    const src = join(source, file);
    const dst = join(dest, file);
    if (existsSync(src)) {
      cpSync(src, dst);
    }
  }

  console.log("[agentscout] Installed /diagnose and /recommend commands to ~/.claude/commands/");
} catch {
  // Non-fatal — user can copy manually
}
