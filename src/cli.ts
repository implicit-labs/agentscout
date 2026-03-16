import { scanSessions } from "./scanner/sessions.js";
import { detectPatterns } from "./scanner/patterns.js";
import {
  computeDiagnosis,
  buildDiagnosisData,
  synthesizeFromExternalAnswers,
} from "./analyzer/diagnosis.js";
import { discoverInstalledTools } from "./scanner/installed.js";
import { buildToolingInventory } from "./scanner/inventory.js";
import { detectWorkflowSignals } from "./scanner/signals.js";
import { loadCatalog } from "./catalog/remote.js";
import pkg from "../package.json" with { type: "json" };

const args = process.argv.slice(2);

// Warm up the catalog cache in the background (skip for --help to avoid blocking exit)
if (!args.includes("--help") && !args.includes("-h")) {
  loadCatalog().catch(() => {});
}

// Parse --project flag: --project=name or --project name
function getProjectFilter(): string | undefined {
  const eqIdx = args.findIndex((a) => a.startsWith("--project="));
  if (eqIdx !== -1) return args[eqIdx].split("=")[1];
  const flagIdx = args.indexOf("--project");
  if (flagIdx !== -1 && flagIdx + 1 < args.length && !args[flagIdx + 1].startsWith("--")) {
    return args[flagIdx + 1];
  }
  return undefined;
}
const projectFilter = getProjectFilter();

if (args.includes("--help") || args.includes("-h")) {
  console.log(`AgentScout v${pkg.version}
Your agents should shop for their own tools.

Usage as Claude Code skills (recommended):
  /diagnose     Run full workflow diagnosis
  /recommend    Generate tool recommendations from diagnosis

Usage as CLI:
  agentscout --inventory              Output tooling inventory as JSON
  agentscout --emit-prompts           Scan sessions, output diagnosis prompts as JSON
  agentscout --apply-answers          Read subagent answers from stdin, output report JSON
  agentscout --project <name>         Scope to a single project (with --emit-prompts or --apply-answers)
  agentscout --help                   Show this help message
`);
} else if (args.includes("--inventory")) {
  (async () => {
    console.error(`[agentscout] v${pkg.version} inventory mode`);
    const inventory = await buildToolingInventory();
    process.stdout.write(JSON.stringify(inventory, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (args.includes("--emit-prompts")) {
  (async () => {
    console.error(`[agentscout] v${pkg.version} emit-prompts mode${projectFilter ? ` (project: ${projectFilter})` : ""}`);
    const [scan, installed] = await Promise.all([
      scanSessions(10, projectFilter),
      discoverInstalledTools(),
    ]);
    if (scan.totalProjects === 0) {
      console.error("[agentscout] No sessions found");
      process.exit(1);
    }
    const sessionSignalData = scan.projects.map((p) => ({
      toolUses: p.rawToolUses,
      userMessages: p.parsedUserMessages,
      projectName: p.projectName,
    }));
    const detectedSignals = detectWorkflowSignals(sessionSignalData);
    const computedDiag = computeDiagnosis(scan, detectedSignals, installed);
    const { briefs, prompts } = buildDiagnosisData(scan, detectedSignals, computedDiag, installed);
    process.stdout.write(JSON.stringify({ briefs, prompts, projectCount: computedDiag.projects.length }, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (args.includes("--apply-answers")) {
  (async () => {
    console.error(`[agentscout] v${pkg.version} apply-answers mode`);
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(chunks.join("")) as { answers: { project: string; json: unknown }[] };

    const [scan, installed] = await Promise.all([
      scanSessions(10, projectFilter),
      discoverInstalledTools(),
    ]);
    const sessionSignalData = scan.projects.map((p) => ({
      toolUses: p.rawToolUses,
      userMessages: p.parsedUserMessages,
      projectName: p.projectName,
    }));
    const detectedSignals = detectWorkflowSignals(sessionSignalData);
    const computedDiag = computeDiagnosis(scan, detectedSignals, installed);
    const llmRun = synthesizeFromExternalAnswers(computedDiag, input.answers);
    process.stdout.write(JSON.stringify(llmRun, null, 2));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.log(`AgentScout v${pkg.version}

Run /diagnose and /recommend as Claude Code skills for the full experience.
Run agentscout --help for CLI options.`);
}
