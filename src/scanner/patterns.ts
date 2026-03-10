import type { ScanResult, ProjectScan } from "./sessions.js";

export type PatternCategory =
  | "git"
  | "database"
  | "deployment"
  | "api-requests"
  | "file-management"
  | "testing"
  | "docker"
  | "cloud"
  | "browser"
  | "ios"
  | "package-management"
  | "monitoring"
  | "search"
  | "documentation"
  | "ci-cd"
  | "project-management";

export interface DetectedPattern {
  category: PatternCategory;
  label: string;
  description: string;
  evidence: string[];
  frequency: number;
  projects: string[];
}

interface PatternRule {
  category: PatternCategory;
  label: string;
  description: string;
  matchers: RegExp[];
}

const PATTERN_RULES: PatternRule[] = [
  {
    category: "git",
    label: "Manual Git Operations",
    description:
      "Running git commands through Bash instead of letting an agent handle version control",
    matchers: [
      /\bgit\s+(commit|push|pull|merge|rebase|cherry-pick|stash|branch|checkout|switch|tag|log|diff|status|add|reset|revert)\b/,
      /\bgit\s+(remote|fetch|clone)\b/,
    ],
  },
  {
    category: "database",
    label: "Manual Database Operations",
    description:
      "Running database queries or management commands manually through the terminal",
    matchers: [
      /\b(psql|mysql|sqlite3|mongo|redis-cli)\b/,
      /\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE|DROP)\b/i,
      /\bsupabase\b/,
      /\bprisma\s+(migrate|generate|studio|db)\b/,
      /\bdrizzle-kit\b/,
    ],
  },
  {
    category: "deployment",
    label: "Manual Deployment Steps",
    description:
      "Handling builds, deploys, and releases through manual terminal commands",
    matchers: [
      /\b(vercel|netlify|railway|fly\.io|heroku)\s+(deploy|promote)\b/,
      /\bnpm\s+publish\b/,
      /\bxcodebuild\b/,
      /\bfastlane\b/,
      /\bapp-store-connect\b/i,
      /\barchive\b.*\bxcode\b/i,
      /\btestflight\b/i,
    ],
  },
  {
    category: "api-requests",
    label: "Manual API Requests",
    description:
      "Making HTTP requests via curl/wget instead of through integrated tools",
    matchers: [
      /\bcurl\s+(-[sSkLXHd]|\s)*https?:\/\//,
      /\bwget\s+/,
      /\bhttpie\b/,
      /\bfetch\(/,
    ],
  },
  {
    category: "file-management",
    label: "Repetitive File Operations",
    description:
      "Manual file copying, moving, and renaming that could be automated",
    matchers: [
      /\b(cp|mv|rsync)\s+-[rRa]/,
      /\bfind\s+.*-exec\b/,
      /\btar\s+[cxz]/,
      /\bzip\b.*\bunzip\b/,
    ],
  },
  {
    category: "testing",
    label: "Manual Test Running",
    description:
      "Running tests manually and interpreting results without automation",
    matchers: [
      /\b(npm|yarn|pnpm)\s+(test|run\s+test)\b/,
      /\b(pytest|jest|vitest|mocha|swift\s+test)\b/,
      /\bxcodebuild\s+test\b/,
    ],
  },
  {
    category: "docker",
    label: "Manual Docker Management",
    description:
      "Building, running, and managing containers through manual commands",
    matchers: [
      /\bdocker\s+(build|run|compose|push|pull|exec|logs|stop|rm)\b/,
      /\bdocker-compose\b/,
      /\bkubectl\b/,
    ],
  },
  {
    category: "cloud",
    label: "Manual Cloud Operations",
    description:
      "Managing cloud infrastructure through CLI commands manually",
    matchers: [
      /\baws\s+(s3|ec2|lambda|iam|cloudformation)\b/,
      /\bgcloud\b/,
      /\baz\s+(vm|storage|webapp)\b/,
      /\bterraform\s+(plan|apply|destroy)\b/,
    ],
  },
  {
    category: "browser",
    label: "Browser-Based Workflows",
    description:
      "Referencing web dashboards and UIs that could be managed by agents",
    matchers: [
      /\b(dashboard|console|web\s*ui|admin\s*panel)\b/i,
      /\bopen\s+https?:\/\//,
      /\bgo\s+to\s+(the\s+)?(website|dashboard|console|portal)\b/i,
    ],
  },
  {
    category: "ios",
    label: "Manual iOS Development Steps",
    description:
      "Handling Xcode builds, simulators, and App Store tasks manually",
    matchers: [
      /\bxcrun\b/,
      /\bsimctl\b/,
      /\bxcode-select\b/,
      /\bcodesign\b/,
      /\bprovisioning\s*profile/i,
      /\bcertificate/i,
      /\bapp\s*store\s*connect/i,
    ],
  },
  {
    category: "package-management",
    label: "Package Management Overhead",
    description:
      "Manually managing dependencies, versions, and package configurations",
    matchers: [
      /\b(npm|yarn|pnpm)\s+(install|add|remove|update|upgrade|outdated)\b/,
      /\bpip\s+(install|uninstall|freeze)\b/,
      /\bbrew\s+(install|update|upgrade|uninstall)\b/,
      /\bcargo\s+(add|install|update)\b/,
    ],
  },
  {
    category: "monitoring",
    label: "Manual Monitoring & Debugging",
    description:
      "Checking logs, metrics, and system health through manual inspection",
    matchers: [
      /\btail\s+-f\b/,
      /\bjournalctl\b/,
      /\blog.*\b(check|inspect|view|read)\b/i,
      /\bhtop\b/,
      /\bps\s+aux\b/,
    ],
  },
  {
    category: "search",
    label: "Manual Code Search",
    description:
      "Searching through code and documentation manually",
    matchers: [
      /\b(grep|rg|ag)\s+-[rRn]/,
      /\bfind\s+\.\s+-name\b/,
    ],
  },
  {
    category: "project-management",
    label: "Manual Project Management",
    description:
      "Managing issues, tickets, and project tracking outside the editor",
    matchers: [
      /\b(jira|linear|notion|trello|asana)\b/i,
      /\bgh\s+(issue|pr)\s+(create|list|view|close)\b/,
    ],
  },
  {
    category: "ci-cd",
    label: "Manual CI/CD Interaction",
    description:
      "Checking build status, triggering pipelines, and managing CI/CD manually",
    matchers: [
      /\bgh\s+(run|workflow)\b/,
      /\bgithub\s+actions\b/i,
      /\bcircle\s*ci\b/i,
      /\bjenkins\b/i,
    ],
  },
];

