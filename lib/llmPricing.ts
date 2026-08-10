// USD cost estimation for an LLM/audio API call given the model and the
// usage counts we have. Used by lib/llm.ts to compute cost_usd at the
// time of writing each row into llm_usage.
//
// Prices are deliberately approximate — directional accuracy is enough
// for usage tracking. Sources are OpenAI's posted pricing as of 2026-06;
// xAI is an estimate. Update PRICES below when models change.
//
// Returned cost is a string with fixed precision (avoids float drift in
// aggregates); callers can SUM it via NUMERIC cast in SQL.

interface ChatPricing {
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
}

/** Estimated USD per minute of audio (for transcription input or TTS output). */
interface AudioPricing {
  perMinute: number;
}

// Approximate bitrate of OpenAI TTS MP3 output. Used to convert
// output_bytes → estimated audio minutes. ~32 kbps is what gpt-4o-mini-tts
// produces in our measurements (varies ±20% with content).
const TTS_BITRATE_KBPS = 32;

// Approximate bitrate of recorded user audio sent to transcription
// (browser MediaRecorder defaults: opus in webm container, ~24-48 kbps).
const TRANSCRIBE_BITRATE_KBPS = 32;

const CHAT_PRICES: Record<string, ChatPricing> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "grok-4-fast-non-reasoning": { inputPer1M: 0.2, outputPer1M: 0.5 },
  "gemini-3.1-flash-lite": { inputPer1M: 0.25, outputPer1M: 1.5 },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  // Anthropic (verified against official pricing 2026-08): Sonnet 4.6
  // authors the reading-mode stories, Haiku is a bench candidate.
  "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-haiku-4-5": { inputPer1M: 1.0, outputPer1M: 5.0 },
  // Bench-only OpenAI models — priced so playground runs don't create
  // null-cost rows in llm_usage.
  "gpt-4.1": { inputPer1M: 2.0, outputPer1M: 8.0 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.0 },
};

const AUDIO_PRICES: Record<string, AudioPricing> = {
  "gpt-4o-transcribe": { perMinute: 0.006 },
  "gpt-4o-mini-tts": { perMinute: 0.015 },
};

function bytesToMinutes(bytes: number, bitrateKbps: number): number {
  // bits = bytes * 8; seconds = bits / (kbps * 1000); minutes = seconds / 60
  return (bytes * 8) / (bitrateKbps * 1000 * 60);
}

interface CostArgs {
  model: string;
  kind: "chat" | "transcription" | "tts";
  promptTokens?: number;
  completionTokens?: number;
  inputBytes?: number;
  outputBytes?: number;
}

/**
 * Returns the estimated cost as a string with 6 decimals, or null if
 * the model isn't in our price map. Calling sites should still log the
 * row even on null cost — the counts are useful regardless.
 */
export function estimateCostUsd(args: CostArgs): string | null {
  if (args.kind === "chat") {
    const p = CHAT_PRICES[args.model];
    if (!p) return null;
    const input = (args.promptTokens ?? 0) * (p.inputPer1M / 1_000_000);
    const output = (args.completionTokens ?? 0) * (p.outputPer1M / 1_000_000);
    return (input + output).toFixed(6);
  }
  if (args.kind === "transcription") {
    const p = AUDIO_PRICES[args.model];
    if (!p || !args.inputBytes) return null;
    const minutes = bytesToMinutes(args.inputBytes, TRANSCRIBE_BITRATE_KBPS);
    return (minutes * p.perMinute).toFixed(6);
  }
  if (args.kind === "tts") {
    const p = AUDIO_PRICES[args.model];
    if (!p || !args.outputBytes) return null;
    const minutes = bytesToMinutes(args.outputBytes, TTS_BITRATE_KBPS);
    return (minutes * p.perMinute).toFixed(6);
  }
  return null;
}
