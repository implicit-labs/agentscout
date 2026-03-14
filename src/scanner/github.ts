/**
 * GitHub Metadata Enrichment
 *
 * Fetches live repo metadata via `gh api` to enrich Agent Readiness scoring.
 * Falls back gracefully if gh CLI is not available or not authenticated.
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface RepoMetadata {
  owner: string;
  repo: string;
  stars: number;
  openIssues: number;
  lastCommitDate: string | null; // ISO date
  lastReleaseDate: string | null; // ISO date
  description: string | null;
  archived: boolean;
  maintainer: {
    login: string;
    name: string | null;
    twitter: string | null;
    email: string | null;
    url: string | null;
  } | null;
}

function getCachePath(): string {
  return join("/tmp", "agentscout-github-cache.json");
}

function readCache(): Record<string, { data: RepoMetadata; ts: number }> {
  try {
    const cachePath = getCachePath();
    if (!existsSync(cachePath)) return {};
    const raw = readFileSync(cachePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, { data: RepoMetadata; ts: number }>): void {
  try {
    writeFileSync(getCachePath(), JSON.stringify(cache), "utf-8");
  } catch {
    // ignore cache write failures
  }
}

function isGhAvailable(): boolean {
  try {
    execSync("gh auth status", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract owner/repo from a GitHub URL.
 * Handles:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/src/subdir
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

async function fetchRepoMetadata(owner: string, repo: string): Promise<RepoMetadata | null> {
  try {
    // Validate owner/repo to prevent injection (only allow alphanumeric, hyphens, underscores, dots)
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;

    // Fetch repo info + owner profile in one call using GraphQL
    const query = `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        stargazerCount
        isArchived
        description
        openIssues: issues(states: OPEN) { totalCount }
        defaultBranchRef {
          target {
            ... on Commit {
              committedDate
            }
          }
        }
        latestRelease {
          publishedAt
        }
        owner {
          login
          ... on User {
            name
            twitterUsername
            email
            websiteUrl
          }
          ... on Organization {
            name
            twitterUsername
            email
            websiteUrl
          }
        }
      }
    }`;

    const result = execSync(
      `gh api graphql -f query='${query.replace(/'/g, "'\\''")}' -f owner='${owner.replace(/'/g, "'\\''")}' -f repo='${repo.replace(/'/g, "'\\''")}'`,
      { stdio: "pipe", timeout: 10000, encoding: "utf-8" }
    );

    const data = JSON.parse(result);
    const r = data.data?.repository;
    if (!r) return null;

    return {
      owner,
      repo,
      stars: r.stargazerCount || 0,
      openIssues: r.openIssues?.totalCount || 0,
      lastCommitDate: r.defaultBranchRef?.target?.committedDate || null,
      lastReleaseDate: r.latestRelease?.publishedAt || null,
      description: r.description || null,
      archived: r.isArchived || false,
      maintainer: r.owner ? {
        login: r.owner.login,
        name: r.owner.name || null,
        twitter: r.owner.twitterUsername ? `@${r.owner.twitterUsername}` : null,
        email: r.owner.email || null,
        url: r.owner.websiteUrl || null,
      } : null,
    };
  } catch {
    return null;
  }
}

/**
 * Enrich a list of tools with live GitHub metadata.
 * Uses a /tmp cache (1 hour TTL) to avoid repeated API calls.
 */
export async function enrichWithGitHub(
  tools: { id: string; url: string }[]
): Promise<Map<string, RepoMetadata>> {
  const results = new Map<string, RepoMetadata>();

  if (!isGhAvailable()) {
    console.error("[agentscout] gh CLI not available, skipping GitHub enrichment");
    return results;
  }

  const cache = readCache();
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let fetched = 0;

  for (const tool of tools) {
    const parsed = parseGitHubUrl(tool.url);
    if (!parsed) continue;

    const cacheKey = `${parsed.owner}/${parsed.repo}`;

    // Use cache if fresh
    const cached = cache[cacheKey];
    if (cached && now - cached.ts < ONE_HOUR) {
      results.set(tool.id, cached.data);
      continue;
    }

    // Fetch live
    const metadata = await fetchRepoMetadata(parsed.owner, parsed.repo);
    if (metadata) {
      results.set(tool.id, metadata);
      cache[cacheKey] = { data: metadata, ts: now };
      fetched++;
    }
  }

  if (fetched > 0) {
    writeCache(cache);
    console.error(`[agentscout] Fetched GitHub metadata for ${fetched} repos`);
  }

  return results;
}
