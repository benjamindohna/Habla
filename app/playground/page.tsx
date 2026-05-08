"use client";

import { useState } from "react";
import AIBubble from "@/components/AIBubble";
import type { Segment } from "@/types/segment";

interface PipelineResult {
  text: string;
  native_translation: string;
  segments: Segment[];
}

type Status =
  | { stage: "idle" }
  | { stage: "loading" }
  | { stage: "ok"; result: PipelineResult; topic: string; ms: number }
  | { stage: "error"; message: string };

export default function PlaygroundPage() {
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState<Status>({ stage: "idle" });

  async function run() {
    const t = topic.trim();
    if (!t || status.stage === "loading") return;
    setStatus({ stage: "loading" });
    const start = performance.now();
    try {
      const res = await fetch("/api/playground/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const result = (await res.json()) as PipelineResult;
      const ms = Math.round(performance.now() - start);
      setStatus({ stage: "ok", result, topic: t, ms });
    } catch (err) {
      setStatus({ stage: "error", message: (err as Error).message });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-8">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Segmentation Playground</h1>
          <p className="text-sm text-neutral-500">
            Two-call pipeline test: generate AI opener, then segment + align with full native translation as anchor.
            Tap a word to see its translation; taps do <em>not</em> save to your vocab list here.
          </p>
        </header>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-neutral-400">Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="z.B. Champions League · Stoizismus · Berlin Tech-Szene"
            disabled={status.stage === "loading"}
            className="w-full text-base text-neutral-900 bg-white border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-600 disabled:opacity-50"
          />
          <p className="text-xs text-neutral-400">Press Enter to generate.</p>
        </div>

        {status.stage === "loading" && (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
            <span>Generating + aligning…</span>
          </div>
        )}

        {status.stage === "error" && (
          <p className="text-sm text-red-500">{status.message}</p>
        )}

        {status.stage === "ok" && (
          <div className="space-y-6">
            <div className="text-xs text-neutral-400">
              Topic: <span className="text-neutral-600">{status.topic}</span>
              {" · "}
              {status.result.segments.length} segments · {status.ms}ms
            </div>

            <AIBubble segments={status.result.segments} disableSave />

            <details className="border border-neutral-200 rounded-lg p-3 bg-neutral-50">
              <summary className="text-xs uppercase tracking-wide text-neutral-500 cursor-pointer select-none">
                Full native translation (anchor)
              </summary>
              <p className="mt-2 text-sm text-neutral-700">{status.result.native_translation}</p>
            </details>

            <details className="border border-neutral-200 rounded-lg p-3 bg-neutral-50">
              <summary className="text-xs uppercase tracking-wide text-neutral-500 cursor-pointer select-none">
                Raw JSON
              </summary>
              <pre className="mt-2 text-xs text-neutral-700 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(status.result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </main>
  );
}
