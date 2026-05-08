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
  /** Speech-to-text. */
  transcription: "gpt-4o-transcribe",
  /** Text-to-speech. */
  tts: "gpt-4o-mini-tts",
} as const;

export type ChatTask = "chat_light" | "chat_precise";

let _client: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
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

function logUsage(label: string, model: string, usage: Usage | undefined): void {
  if (!usage) return;
  console.log(
    `[llm] ${label} model=${model} prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
  );
}

/**
 * Calls the chat API with `response_format: json_object` and parses the
 * reply. Throws if the reply is empty or not valid JSON.
 */
export async function chatJSON<T = unknown>(opts: ChatJSONOpts): Promise<T> {
  const model = TASK_MODELS[opts.task];
  const completion = await getOpenAI().chat.completions.create({
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
  const model = TASK_MODELS[opts.task];
  const completion = await getOpenAI().chat.completions.create({
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
  });
  logUsage(opts.label, model, completion.usage);
  return completion.choices[0]?.message?.content?.trim() ?? "";
}
