import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

interface WorkerRequest {
  prompt: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
  model: string;
}

interface WorkerResponse {
  structuredOutput: unknown;
  textOutput: string;
  resultSubtype: string | null;
  stopReason: string | null;
  numTurns: number | null;
  eventCounts: Record<string, number>;
  eventTrace: string[];
  firstEventMs: number | null;
  firstAssistantMs: number | null;
  resultMs: number | null;
  lastAssistantPreview: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  exitCode: number | null;
  errors: string[];
}

function summarizeEvent(message: unknown): string {
  if (!message || typeof message !== "object") return "unknown";
  const type = (message as { type?: unknown }).type;
  const subtype = (message as { subtype?: unknown }).subtype;
  if (typeof type !== "string") return "unknown";
  return typeof subtype === "string" ? `${type}:${subtype}` : type;
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";

  const textChunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const text = (block as { type?: unknown; text?: unknown }).type === "text"
      ? (block as { text?: unknown }).text
      : undefined;
    if (typeof text === "string" && text.trim()) textChunks.push(text);
  }
  return textChunks.join("\n").trim();
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

async function runWorkerQuery(request: WorkerRequest): Promise<WorkerResponse> {
  const stderrChunks: string[] = [];
  const assistantChunks: string[] = [];
  const startedAt = Date.now();
  let timedOut = false;
  let resultMessage: SDKResultMessage | null = null;
  const eventCounts: Record<string, number> = {};
  const eventTrace: string[] = [];
  let firstEventMs: number | null = null;
  let firstAssistantMs: number | null = null;
  let resultMs: number | null = null;
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const stream = query({
    prompt: request.prompt,
    options: {
      cwd: process.cwd(),
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      permissionMode: "dontAsk",
      model: request.model,
      thinking: { type: "disabled" },
      effort: "low",
      systemPrompt:
        "You are AgentScout's diagnosis worker. You already have all required input in the prompt. Do not inspect files, do not narrate steps, do not say what you need to analyze, and do not write prose. Return exactly one JSON object matching the provided schema.",
      env,
      outputFormat: {
        type: "json_schema",
        schema: request.outputSchema,
      },
      stderr: (data) => {
        stderrChunks.push(data);
      },
    },
  });

  const timer = setTimeout(() => {
    timedOut = true;
    stream.close();
  }, request.timeoutMs);

  try {
    for await (const message of stream) {
      const elapsedMs = Date.now() - startedAt;
      const eventKey = summarizeEvent(message);
      eventCounts[eventKey] = (eventCounts[eventKey] || 0) + 1;
      if (firstEventMs === null) firstEventMs = elapsedMs;
      if (eventTrace.length < 12) {
        eventTrace.push(`${(elapsedMs / 1000).toFixed(1)}s ${eventKey}`);
      }
      if (message.type === "assistant") {
        const assistantText = extractAssistantText(message.message);
        if (firstAssistantMs === null) firstAssistantMs = elapsedMs;
        if (assistantText) assistantChunks.push(assistantText);
      }
      if (message.type === "result") {
        resultMs = elapsedMs;
        resultMessage = message;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!resultMessage) {
    return {
      structuredOutput: null,
      textOutput: "",
      resultSubtype: null,
      stopReason: null,
      numTurns: null,
      eventCounts,
      eventTrace,
      firstEventMs,
      firstAssistantMs,
      resultMs,
      lastAssistantPreview: assistantChunks.length > 0 ? assistantChunks.at(-1)?.slice(0, 240) || "" : "",
      stderr: stderrChunks.join(""),
      timedOut,
      durationMs: Date.now() - startedAt,
      exitCode: null,
      errors: timedOut
        ? [`Claude Agent SDK timed out after ${request.timeoutMs}ms`]
        : ["Claude Agent SDK returned no result message"],
    };
  }

  if (resultMessage.subtype === "success") {
    return {
      structuredOutput: resultMessage.structured_output ?? null,
      textOutput: resultMessage.result || assistantChunks.join("\n\n") || "",
      resultSubtype: resultMessage.subtype,
      stopReason: resultMessage.stop_reason ?? null,
      numTurns: resultMessage.num_turns ?? null,
      eventCounts,
      eventTrace,
      firstEventMs,
      firstAssistantMs,
      resultMs,
      lastAssistantPreview: assistantChunks.length > 0 ? assistantChunks.at(-1)?.slice(0, 240) || "" : "",
      stderr: stderrChunks.join(""),
      timedOut,
      durationMs: resultMessage.duration_ms || Date.now() - startedAt,
      exitCode: null,
      errors: [],
    };
  }

  return {
    structuredOutput: null,
    textOutput: assistantChunks.join("\n\n"),
    resultSubtype: resultMessage.subtype,
    stopReason: resultMessage.stop_reason ?? null,
    numTurns: resultMessage.num_turns ?? null,
    eventCounts,
    eventTrace,
    firstEventMs,
    firstAssistantMs,
    resultMs,
    lastAssistantPreview: assistantChunks.length > 0 ? assistantChunks.at(-1)?.slice(0, 240) || "" : "",
    stderr: stderrChunks.join(""),
    timedOut,
    durationMs: resultMessage.duration_ms || Date.now() - startedAt,
    exitCode: null,
    errors: resultMessage.errors || ["Claude Agent SDK returned an execution error"],
  };
}

async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    const request = JSON.parse(raw) as WorkerRequest;
    const response = await runWorkerQuery(request);
    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: WorkerResponse = {
      structuredOutput: null,
      textOutput: "",
      resultSubtype: null,
      stopReason: null,
      numTurns: null,
      eventCounts: {},
      eventTrace: [],
      firstEventMs: null,
      firstAssistantMs: null,
      resultMs: null,
      lastAssistantPreview: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
      exitCode: 1,
      errors: [message],
    };
    process.stdout.write(JSON.stringify(response));
    process.exitCode = 1;
  }
}

void main();
