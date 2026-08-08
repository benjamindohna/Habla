import OpenAI from "openai";
import { getUsageContext } from "./usageContext";
import { estimateCostUsd } from "./llmPricing";

// db + schema are dynamically imported inside the logging functions —
// statically importing them here makes Next.js bundle lib/db.ts into
// every client component that transitively reaches lib/llm.ts (e.g.
// via lib/vocab.ts → page.tsx). lib/db.ts pulls `postgres` which uses
// Node-only modules ('fs', 'perf_hooks') and breaks the client build.
// Dynamic imports keep them server-only.

async function persistUsageRow(row: {
  userId: number | null;
  label: string;
  model: string;
  kind: "chat" | "transcription" | "tts";
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  inputChars?: number | null;
  inputBytes?: number | null;
  outputBytes?: number | null;
  costUsd: string | null;
  route?: string | null;
}): Promise<void> {
  try {
    const [{ db }, { llmUsage }] = await Promise.all([
      import("./db"),
      import("./schema"),
    ]);
    await db.insert(llmUsage).values(row);
  } catch (err) {
    console.warn(`[llm-usage] insert failed for ${row.label}:`, (err as Error).message);
  }
}

/**
 * Single source of truth for which model handles which task. Routes pick
 * the *task* by intent ("chat_light" for cheap chat work, "chat_precise"
 * for structured-output work that needs the bigger model) and never
 * hard-code model strings. Swapping a model — or A/B-testing — happens
 * here, in one place.
 */
export const TASK_MODELS = {
  /** Cheap chat tasks: topic generation, interest curation, conversation
   *  replies, interpretation. */
  chat_light: "gpt-4o-mini",
  /** Higher-stakes structured output: segment alignment, learner-aware
   *  localisation, per-segment explanation. */
  chat_precise: "gpt-4o",
  /** Whole-sentence annotation (spans + glosses) for the pre-annotation
   *  lookup cache. Latency- and cost-critical, quality bar is "reliable
   *  structured JSON + correct Spanish collocation grouping" — Gemini
   *  Flash-Lite with thinking off is the cheapest model that clears it.
   *  2.5 Flash-Lite is already unavailable to new API users (sunset
   *  2026-10-16), so we target the successor 3.1 directly.
   *  Falls back to chat_light when GEMINI_API_KEY is missing. */
  annotate: "gemini-3.1-flash-lite",
  /** xAI Grok experiment slot — currently the vocab recognition judge.
   *  grok-4-fast-non-reasoning is xAI's explicit no-CoT fast tier;
   *  empirically ~0.6s end-to-end with 0 reasoning_tokens for the
   *  judge prompt. Avoid grok-3-mini and grok-4-fast: both alias to a
   *  reasoning model on xAI's backend, so a 1-character verdict
   *  burns 150–270 reasoning tokens + 3s latency — terrible for a
   *  call the user is blocking on. */
  chat_grok_fast: "grok-4-fast-non-reasoning",
  /** Speech-to-text. */
  transcription: "gpt-4o-transcribe",
  /** Text-to-speech. */
  tts: "gpt-4o-mini-tts",
} as const;

export type ChatTask = "chat_light" | "chat_precise" | "chat_grok_fast" | "annotate";

const GROK_TASKS = new Set<ChatTask>(["chat_grok_fast"]);
const GOOGLE_TASKS = new Set<ChatTask>(["annotate"]);

// ── Bench models ──────────────────────────────────────────────────────────
//
// Candidate models for the /playground/model-bench page. Each entry can be
// requested per-call via the `benchModel` opt on chatJSON/chatText, which
// overrides the task→model mapping above. Production code never sets
// benchModel; only the bench route does. Anthropic goes through the
// official @anthropic-ai/sdk (dynamically imported, same reason as db.ts —
// llm.ts is transitively reachable from client bundles); Google's Gemini
// exposes an OpenAI-compatible endpoint, so it reuses the OpenAI SDK with
// a baseURL swap, like xAI.