function matchBashCommands(
  commands: string[],
  rule: PatternRule
): string[] {
  const matches: string[] = [];
  for (const cmd of commands) {
    for (const matcher of rule.matchers) {
      if (matcher.test(cmd)) {
        // Truncate long commands for display
        matches.push(cmd.length > 80 ? cmd.substring(0, 77) + "..." : cmd);
        break;
      }
    }
  }
  return matches;
}

function matchUserMessages(
  messages: string[],
  rule: PatternRule
): string[] {
  const matches: string[] = [];
  for (const msg of messages) {
    for (const matcher of rule.matchers) {
      if (matcher.test(msg)) {
        const snippet =
          msg.length > 80 ? msg.substring(0, 77) + "..." : msg;
        matches.push(snippet);
        break;
      }
    }
  }
  return matches;
}

export function detectPatterns(scanResult: ScanResult): DetectedPattern[] {
  const patternMap = new Map<PatternCategory, DetectedPattern>();

  for (const project of scanResult.projects) {
    for (const rule of PATTERN_RULES) {
      const bashMatches = matchBashCommands(project.bashCommands, rule);
      const msgMatches = matchUserMessages(project.userMessages, rule);
      const allMatches = [...bashMatches, ...msgMatches];

      if (allMatches.length === 0) continue;

      const existing = patternMap.get(rule.category);
      if (existing) {
        existing.evidence.push(...allMatches.slice(0, 5));
        existing.frequency += allMatches.length;
        if (!existing.projects.includes(project.projectName)) {
          existing.projects.push(project.projectName);
        }
      } else {
        patternMap.set(rule.category, {
          category: rule.category,
          label: rule.label,
          description: rule.description,
          evidence: allMatches.slice(0, 5),
          frequency: allMatches.length,
          projects: [project.projectName],
        });
      }
    }
  }

  // Also detect tool usage patterns (heavy Bash usage = opportunity)
  const toolUsage = new Map<string, number>();
  for (const project of scanResult.projects) {
    for (const call of project.toolCalls) {
      toolUsage.set(call.name, (toolUsage.get(call.name) || 0) + 1);
    }
  }

  // Sort by frequency (most common patterns first)
  return Array.from(patternMap.values()).sort(
    (a, b) => b.frequency - a.frequency
  );
}

export function getToolUsageSummary(
  scanResult: ScanResult
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const project of scanResult.projects) {
    for (const call of project.toolCalls) {
      usage.set(call.name, (usage.get(call.name) || 0) + 1);
    }
  }
  return new Map(
    [...usage.entries()].sort((a, b) => b[1] - a[1])
  );
}
