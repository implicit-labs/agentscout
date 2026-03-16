/**
 * Remote Catalog Fetcher
 *
 * Fetches the tool catalog from GitHub at runtime so the maintainer can
 * update it without requiring users to npm update. Falls back to the
 * bundled catalog if the fetch fails or the user is offline.
 *
 * Cache: ~/.agentscout/catalog-cache.json (24-hour TTL)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import bundledCatalog from "./tools.json" with { type: "json" };

const CATALOG_URL =
  "https://raw.githubusercontent.com/implicit-labs/agentscout/main/src/catalog/tools.json";
const CACHE_DIR = join(homedir(), ".agentscout");
const CACHE_FILE = join(CACHE_DIR, "catalog-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  fetchedAt: number;
  catalog: unknown[];
}

function readCache(): CacheEntry | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry.fetchedAt || !Array.isArray(entry.catalog)) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(catalog: unknown[]): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const entry: CacheEntry = { fetchedAt: Date.now(), catalog };
    writeFileSync(CACHE_FILE, JSON.stringify(entry), "utf-8");
  } catch {
    // Cache write failure is non-fatal
  }
}

async function fetchRemoteCatalog(): Promise<unknown[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(CATALOG_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Load the tool catalog with remote-fetch + cache + bundled fallback.
 *
 * Priority:
 * 1. Cached catalog (if < 24h old)
 * 2. Fresh fetch from GitHub (cached on success)
 * 3. Bundled catalog (always available)
 */
export async function loadCatalog(): Promise<typeof bundledCatalog> {
  // Check cache first
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.catalog as typeof bundledCatalog;
  }

  // Try remote fetch
  const remote = await fetchRemoteCatalog();
  if (remote) {
    writeCache(remote);
    return remote as typeof bundledCatalog;
  }

  // Fall back to bundled
  return bundledCatalog;
}

/**
 * Synchronous access to the bundled catalog (for contexts where async isn't possible).
 */
export function loadCatalogSync(): typeof bundledCatalog {
  // Try cache first
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.catalog as typeof bundledCatalog;
  }
  return bundledCatalog;
}
