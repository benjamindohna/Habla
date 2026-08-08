"use client";

// Model bench — run the full chat-turn pipeline (interpret → localize →
// segment → AI reply) against multiple candidate models side by side.
// One POST per model, fired in parallel; each card fills in as its
// pipeline finishes. "Production" is the current task→model mix and
// serves as the baseline column.

import { useEffect, useState } from "react";
import type { Pair } from "@/types/correction";

interface BenchModelInfo {
  id: string;
  label: string;
  provider: string;
  priceLabel: string;
  available: boolean;
  keyEnv: string;
}

interface StepResult {
  key: string;
  label: string;
  ms: number;
  ok: boolean;
  output?: unknown;
  error?: string;
}

interface BenchResult {
  modelId: string;
  totalMs: number;
  localVersion: string | null;
  pairs: Pair[] | null;
  steps: StepResult[];
}

type CardState =
  | { kind: "running" }
  | { kind: "done"; result: BenchResult }
  | { kind: "error"; message: string };

const PRODUCTION_ENTRY: BenchModelInfo = {
  id: "production",
  label: "Production (aktueller Mix)",
  provider: "baseline",
  priceLabel: "mini + 4o",
  available: true,
  keyEnv: "OPENAI_API_KEY",
};

const DEFAULT_TRANSCRIPT =
  "Ayer fui al Schwimmbad con mi hermana y nosotros haben mucho nadado, aber el agua war demasiado frío.";

const PROVIDER_COLORS: Record<string, string> = {
  baseline: "bg-neutral-200 text-neutral-700",
  openai: "bg-emerald-100 text-emerald-800",
  anthropic: "bg-orange-100 text-orange-800",
  google: "bg-blue-100 text-blue-800",
  xai: "bg-purple-100 text-purple-800",
};

function PairsPreview({ pairs }: { pairs: Pair[] }) {
  return (
    <p className="leading-7">
      {pairs.map((p, i) => (
        <span
          key={i}
          className={
            "inline-block rounded px-1 mr-1 mb-1 text-xs " +
            (p.is_match
              ? "bg-neutral-100 text-neutral-700"
              : "bg-emerald-50 text-emerald-800 border border-emerald-200")
          }
          title={p.is_match ? "Match" : `Du: "${p.user_segment}"`}
        >
          {p.local_segment || <span className="text-red-400 line-through">{p.user_segment}</span>}
        </span>
      ))}
    </p>
  );
}

function msColor(ms: number): string {
  if (ms < 1500) return "text-emerald-600";
  if (ms < 4000) return "text-amber-600";
  return "text-red-600";
}

