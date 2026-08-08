// Client-side SSE-over-fetch helpers. Browser-safe (no server deps) —
// used by ConversationView and the Frei tab to consume the streaming
// correction / reply routes.
//
// Wire format (see /api/correct/stream): `data: {json}\n\n` frames, each
// frame a JSON object with a `type` discriminator.

import type { CorrectionResult } from "@/types/correction";

/** Reads a fetch Response body as SSE frames and invokes onEvent per
 *  parsed JSON object. Resolves when the stream closes. */
export async function readSseStream(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) throw new Error("Response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
      } catch {
        // Malformed frame — skip; the terminal result/error frame decides
        // overall success.
      }
    }
  }
}

export interface CorrectStreamCallbacks {
  onInterpretation?: (text: string) => void;
  onLocalizeDelta?: (delta: string) => void;
  onLocalized?: (text: string) => void;
}

/** Streaming correction call. Progressive callbacks fire as server events
 *  arrive; resolves with the final CorrectionResult. */
export async function correctTranscriptStream(
  args: {
    transcript: string;
    overrideIntendedMeaning?: string;
    nativeLanguage: string;
    style: "natural" | "transcript_aware";
  },
  callbacks: CorrectStreamCallbacks = {},
): Promise<CorrectionResult> {
  const res = await fetch("/api/correct/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error("Correction failed");

  let result: CorrectionResult | null = null;
  let errorMessage: string | null = null;
  await readSseStream(res, (event) => {
    switch (event.type) {
      case "interpretation":
        callbacks.onInterpretation?.(event.interpretation as string);
        break;
      case "localize_delta":
        callbacks.onLocalizeDelta?.(event.delta as string);
        break;
      case "localized":
        callbacks.onLocalized?.(event.text as string);
        break;
      case "result":
        result = event.result as CorrectionResult;
        break;
      case "error":
        errorMessage = (event.message as string) || "Correction failed";
        break;
    }
  });
  if (errorMessage) throw new Error(errorMessage);
  if (!result) throw new Error("Stream ended without a result");
  return result;
}

/** Streaming AI-reply call (converse/start + converse/turn with
 *  stream: true). Resolves with the full reply text (+ derivedTopic when
 *  the server labeled the conversation on this turn). */
export async function readReplyStream(
  res: Response,
  onDelta: (delta: string) => void,
): Promise<{ text: string; derivedTopic?: string }> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let text = "";
  let derivedTopic: string | undefined;
  let errorMessage: string | null = null;
  await readSseStream(res, (event) => {
    switch (event.type) {
      case "delta":
        text += event.delta as string;
        onDelta(event.delta as string);
        break;
      case "done":
        text = (event.text as string) ?? text;
        if (typeof event.derivedTopic === "string") derivedTopic = event.derivedTopic;
        break;
      case "error":
        errorMessage = (event.message as string) || "Reply failed";
        break;
    }
  });
  if (errorMessage) throw new Error(errorMessage);
  if (!text.trim()) throw new Error("Stream ended without a reply");
  return { text: text.trim(), derivedTopic };
}
