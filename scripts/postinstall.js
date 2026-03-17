#!/usr/bin/env node

import { cpSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = join(__dirname, "..", ".claude", "commands");
const dest = join(homedir(), ".claude", "commands");

try {
  mkdirSync(dest, { recursive: true });

  for (const file of ["agentscout.md"]) {
    const src = join(source, file);
    const dst = join(dest, file);
    if (existsSync(src)) {
      cpSync(src, dst);
    }
  }

  // Clean up old commands from previous versions
  for (const old of ["diagnose.md", "recommend.md"]) {
    const oldDst = join(dest, old);
    if (existsSync(oldDst)) {
      try { unlinkSync(oldDst); } catch {}
    }
  }

  console.log("[agentscout] Installed /agentscout command to ~/.claude/commands/");
} catch {
  // Non-fatal — user can copy manually
}
