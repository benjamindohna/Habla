import OpenAI from "openai";

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

export type ChatTask = "chat_light" | "chat_precise" | "chat_grok_fast";

const GROK_TASKS = new Set<ChatTask>(["chat_grok_fast"]);

let _openaiClient: OpenAI | null = null;
let _grokClient: OpenAI | null = null;

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

/**
 * Picks the right SDK client + model for a task. If a grok task is
 * requested but XAI_API_KEY isn't set yet, falls back to chat_light
 * (gpt-4o-mini) with a loud warning so the app keeps working until
 * the key is provisioned in env. Once XAI_API_KEY is present, the
 * call lands on Grok without further changes.
 */
function resolveClientAndModel(task: ChatTask): { client: OpenAI; model: string } {
  if (GROK_TASKS.has(task)) {
    if (!process.env.XAI_API_KEY) {
      console.warn(
        `[llm] ${task} requested but XAI_API_KEY missing — falling back to ${TASK_MODELS.chat_light}`,
      );
      return { client: getOpenAI(), model: TASK_MODELS.chat_light };
    }
    return { client: getGrok(), model: TASK_MODELS[task] };
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
}

interface ChatJSONOpts extends ChatBaseOpts {}
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
  if (!shouldLog() || !usage) return;
  console.log(
    `[llm] ${label} model=${model} prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
  );
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
  if (!shouldLog()) return;
  const parts = [`[llm] ${label} model=${model}`];
  if (signals.inputBytes !== undefined) parts.push(`inputBytes=${signals.inputBytes}`);
  if (signals.inputChars !== undefined) parts.push(`inputChars=${signals.inputChars}`);
  if (signals.outputBytes !== undefined) parts.push(`outputBytes=${signals.outputBytes}`);
  if (signals.outputChars !== undefined) parts.push(`outputChars=${signals.outputChars}`);
  console.log(parts.join(" "));
}

/**
 * Calls the chat API with `response_format: json_object` and parses the
 * reply. Throws if the reply is empty or not valid JSON.
 */
export async function chatJSON<T = unknown>(opts: ChatJSONOpts): Promise<T> {
  const { client, model } = resolveClientAndModel(opts.task);
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
  });
  logUsage(opts.label, model, completion.usage);
  const raw = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw) as T;
}

/**
 * Calls the chat API for plain-text output (no JSON constraint). Returns
 * the trimmed message content.
 */
export async function chatText(opts: ChatTextOpts): Promise<string> {
  const { client, model } = resolveClientAndModel(opts.task);
  const completion = await client.chat.completions.create({
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
  });
  logUsage(opts.label, model, completion.usage);
  return completion.choices[0]?.message?.content?.trim() ?? "";
}
