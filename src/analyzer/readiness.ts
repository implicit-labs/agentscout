/**
 * Computed Agent Readiness
 *
 * Instead of a static "high/med/low" label, computes readiness
 * from multiple signals: stars, maintenance health, permissions risk,
 * and author credibility.
 */

import type { RepoMetadata } from "../scanner/github.js";

export type ReadinessLevel = "low" | "med" | "high";

export interface ReadinessBreakdown {
  score: ReadinessLevel;
  points: number;
  signals: ReadinessSignal[];
}

export interface ReadinessSignal {
  label: string;
  value: string;
  sentiment: "positive" | "neutral" | "negative";
}

export function computeReadiness(
  meta: { stars: number; riskLevel: string },
  github: RepoMetadata | undefined
): ReadinessBreakdown {
  let points = 0;
  const signals: ReadinessSignal[] = [];

  // ── Stars ──
  const stars = github?.stars ?? meta.stars;
  if (stars >= 5000) {
    points += 2;
    signals.push({ label: "Stars", value: `${formatNum(stars)}`, sentiment: "positive" });
  } else if (stars >= 1000) {
    points += 1;
    signals.push({ label: "Stars", value: `${formatNum(stars)}`, sentiment: "positive" });
  } else if (stars >= 100) {
    signals.push({ label: "Stars", value: `${formatNum(stars)}`, sentiment: "neutral" });
  } else {
    points -= 1;
    signals.push({ label: "Stars", value: `${formatNum(stars)}`, sentiment: "negative" });
  }

  // ── Maintenance (last commit) ──
  if (github?.lastCommitDate) {
    const daysSince = daysBetween(github.lastCommitDate);
    if (daysSince <= 30) {
      points += 2;
      signals.push({ label: "Last commit", value: `${daysSince}d ago`, sentiment: "positive" });
    } else if (daysSince <= 90) {
      points += 1;
      signals.push({ label: "Last commit", value: `${daysSince}d ago`, sentiment: "positive" });
    } else if (daysSince <= 180) {
      signals.push({ label: "Last commit", value: `${daysSince}d ago`, sentiment: "neutral" });
    } else {
      points -= 1;
      signals.push({ label: "Last commit", value: `${daysSince}d ago`, sentiment: "negative" });
    }
  }

  // ── Open issues ──
  if (github?.openIssues !== undefined) {
    if (github.openIssues <= 20) {
      points += 1;
      signals.push({ label: "Open issues", value: `${github.openIssues}`, sentiment: "positive" });
    } else if (github.openIssues <= 50) {
      signals.push({ label: "Open issues", value: `${github.openIssues}`, sentiment: "neutral" });
    } else {
      points -= 1;
      signals.push({ label: "Open issues", value: `${github.openIssues}`, sentiment: "negative" });
    }
  }

  // ── Recent release ──
  if (github?.lastReleaseDate) {
    const daysSince = daysBetween(github.lastReleaseDate);
    if (daysSince <= 60) {
      points += 1;
      signals.push({ label: "Last release", value: `${daysSince}d ago`, sentiment: "positive" });
    } else if (daysSince <= 180) {
      signals.push({ label: "Last release", value: `${daysSince}d ago`, sentiment: "neutral" });
    } else {
      signals.push({ label: "Last release", value: `${daysSince}d ago`, sentiment: "negative" });
    }
  }

  // ── Archived ──
  if (github?.archived) {
    points -= 3;
    signals.push({ label: "Status", value: "ARCHIVED", sentiment: "negative" });
  }

  // ── Permissions risk ──
  if (meta.riskLevel === "low") {
    points += 1;
    signals.push({ label: "Risk", value: "low", sentiment: "positive" });
  } else if (meta.riskLevel === "high") {
    points -= 1;
    signals.push({ label: "Risk", value: "high", sentiment: "negative" });
  } else {
    signals.push({ label: "Risk", value: meta.riskLevel, sentiment: "neutral" });
  }

  // ── Maintainer credibility ──
  if (github?.maintainer?.twitter) {
    points += 1;
    signals.push({ label: "Maintainer", value: github.maintainer.twitter, sentiment: "positive" });
  } else if (github?.maintainer?.login) {
    signals.push({ label: "Maintainer", value: `@${github.maintainer.login}`, sentiment: "neutral" });
  }

  // ── Compute final score ──
  const score: ReadinessLevel = points >= 5 ? "high" : points >= 2 ? "med" : "low";

  return { score, points, signals };
}

function daysBetween(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
