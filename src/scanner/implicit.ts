/**
 * Implicit Signal Detectors
 *
 * Detects what the human did BETWEEN messages — what systems they consulted,
 * what logs they read, what dashboards they checked — by fingerprinting
 * the content they paste and the language they use.
 *
 * The current diagnosis catches what's explicitly said. This layer catches
 * the unsaid: "I'm getting this error" implies they read a console somewhere.
 */

export interface ImplicitSignal {
  type:
    | "pasted-logs"
    | "pasted-errors"
    | "pasted-stacktrace"
    | "pasted-config"
    | "pasted-output"
    | "external-observation"
    | "proactive-info"
    | "url-reference"
    | "system-reference"
    | "activity-gap";
  source: string; // Inferred source system
  evidence: string; // The triggering content (truncated)
  messageSnippet: string; // Broader context from the message
  confidence: "low" | "med" | "high";
  description: string;
}

// ── Content Fingerprint Detectors ──────────────────────────────────────
// Each detector looks for structural patterns in user messages that reveal
// which external system the human was reading from.

interface FingerprintRule {
  name: string;
  source: string;
  pattern: RegExp;
  confidence: "low" | "med" | "high";
  type: ImplicitSignal["type"];
  // Optional: only match if the message also contains this
  contextPattern?: RegExp;
}

