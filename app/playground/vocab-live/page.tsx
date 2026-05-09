"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Row {
  id: number;
  target_word_original: string;
  target_word_lower: string;
  english_description: string;
  context_sentence: string | null;
  stage: number;
  next_due_at: number | null;
  correct_streak: number;
  lapses: number;
  looked_up: number;
  last_seen: number;
  created_at: number;
  relevance_rank: number;
}

const POLL_MS = 2000;
const HIGHLIGHT_MS = 3500;

export default function VocabLivePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<number>>(new Set());
  const knownIds = useRef<Set<number>>(new Set());
  const initialLoadDone = useRef(false);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch("/api/me/vocab");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: Row[] };
      setLastFetchedAt(Date.now());
      setError(null);

      const seen = knownIds.current;
      const newIds: number[] = [];
      // Only flag as "new" after the first load — otherwise the entire
      // initial set lights up on mount, which is just visual noise.
      if (initialLoadDone.current) {
        for (const r of data.rows) {
          if (!seen.has(r.id)) newIds.push(r.id);
        }
      }
      knownIds.current = new Set(data.rows.map((r) => r.id));
      initialLoadDone.current = true;
      setRows(data.rows);

      if (newIds.length > 0) {
        setRecentlyAdded((prev) => {
          const next = new Set(prev);
          for (const id of newIds) next.add(id);
          return next;
        });
        setTimeout(() => {
          setRecentlyAdded((prev) => {
            const next = new Set(prev);
            for (const id of newIds) next.delete(id);
            return next;
          });
        }, HIGHLIGHT_MS);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Initial fetch on mount.
  useEffect(() => {
    fetchOnce();
  }, [fetchOnce]);

  // Polling.
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(fetchOnce, POLL_MS);
    return () => clearInterval(interval);
  }, [polling, fetchOnce]);

  // Tick the "Xs ago" label.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`/api/me/vocab?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchOnce();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const ago =
    lastFetchedAt === null
      ? "—"
      : `${Math.max(0, Math.floor((Date.now() - lastFetchedAt) / 1000))}s ago`;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Vocab Live</h1>
          <p className="text-sm text-neutral-500">
            Sorted by personalised relevance — most fundamental Spanish words first. Auto-polls
            every {POLL_MS / 1000}s; new rows pulse green for {HIGHLIGHT_MS / 1000}s when they
            land. Ranks shift as new words come in (bulk re-sort up to 15 entries, 3-anchor binary
            insert above).
          </p>
        </header>

        <div className="flex items-center justify-between text-xs text-neutral-500">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2">
              {polling ? (
                <span className="block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              ) : (
                <span className="block w-2 h-2 rounded-full bg-neutral-300" />
              )}
              {polling ? "live" : "paused"}
            </span>
            <span>·</span>
            <span suppressHydrationWarning>last fetched {ago}</span>
            <span className="hidden">{tick /* re-render trigger */}</span>
            <span>·</span>
            <span>{rows.length} rows</span>
          </div>
          <button
            onClick={() => setPolling((p) => !p)}
            className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            {polling ? "pause" : "resume"}
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-500 border border-red-200 bg-red-50 rounded p-2">
            {error}
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-neutral-400 italic">
            No rows yet. Open a chat in another tab and tap a word.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 border border-neutral-200 rounded-lg bg-white">
            {rows.map((r) => {
              const isNew = recentlyAdded.has(r.id);
              return (
                <li
                  key={r.id}
                  className={
                    "px-3 py-2 flex items-start gap-3 transition-colors duration-700 " +
                    (isNew ? "bg-emerald-50" : "bg-white")
                  }
                >
                  <span className="text-xs font-mono text-neutral-400 w-6 text-right tabular-nums shrink-0 pt-1">
                    {r.relevance_rank + 1}.
                  </span>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-base font-medium text-neutral-900">
                        {r.target_word_original}
                      </span>
                      <span className="text-xs text-neutral-400">
                        stage {r.stage} · id {r.id}
                      </span>
                      {isNew && (
                        <span className="text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">
                          new
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600">{r.english_description}</p>
                    {r.context_sentence && (
                      <p className="text-xs text-neutral-400 italic truncate">
                        “{r.context_sentence}”
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="text-xs text-neutral-400 hover:text-red-500 transition-colors shrink-0"
                  >
                    delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
