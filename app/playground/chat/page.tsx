"use client";

import { useState } from "react";

type Status =
  | { stage: "idle" }
  | { stage: "loading" }
  | { stage: "ok"; sent: string; response: string; ms: number }
  | { stage: "error"; message: string };

export default function ChatPlayground() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>({ stage: "idle" });

  async function send() {
    const m = message.trim();
    if (!m || status.stage === "loading") return;
    setStatus({ stage: "loading" });
    const start = performance.now();
    try {
      const res = await fetch("/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: m }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { response: string };
      const ms = Math.round(performance.now() - start);
      setStatus({ stage: "ok", sent: m, response: data.response, ms });
    } catch (err) {
      setStatus({ stage: "error", message: (err as Error).message });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">GPT-4o-mini Sandbox</h1>
          <p className="text-sm text-neutral-500">
            Single-shot. Every message is a fresh context — the model has no memory of previous turns.
            Enter sends, Shift+Enter inserts a newline.
          </p>
        </header>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type something and press Enter…"
          rows={4}
          disabled={status.stage === "loading"}
          className="w-full text-base text-neutral-900 bg-white border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-600 disabled:opacity-50 resize-y"
        />

        {status.stage === "loading" && (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
            <span>Thinking…</span>
          </div>
        )}

        {status.stage === "error" && (
          <p className="text-sm text-red-500">{status.message}</p>
        )}

        {status.stage === "ok" && (
          <div className="space-y-3">
            <div className="text-xs text-neutral-400">{status.ms}ms · gpt-4o-mini</div>
            <div className="rounded-2xl bg-neutral-100 px-4 py-3 text-base leading-relaxed text-neutral-900 whitespace-pre-wrap">
              {status.response}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