const FINGERPRINT_RULES: FingerprintRule[] = [
  // ── Xcode / iOS ──
  {
    name: "xcode-build-error",
    source: "Xcode build output",
    pattern: /[\w\/]+\.swift:\d+:\d+:\s*(?:error|warning):/,
    confidence: "high",
    type: "pasted-errors",
  },
  {
    name: "xcode-linker-error",
    source: "Xcode linker",
    pattern: /(?:Undefined symbols? for architecture|ld: symbol\(s\) not found)/,
    confidence: "high",
    type: "pasted-errors",
  },
  {
    name: "xcode-console-log",
    source: "Xcode console / iOS Simulator logs",
    pattern: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\w+\[\d+:\d+\]/,
    confidence: "high",
    type: "pasted-logs",
  },
  {
    name: "ios-simulator-log",
    source: "iOS Simulator console",
    pattern: /(?:subsystem|category):\s*com\.\w+/i,
    confidence: "med",
    type: "pasted-logs",
  },
  {
    name: "xcrun-output",
    source: "xcrun / xcodebuild CLI",
    pattern: /(?:xcrun|xcodebuild):\s*(?:error|note|warning)/i,
    confidence: "high",
    type: "pasted-errors",
  },

  // ── Node.js / JavaScript ──
  {
    name: "node-stacktrace",
    source: "Node.js runtime",
    pattern: /at\s+\w+\s+\([\w\/\\]+\.(?:js|ts|mjs|cjs):\d+:\d+\)/,
    confidence: "high",
    type: "pasted-stacktrace",
  },
  {
    name: "node-error",
    source: "Node.js runtime",
    pattern: /(?:TypeError|ReferenceError|SyntaxError|RangeError|Error):\s+.{10,}/,
    confidence: "med",
    type: "pasted-errors",
  },
  {
    name: "npm-error",
    source: "npm / pnpm CLI",
    pattern: /(?:npm ERR!|ERR_PNPM_|ERESOLVE|ENOENT.*package\.json)/,
    confidence: "high",
    type: "pasted-errors",
  },

  // ── Python ──
  {
    name: "python-traceback",
    source: "Python runtime",
    pattern: /Traceback \(most recent call last\)/,
    confidence: "high",
    type: "pasted-stacktrace",
  },
  {
    name: "python-error",
    source: "Python runtime",
    pattern: /(?:File "[\w\/\\]+\.py", line \d+)/,
    confidence: "high",
    type: "pasted-stacktrace",
  },

  // ── Deployment / Infrastructure ──
  {
    name: "railway-log",
    source: "Railway deployment logs",
    pattern: /(?:railway|\.railway\.app)/i,
    confidence: "med",
    type: "pasted-logs",
    contextPattern: /(?:deploy|log|error|crash|fail|restart)/i,
  },
  {
    name: "vercel-output",
    source: "Vercel dashboard / CLI",
    pattern: /(?:vercel\.app|\.vercel\.app|VERCEL_|vercel\.json)/i,
    confidence: "med",
    type: "pasted-output",
    contextPattern: /(?:deploy|build|error|fail|404|500)/i,
  },
  {
    name: "docker-log",
    source: "Docker / container logs",
    pattern: /(?:docker|container)\s+(?:logs?|run|exec|ps)/i,
    confidence: "med",
    type: "pasted-logs",
  },
  {
    name: "cloud-log",
    source: "Cloud platform logs",
    pattern: /(?:severity|timestamp|resource\.type|logName).*(?:ERROR|WARNING|INFO)/i,
    confidence: "med",
    type: "pasted-logs",
  },

  // ── Database ──
  {
    name: "sql-error",
    source: "Database (SQL)",
    pattern: /(?:ERROR:\s+(?:relation|column|syntax error at)|SQLSTATE|duplicate key|violates (?:unique|foreign key|check) constraint)/i,
    confidence: "high",
    type: "pasted-errors",
  },
  {
    name: "supabase-output",
    source: "Supabase dashboard",
    pattern: /(?:supabase|\.supabase\.co|project_ref|anon.*key|service_role)/i,
    confidence: "med",
    type: "pasted-output",
    contextPattern: /(?:table|query|rls|policy|function|migration|dashboard)/i,
  },

  // ── HTTP / API ──
  {
    name: "http-status",
    source: "HTTP response (browser or API client)",
    pattern: /(?:HTTP\/\d\.\d\s+\d{3}|status(?:Code)?\s*[:=]\s*[45]\d{2}|response\s+\d{3})/,
    confidence: "med",
    type: "pasted-output",
  },
  {
    name: "curl-output",
    source: "curl / API testing",
    pattern: /(?:< HTTP\/|> (?:GET|POST|PUT|DELETE|PATCH)\s+\/|curl:\s+\(\d+\))/,
    confidence: "high",
    type: "pasted-output",
  },
  {
    name: "api-json-error",
    source: "API error response",
    pattern: /\{\s*"(?:error|message|detail|status)":\s*"[^"]+"/,
    confidence: "med",
    type: "pasted-errors",
    contextPattern: /(?:getting|returned|response|api|endpoint)/i,
  },

  // ── Network / TCP ──
  {
    name: "tcp-error",
    source: "Network / TCP stack",
    pattern: /tcp_(?:output|input|connection)\s*\[[\w.:]+\]/,
    confidence: "high",
    type: "pasted-logs",
  },
  {
    name: "connection-error",
    source: "Network layer",
    pattern: /(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|Connection refused|Connection reset)/,
    confidence: "high",
    type: "pasted-errors",
  },

  // ── Browser ──
  {
    name: "browser-console",
    source: "Browser developer console",
    pattern: /(?:Uncaught (?:TypeError|ReferenceError|SyntaxError)|console\.(?:error|warn)\(|DevTools)/,
    confidence: "high",
    type: "pasted-errors",
  },
  {
    name: "cors-error",
    source: "Browser (CORS)",
    pattern: /(?:Access-Control-Allow-Origin|CORS|cross-origin|blocked by CORS)/i,
    confidence: "high",
    type: "pasted-errors",
  },

  // ── Git ──
  {
    name: "git-diff-output",
    source: "Git CLI output",
    pattern: /^(?:diff --git|@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@)/m,
    confidence: "high",
    type: "pasted-output",
  },
  {
    name: "merge-conflict",
    source: "Git merge conflict",
    pattern: /^<<<<<<< (?:HEAD|[\w\/]+)/m,
    confidence: "high",
    type: "pasted-output",
  },

  // ── CI/CD ──
  {
    name: "github-actions",
    source: "GitHub Actions logs",
    pattern: /(?:Run |##\[error\]|##\[warning\]|::error::|github\.com\/[\w-]+\/[\w-]+\/actions)/,
    confidence: "high",
    type: "pasted-logs",
  },

  // ── Config / Environment ──
  {
    name: "env-values",
    source: "Environment variables / .env file",
    pattern: /(?:^[A-Z][A-Z_]{2,}=\S+$)/m,
    confidence: "med",
    type: "pasted-config",
  },

  // ── Generic structured output ──
  {
    name: "multi-line-json",
    source: "JSON output (unknown system)",
    pattern: /^\s*\{[\s\S]{50,}^\s*\}/m,
    confidence: "low",
    type: "pasted-output",
  },
  {
    name: "terminal-prompt",
    source: "Terminal output (pasted from another terminal)",
    pattern: /(?:^[$%#>]\s+\w|^\w+@[\w-]+[:%~])/m,
    confidence: "med",
    type: "pasted-output",
  },
];

// ── Observation Language Patterns ──────────────────────────────────────
// Detect when the user describes something they observed in an external system.
// "I see an error on the dashboard" → they were looking at a dashboard.

interface ObservationPattern {
  pattern: RegExp;
  description: string;
  inferredAction: string;
}

const OBSERVATION_PATTERNS: ObservationPattern[] = [
  // Direct observation
  {
    pattern: /\bi (?:can )?see\b/i,
    description: "User reports visual observation",
    inferredAction: "User looked at something — a screen, console, dashboard, or app",
  },
  {
    pattern: /\bit (?:shows?|says?|displays?|reads?)\b/i,
    description: "User reports what a system shows",
    inferredAction: "User read output from an external system",
  },
  {
    pattern: /\bi(?:'m| am) (?:getting|seeing|having)\b/i,
    description: "User reports experiencing something",
    inferredAction: "User observed behavior in a running system",
  },
  {
    pattern: /\bthere(?:'s| is) (?:an? |no |still )\b/i,
    description: "User reports state of something",
    inferredAction: "User inspected current state of a system",
  },

  // Explicit checking
  {
    pattern: /\bi (?:checked|looked at|opened|went to|pulled up|refreshed)\b/i,
    description: "User explicitly says they checked something",
    inferredAction: "User navigated to an external system",
  },
  {
    pattern: /\b(?:on|in|from) (?:the |my )?(?:dashboard|console|terminal|browser|simulator|xcode|logs?|website|app)\b/i,
    description: "User references checking a specific system",
    inferredAction: "User read from named external system",
  },

  // Reporting external results
  {
    pattern: /\b(?:the |my )?(?:deploy|build|test|pipeline|ci|migration|release) (?:failed|succeeded|passed|broke|is (?:broken|failing|stuck|running|done))\b/i,
    description: "User reports deployment/build/CI status",
    inferredAction: "User checked deployment, CI, or build status externally",
  },
  {
    pattern: /\b(?:the |it )(?:works?|doesn't work|isn't working|broke|crashed|is down|is up)\b/i,
    description: "User reports runtime behavior",
    inferredAction: "User tested the app/service manually",
  },

  // Proactive information delivery
  {
    pattern: /\bfor some reason\b/i,
    description: "User reports unexpected behavior they observed",
    inferredAction: "User noticed unexpected behavior in a running system",
  },
  {
    pattern: /\bafter (?:doing|running|deploying|pushing|merging|updating)\b/i,
    description: "User describes what happened after an action",
    inferredAction: "User performed an action outside the session and observed the result",
  },
];

// ── System Reference Patterns ──────────────────────────────────────
// Detect when the user references specific external systems by name.

interface SystemReference {
  pattern: RegExp;
  system: string;
}

const SYSTEM_REFERENCES: SystemReference[] = [
  { pattern: /\brailway\b/i, system: "Railway (deployment platform)" },
  { pattern: /\bvercel\b/i, system: "Vercel (deployment platform)" },
  { pattern: /\bnetlify\b/i, system: "Netlify (deployment platform)" },
  { pattern: /\bheroku\b/i, system: "Heroku (deployment platform)" },
  { pattern: /\bfly\.io\b/i, system: "Fly.io (deployment platform)" },
  { pattern: /\bsupabase\b/i, system: "Supabase (database/backend)" },
  { pattern: /\bfirebase\b/i, system: "Firebase (backend)" },
  { pattern: /\bneon\b(?!.*color)/i, system: "Neon (database)" },
  { pattern: /\bplanetscale\b/i, system: "PlanetScale (database)" },
  { pattern: /\blinear\b/i, system: "Linear (issue tracking)" },
  { pattern: /\bjira\b/i, system: "Jira (issue tracking)" },
  { pattern: /\bfigma\b/i, system: "Figma (design tool)" },
  { pattern: /\bslack\b/i, system: "Slack (messaging)" },
  { pattern: /\bdiscord\b/i, system: "Discord (messaging)" },
  { pattern: /\bnotion\b/i, system: "Notion (docs)" },
  { pattern: /\bpostman\b/i, system: "Postman (API testing)" },
  { pattern: /\bgrafana\b/i, system: "Grafana (monitoring)" },
  { pattern: /\bdatadog\b/i, system: "Datadog (monitoring)" },
  { pattern: /\bsentry\b/i, system: "Sentry (error tracking)" },
  { pattern: /\btestflight\b/i, system: "TestFlight (iOS distribution)" },
  { pattern: /\bapp store connect\b/i, system: "App Store Connect (iOS distribution)" },
  { pattern: /\bxcode\b/i, system: "Xcode (IDE)" },
  { pattern: /\bsafari\b(?!.*webkit)/i, system: "Safari (browser)" },
  { pattern: /\bchrome\b(?!.*extension)/i, system: "Chrome (browser)" },
  { pattern: /\bpostgres(?:ql)?\b/i, system: "PostgreSQL (database)" },
  { pattern: /\bredis\b/i, system: "Redis (cache/database)" },
  { pattern: /\bstripe\b/i, system: "Stripe (payments)" },
  { pattern: /\bcloudflare\b/i, system: "Cloudflare (CDN/DNS)" },
  { pattern: /\baws\b/i, system: "AWS (cloud)" },
  { pattern: /\bgcp\b/i, system: "Google Cloud (cloud)" },
  { pattern: /\bazure\b/i, system: "Azure (cloud)" },
  { pattern: /\bposthog\b/i, system: "PostHog (analytics)" },
  { pattern: /\bmixpanel\b/i, system: "Mixpanel (analytics)" },
  { pattern: /\bamplitude\b/i, system: "Amplitude (analytics)" },
];

// ── URL Detection ──────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

// ── Activity Gap Detection ──────────────────────────────────────
// Uses tool call timestamps to detect when the user was away doing something else.

function detectActivityGaps(
  toolTimestamps: string[],
  thresholdMinutes: number = 5,
  maxGapMinutes: number = 60 // Ignore gaps > 1 hour (likely session breaks, not active brokering)
): { gapStart: string; gapEnd: string; gapMinutes: number }[] {
  const gaps: { gapStart: string; gapEnd: string; gapMinutes: number }[] = [];
  const sorted = [...toolTimestamps].sort();

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]).getTime();
    const curr = new Date(sorted[i]).getTime();
    if (isNaN(prev) || isNaN(curr)) continue;

    const gapMinutes = (curr - prev) / 60000;
    if (gapMinutes >= thresholdMinutes && gapMinutes <= maxGapMinutes) {
      gaps.push({
        gapStart: sorted[i - 1],
        gapEnd: sorted[i],
        gapMinutes: Math.round(gapMinutes),
      });
    }
  }

  return gaps;
}

// ── Main Detection Function ──────────────────────────────────────

function isSkillContent(text: string): boolean {
  return (
    text.startsWith("Base directory for this skill:") ||
    text.startsWith("# ") ||
    text.startsWith("This session is being continued") ||
    text.includes("SKILL.md") ||
    text.length > 2000
  );
}

export function detectImplicitSignals(
  userMessages: string[],
  toolTimestamps: string[]
): ImplicitSignal[] {
  const signals: ImplicitSignal[] = [];
  const seen = new Set<string>(); // Dedup by rule+message combo

  for (const msg of userMessages) {
    if (isSkillContent(msg)) continue;
    if (msg.length < 5) continue;

    const snippet = msg.length > 300 ? msg.substring(0, 297) + "..." : msg;

    // ── Content Fingerprints ──
    for (const rule of FINGERPRINT_RULES) {
      if (!rule.pattern.test(msg)) continue;
      if (rule.contextPattern && !rule.contextPattern.test(msg)) continue;

      const key = `${rule.name}:${msg.substring(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const match = msg.match(rule.pattern);
      const evidenceStr = match
        ? match[0].substring(0, 150)
        : msg.substring(0, 150);

      signals.push({
        type: rule.type,
        source: rule.source,
        evidence: evidenceStr,
        messageSnippet: snippet,
        confidence: rule.confidence,
        description: `User pasted content fingerprinted as ${rule.source}`,
      });
    }

    // ── Observation Language ──
    for (const obs of OBSERVATION_PATTERNS) {
      if (!obs.pattern.test(msg)) continue;

      const key = `obs:${obs.description}:${msg.substring(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      signals.push({
        type: "external-observation",
        source: obs.inferredAction,
        evidence: msg.match(obs.pattern)?.[0] || "",
        messageSnippet: snippet,
        confidence: "med",
        description: obs.description,
      });
    }

    // ── URL References ──
    const urls = msg.match(URL_PATTERN);
    if (urls) {
      for (const url of urls) {
        const key = `url:${url}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Infer system from URL
        let source = "External web page";
        if (/github\.com/i.test(url)) source = "GitHub";
        else if (/railway\.app/i.test(url)) source = "Railway";
        else if (/vercel\.app/i.test(url)) source = "Vercel";
        else if (/supabase\.(co|com)/i.test(url)) source = "Supabase";
        else if (/linear\.app/i.test(url)) source = "Linear";
        else if (/figma\.com/i.test(url)) source = "Figma";
        else if (/slack\.com/i.test(url)) source = "Slack";
        else if (/notion\.so/i.test(url)) source = "Notion";
        else if (/localhost|127\.0\.0\.1/i.test(url)) source = "Local dev server";
        else if (/sentry\.io/i.test(url)) source = "Sentry";
        else if (/grafana/i.test(url)) source = "Grafana";

        signals.push({
          type: "url-reference",
          source,
          evidence: url.substring(0, 200),
          messageSnippet: snippet,
          confidence: "high",
          description: `User shared URL from ${source}`,
        });
      }
    }

    // ── System References ──
    for (const ref of SYSTEM_REFERENCES) {
      if (!ref.pattern.test(msg)) continue;

      const key = `sysref:${ref.system}:${msg.substring(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      signals.push({
        type: "system-reference",
        source: ref.system,
        evidence: msg.match(ref.pattern)?.[0] || "",
        messageSnippet: snippet,
        confidence: "low",
        description: `User referenced ${ref.system}`,
      });
    }
  }

  // ── Activity Gaps ──
  const gaps = detectActivityGaps(toolTimestamps);
  for (const gap of gaps) {
    signals.push({
      type: "activity-gap",
      source: "Unknown (user was away from session)",
      evidence: `${gap.gapMinutes}min gap: ${gap.gapStart} → ${gap.gapEnd}`,
      messageSnippet: "",
      confidence: gap.gapMinutes >= 15 ? "high" : "med",
      description: `${gap.gapMinutes}-minute gap between tool calls — user was likely doing something outside the session`,
    });
  }

  return signals;
}

// ── Summary for Brief ──────────────────────────────────────

export interface ImplicitSignalSummary {
  signals: ImplicitSignal[];
  systemsConsulted: string[]; // Unique systems the human interacted with
  totalGapMinutes: number; // Time spent outside the session
  topSources: { source: string; count: number }[]; // Most-referenced external systems
}

export function summarizeImplicitSignals(
  signals: ImplicitSignal[]
): ImplicitSignalSummary {
  const sourceCounts = new Map<string, number>();

  for (const sig of signals) {
    if (sig.type !== "activity-gap") {
      sourceCounts.set(sig.source, (sourceCounts.get(sig.source) || 0) + 1);
    }
  }

  const systemsConsulted = [...new Set(signals
    .filter((s) => s.confidence !== "low" && s.type !== "activity-gap")
    .map((s) => s.source)
  )];

  const totalGapMinutes = signals
    .filter((s) => s.type === "activity-gap")
    .reduce((sum, s) => {
      const match = s.description.match(/(\d+)-minute/);
      return sum + (match ? parseInt(match[1]) : 0);
    }, 0);

  const topSources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  return {
    signals,
    systemsConsulted,
    totalGapMinutes,
    topSources,
  };
}