export default function ModelBenchPage() {
  const [models, setModels] = useState<BenchModelInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["production", "claude-haiku-4-5", "gemini-2.5-flash"]),
  );
  const [transcript, setTranscript] = useState(DEFAULT_TRANSCRIPT);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/playground/model-bench")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { models: BenchModelInfo[] }) => setModels([PRODUCTION_ENTRY, ...data.models]))
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    if (running || !transcript.trim() || selected.size === 0) return;
    setRunning(true);
    const ids = [...selected];
    setCards(Object.fromEntries(ids.map((id) => [id, { kind: "running" } as CardState])));

    await Promise.all(
      ids.map(async (modelId) => {
        try {
          const res = await fetch("/api/playground/model-bench", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: transcript.trim(), modelId }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error || `HTTP ${res.status}`);
          }
          const result = (await res.json()) as BenchResult;
          setCards((prev) => ({ ...prev, [modelId]: { kind: "done", result } }));
        } catch (err) {
          setCards((prev) => ({
            ...prev,
            [modelId]: { kind: "error", message: (err as Error).message },
          }));
        }
      }),
    );
    setRunning(false);
  }

  const orderedCardIds = models
    ? models.map((m) => m.id).filter((id) => id in cards)
    : Object.keys(cards);

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">Model Bench</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ein Wettrennen, kein Setup: <strong>Jedes angehakte Modell fährt denselben kompletten
          Chat-Turn einmal allein durch</strong> (Intent → Korrektur → Segment → AI-Antwort) — alle
          parallel, unabhängig voneinander. Pro Modell erscheint eine Ergebnis-Karte; „Production"
          ist dein aktuelles mini/4o-Setup als Vergleichsmaßstab.
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          Tipp: Baseline + 2–3 Kandidaten reichen — jedes Modell kostet 4 LLM-Calls pro Lauf.
          Preise: $/1M Tokens (Input/Output).
        </p>

        {/* Transcript input */}
        <div className="mt-6">
          <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1">
            Transcript (so wie es aus Whisper käme — Mixing erlaubt)
          </label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm focus:outline-none focus:border-neutral-400"
          />
        </div>

        {/* Model picker */}
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2">
            Kandidaten — jeder läuft die komplette Pipeline einmal selbst
          </p>
          {loadError && <p className="text-sm text-red-500">{loadError}</p>}
          {!models && !loadError && <p className="text-sm text-neutral-400">Lade Modelle…</p>}
          {models && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {models.map((m) => (
                <label
                  key={m.id}
                  className={
                    "flex items-center gap-3 rounded-lg border bg-white px-3 py-2 cursor-pointer transition-colors " +
                    (selected.has(m.id) ? "border-neutral-800" : "border-neutral-200 hover:border-neutral-400") +
                    (m.available ? "" : " opacity-50 cursor-not-allowed")
                  }
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    disabled={!m.available || running}
                    onChange={() => toggle(m.id)}
                    className="accent-neutral-800"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-neutral-800 truncate">{m.label}</span>
                    <span className="block text-[11px] text-neutral-400">
                      {m.priceLabel}
                      {!m.available && ` — ${m.keyEnv} fehlt in .env.local`}
                    </span>
                  </span>
                  <span
                    className={
                      "text-[10px] px-1.5 py-0.5 rounded-full shrink-0 " +
                      (PROVIDER_COLORS[m.provider] ?? "bg-neutral-100 text-neutral-600")
                    }
                  >
                    {m.provider}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={run}
          disabled={running || selected.size === 0 || !transcript.trim()}
          className="mt-4 px-5 py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Läuft…" : `Bench starten (${selected.size} Modelle)`}
        </button>

        {/* Results */}
        {orderedCardIds.length > 0 && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {orderedCardIds.map((id) => {
              const info = models?.find((m) => m.id === id);
              const state = cards[id];
              return (
                <div key={id} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-neutral-800 truncate">
                      {info?.label ?? id}
                    </h2>
                    {state.kind === "done" && (
                      <span className={"text-sm font-mono shrink-0 " + msColor(state.result.totalMs)}>
                        {(state.result.totalMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>

                  {state.kind === "running" && (
                    <div className="mt-4 flex items-center gap-2 text-xs text-neutral-400">
                      <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
                      Pipeline läuft…
                    </div>
                  )}

                  {state.kind === "error" && (
                    <p className="mt-3 text-xs text-red-500">{state.message}</p>
                  )}

                  {state.kind === "done" && (
                    <div className="mt-3 space-y-3">
                      {state.result.steps.map((step) => (
                        <div key={step.key} className="border-t border-neutral-100 pt-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-wider text-neutral-400">
                              {step.label}
                            </span>
                            <span className={"text-xs font-mono " + msColor(step.ms)}>
                              {step.ms} ms
                            </span>
                          </div>
                          {!step.ok && (
                            <p className="mt-1 text-xs text-red-500">{step.error}</p>
                          )}
                          {step.ok && step.key === "interpret" && (
                            <p className="mt-1 text-xs text-neutral-600 italic">
                              {String(step.output ?? "")}
                            </p>
                          )}
                          {step.ok && step.key === "localize" && (
                            <p className="mt-1 text-sm text-neutral-800">
                              {String(step.output ?? "")}
                            </p>
                          )}
                          {step.ok && step.key === "segment" && Array.isArray(step.output) && (
                            <div className="mt-1">
                              <PairsPreview pairs={step.output as Pair[]} />
                            </div>
                          )}
                          {step.ok && step.key === "reply" && (
                            <p className="mt-1 text-sm text-neutral-800">
                              {String(step.output ?? "")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