export interface BenchModelSpec {
  id: string;
  label: string;
  provider: "openai" | "anthropic" | "google" | "xai";
  /** Model string sent to the provider API. */
  apiModel: string;
  /** Rough $/1M input / output, display-only. */
  priceLabel: string;
  /** For reasoning-by-default models: force minimal/no thinking. Passed
   *  as `reasoning_effort` on OpenAI-compatible providers. Without this,
   *  gpt-5.x / Gemini 2.5 burn hidden thinking tokens — the exact trap
   *  the Grok experiment documented above. */
  reasoningEffort?: "minimal" | "none" | "low";
  /** gpt-5.x family rejects temperature ≠ default — omit the param. */
  noTemperature?: boolean;
  /** Env var that must be set for this provider. */
  keyEnv: string;
}

export const BENCH_MODELS: BenchModelSpec[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini (Prod chat_light)", provider: "openai", apiModel: "gpt-4o-mini", priceLabel: "$0.15 / $0.60", keyEnv: "OPENAI_API_KEY" },
  { id: "gpt-4o", label: "GPT-4o (Prod chat_precise)", provider: "openai", apiModel: "gpt-4o", priceLabel: "$2.50 / $10", keyEnv: "OPENAI_API_KEY" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai", apiModel: "gpt-4.1-mini", priceLabel: "$0.40 / $1.60", keyEnv: "OPENAI_API_KEY" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", apiModel: "gpt-4.1", priceLabel: "$2 / $8", keyEnv: "OPENAI_API_KEY" },
  { id: "gpt-5-mini", label: "GPT-5 mini (minimal reasoning)", provider: "openai", apiModel: "gpt-5-mini", priceLabel: "~$0.25 / $2", reasoningEffort: "minimal", noTemperature: true, keyEnv: "OPENAI_API_KEY" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", apiModel: "claude-haiku-4-5", priceLabel: "$1 / $5", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", apiModel: "claude-sonnet-4-6", priceLabel: "$3 / $15", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (thinking off)", provider: "google", apiModel: "gemini-2.5-flash", priceLabel: "~$0.30 / $2.50", reasoningEffort: "none", keyEnv: "GEMINI_API_KEY" },
  // 2.5 Flash-Lite 404s for new API users since mid-2026 — replaced by 3.1.
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", provider: "google", apiModel: "gemini-3.1-flash-lite", priceLabel: "~$0.25 / $1.50", reasoningEffort: "none", keyEnv: "GEMINI_API_KEY" },
  { id: "grok-4-fast", label: "Grok 4 Fast (non-reasoning)", provider: "xai", apiModel: "grok-4-fast-non-reasoning", priceLabel: "~$0.20 / $0.50", keyEnv: "XAI_API_KEY" },
];

export function getBenchModel(id: string): BenchModelSpec | undefined {
  return BENCH_MODELS.find((m) => m.id === id);
}

export function benchModelAvailable(spec: BenchModelSpec): boolean {
  return Boolean(process.env[spec.keyEnv]);
}

let _openaiClient: OpenAI | null = null;
let _grokClient: OpenAI | null = null;
let _googleClient: OpenAI | null = null;
// Typed as unknown to avoid a static @anthropic-ai/sdk import (client
// bundle safety); cast at the single use site.
let _anthropicClient: unknown = null;

export function getOpenAI(): OpenAI {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}

function getGrok(): OpenAI {
  if (!_grokClient) {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error("XAI_API_KEY is not set");
    // xAI exposes an OpenAI-compatible REST surface — same SDK, just a
    // different baseURL. Models from TASK_MODELS that live under
    // chat_grok_fast (or any future grok-tagged slot) go through this
    // client; everything else stays on OpenAI.
    _grokClient = new OpenAI({ apiKey: key, baseURL: "https://api.x.ai/v1" });
  }
  return _grokClient;
}

function getGoogle(): OpenAI {
  if (!_googleClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    // Google's official OpenAI-compatibility endpoint for Gemini.
    _googleClient = new OpenAI({
      apiKey: key,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  return _googleClient;
}

async function getAnthropic(): Promise<import("@anthropic-ai/sdk").default> {
  if (!_anthropicClient) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _anthropicClient = new Anthropic({ apiKey: key });
  }
  return _anthropicClient as import("@anthropic-ai/sdk").default;
}

/**
 * Picks the right SDK client + model for a task. If a grok task is
 * requested but XAI_API_KEY isn't set yet, falls back to chat_light
 * (gpt-4o-mini) with a loud warning so the app keeps working until
 * the key is provisioned in env. Once XAI_API_KEY is present, the
 * call lands on Grok without further changes.
 */
function resolveClientAndModel(task: ChatTask): {
  client: OpenAI;
  model: string;
  /** Extra request params outside the SDK's TS union (reasoning_effort). */
  extraParams?: Record<string, unknown>;
} {
  if (GROK_TASKS.has(task)) {
    if (!process.env.XAI_API_KEY) {
      console.warn(
        `[llm] ${task} requested but XAI_API_KEY missing — falling back to ${TASK_MODELS.chat_light}`,
      );
      return { client: getOpenAI(), model: TASK_MODELS.chat_light };
    }
    return { client: getGrok(), model: TASK_MODELS[task] };
  }
  if (GOOGLE_TASKS.has(task)) {
    if (!process.env.GEMINI_API_KEY) {
      console.warn(
        `[llm] ${task} requested but GEMINI_API_KEY missing — falling back to ${TASK_MODELS.chat_light}`,
      );
      return { client: getOpenAI(), model: TASK_MODELS.chat_light };
    }
    // Gemini 2.5 thinks by default; reasoning_effort "none" turns it off.
    // Without this the annotate call burns hidden thinking tokens and
    // latency explodes (same trap the Grok experiment documented).
    return {
      client: getGoogle(),
      model: TASK_MODELS[task],
      extraParams: { reasoning_effort: "none" },
    };
  }
  return { client: getOpenAI(), model: TASK_MODELS[task] };
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

interface ChatBaseOpts {
  task: ChatTask;
  /** Tag used in cost-logs to identify the call site. */
  label: string;
  systemPrompt?: string;
  userPrompt?: string;
  messages?: ChatMessage[];
  temperature?: number;
  /** Bench override: route this call to a BENCH_MODELS entry instead of
   *  the task→model mapping. Only the model-bench playground sets this. */
  benchModel?: string;
}

interface ChatJSONOpts extends ChatBaseOpts {
  maxTokens?: number;
}
interface ChatTextOpts extends ChatBaseOpts {
  maxTokens?: number;
}

function buildMessages(opts: ChatBaseOpts): ChatMessage[] {
  if (opts.messages) return opts.messages;
  const messages: ChatMessage[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  if (opts.userPrompt) messages.push({ role: "user", content: opts.userPrompt });
  if (messages.length === 0) {
    throw new Error("chat helper: provide messages, systemPrompt, or userPrompt");
  }
  return messages;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // xAI Grok models expose hidden reasoning tokens here even when we
  // request a non-reasoning variant; surface them in the log so we
  // notice if a model starts "thinking" silently.
  completion_tokens_details?: { reasoning_tokens?: number };
}

/**
 * Log gating:
 *  - LLM_LOG=1 forces logging on (dev or prod).
 *  - LLM_LOG=0 forces logging off.
 *  - Unset: on in dev, off in prod.
 */
function shouldLog(): boolean {
  const flag = process.env.LLM_LOG;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV !== "production";
}

function logUsage(label: string, model: string, usage: Usage | undefined): void {
  if (!usage) return;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;

  if (shouldLog()) {
    const reasoningPart = reasoning && reasoning > 0 ? ` reasoning=${reasoning}` : "";
    console.log(
      `[llm] ${label} model=${model} prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"}${reasoningPart} total=${usage.total_tokens ?? "?"}`,
    );
  }

  // Persist to llm_usage (fire-and-forget). Errors are swallowed —
  // analytics must never break a real LLM call. user_id + route come
  // from the AsyncLocalStorage context set at route entry; if absent,
  // both are null and the row still has the counts.
  const ctx = getUsageContext();
  const promptTokens = usage.prompt_tokens ?? null;
  const completionTokens = usage.completion_tokens ?? null;
  const costUsd = estimateCostUsd({
    model,
    kind: "chat",
    promptTokens: promptTokens ?? undefined,
    completionTokens: completionTokens ?? undefined,
  });
  void persistUsageRow({
    userId: ctx?.userId ?? null,
    label,
    model,
    kind: "chat",
    promptTokens,
    completionTokens,
    reasoningTokens: reasoning ?? null,
    costUsd,
    route: ctx?.route ?? null,
  });
}

/**
 * Audio APIs (Whisper, TTS) don't return token usage. Log the size signals
 * we have so cost telemetry exists for those routes too — OpenAI bills
 * Whisper by audio duration (≈ input bytes for a fixed codec) and TTS by
 * input character count. Caller passes whichever signals it has.
 */
export function logAudioUsage(
  label: string,
  model: string,
  signals: {
    inputBytes?: number;
    outputBytes?: number;
    inputChars?: number;
    outputChars?: number;
  },
): void {
  if (shouldLog()) {
    const parts = [`[llm] ${label} model=${model}`];
    if (signals.inputBytes !== undefined) parts.push(`inputBytes=${signals.inputBytes}`);
    if (signals.inputChars !== undefined) parts.push(`inputChars=${signals.inputChars}`);
    if (signals.outputBytes !== undefined) parts.push(`outputBytes=${signals.outputBytes}`);
    if (signals.outputChars !== undefined) parts.push(`outputChars=${signals.outputChars}`);
    console.log(parts.join(" "));
  }

  // Same fire-and-forget DB persistence as logUsage above. Kind is
  // inferred from the model — transcription models go to transcription,
  // tts models go to tts; everything else gets "tts" as a fallback
  // (we don't currently call this for anything else).
  const ctx = getUsageContext();
  const kind: "transcription" | "tts" = /transcribe/i.test(model) ? "transcription" : "tts";
  const costUsd = estimateCostUsd({
    model,
    kind,
    inputBytes: signals.inputBytes,
    outputBytes: signals.outputBytes,
  });
  void persistUsageRow({
    userId: ctx?.userId ?? null,
    label,
    model,
    kind,
    inputChars: signals.inputChars ?? null,
    inputBytes: signals.inputBytes ?? null,
    outputBytes: signals.outputBytes ?? null,
    costUsd,
    route: ctx?.route ?? null,
  });
}

/** Strip markdown fences / pre- and post-amble around a JSON object.
 *  Needed for providers without a json_object response_format (Anthropic);
 *  harmless for the rest. */
function parseJSONLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object in model reply");
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
}

/** OpenAI-compatible call against a bench model (openai / google / xai). */
async function benchOpenAICompatible(
  spec: BenchModelSpec,
  opts: ChatBaseOpts & { json?: boolean; maxTokens?: number },
): Promise<string> {
  const client =
    spec.provider === "google" ? getGoogle() : spec.provider === "xai" ? getGrok() : getOpenAI();
  const params: Record<string, unknown> = {
    model: spec.apiModel,
    messages: buildMessages(opts),
  };
  if (opts.json) params.response_format = { type: "json_object" };
  if (!spec.noTemperature) params.temperature = opts.temperature ?? 0.2;
  if (opts.maxTokens) {
    // gpt-5.x rejects the legacy param name; everyone else still uses it.
    if (spec.noTemperature) params.max_completion_tokens = opts.maxTokens;
    else params.max_tokens = opts.maxTokens;
  }
  // reasoning_effort "minimal"/"none" is outside the SDK's TS union but
  // accepted by gpt-5.x and Gemini's compat endpoint — without it these
  // models think silently and latency explodes.
  if (spec.reasoningEffort) params.reasoning_effort = spec.reasoningEffort;
  const completion = await client.chat.completions.create(
    params as unknown as Parameters<typeof client.chat.completions.create>[0] & { stream?: false },
  );
  logUsage(opts.label, spec.apiModel, completion.usage);
  return completion.choices[0]?.message?.content ?? "";
}

/** Anthropic call via the official SDK (Messages API). */
async function benchAnthropic(
  spec: BenchModelSpec,
  opts: ChatBaseOpts & { maxTokens?: number },
): Promise<string> {
  const client = await getAnthropic();
  const all = buildMessages(opts);
  const system = all.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = all
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  // The Messages API requires at least one user turn; prompt-only calls
  // (single system prompt, e.g. the segmenter) get a minimal kick-off.
  if (turns.length === 0) turns.push({ role: "user", content: "Proceed as instructed." });
  const response = await client.messages.create({
    model: spec.apiModel,
    max_tokens: opts.maxTokens ?? 4096,
    ...(system ? { system } : {}),
    temperature: opts.temperature ?? 0.2,
    messages: turns,
  });
  logUsage(opts.label, spec.apiModel, {
    prompt_tokens: response.usage.input_tokens,
    completion_tokens: response.usage.output_tokens,
    total_tokens: response.usage.input_tokens + response.usage.output_tokens,
  });
  const text = response.content
    .filter((b): b is { type: "text"; text: string } & typeof b => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}

async function benchChatRaw(
  benchModelId: string,
  opts: ChatBaseOpts & { json?: boolean; maxTokens?: number },
): Promise<string> {
  const spec = getBenchModel(benchModelId);
  if (!spec) throw new Error(`Unknown bench model: ${benchModelId}`);
  if (!benchModelAvailable(spec)) throw new Error(`${spec.keyEnv} is not set`);
  if (spec.provider === "anthropic") return benchAnthropic(spec, opts);
  return benchOpenAICompatible(spec, opts);
}

/**
 * Calls the chat API with `response_format: json_object` and parses the
 * reply. Throws if the reply is empty or not valid JSON.
 */
export async function chatJSON<T = unknown>(opts: ChatJSONOpts): Promise<T> {
  if (opts.benchModel) {
    const raw = await benchChatRaw(opts.benchModel, { ...opts, json: true });
    return parseJSONLoose<T>(raw || "{}");
  }
  const { client, model, extraParams } = resolveClientAndModel(opts.task);
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
    ...(extraParams as object),
  } as Parameters<typeof client.chat.completions.create>[0] & { stream?: false });
  logUsage(opts.label, model, completion.usage);
  const raw = completion.choices[0]?.message?.content ?? "{}";
  return parseJSONLoose<T>(raw) as T;
}

/**
 * Calls the chat API for plain-text output (no JSON constraint). Returns
 * the trimmed message content.
 */
export async function chatText(opts: ChatTextOpts): Promise<string> {
  if (opts.benchModel) {
    const raw = await benchChatRaw(opts.benchModel, opts);
    return raw.trim();
  }
  const { client, model, extraParams } = resolveClientAndModel(opts.task);
  const completion = await client.chat.completions.create({
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
    ...(extraParams as object),
  } as Parameters<typeof client.chat.completions.create>[0] & { stream?: false });
  logUsage(opts.label, model, completion.usage);
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

/**
 * Streaming variant of chatText. Calls `onDelta` with each content chunk
 * as it arrives and resolves with the full trimmed text. Identical tokens
 * to the non-streaming call — same model, same params — only the delivery
 * is incremental, so quality is unaffected by design.
 *
 * Bench-model overrides don't stream (the playground doesn't need it):
 * they fall back to one buffered chatText call and a single onDelta.
 */
export async function chatTextStream(
  opts: ChatTextOpts & { onDelta: (delta: string) => void },
): Promise<string> {
  if (opts.benchModel) {
    const full = await chatText(opts);
    if (full) opts.onDelta(full);
    return full;
  }
  const { client, model, extraParams } = resolveClientAndModel(opts.task);
  const stream = await client.chat.completions.create({
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
    stream: true,
    // Ask the API to append a final usage chunk so cost logging keeps
    // working on streamed calls.
    stream_options: { include_usage: true },
    ...(extraParams as object),
  } as Parameters<typeof client.chat.completions.create>[0] & { stream: true });
  let full = "";
  let usage: Usage | undefined;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      opts.onDelta(delta);
    }
    if (chunk.usage) usage = chunk.usage as Usage;
  }
  logUsage(opts.label, model, usage);
  return full.trim();
}
