"use client";

import { useEffect, useState } from "react";

type SaveResult =
  | { action: "inserted"; rowId: number; description: string }
  | { action: "merged"; matchedRowId: number; matchedDescription: string }
  | {
      action: "polysemy_inserted";
      rowId: number;
      description: string;
      siblingRowIds: number[];
    };

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
}

type SaveStatus =
  | { stage: "idle" }
  | { stage: "saving" }
  | { stage: "ok"; result: SaveResult; ms: number }
  | { stage: "error"; message: string };

export default function SaveTestPage() {
  const [segment, setSegment] = useState("");
  const [context, setContext] = useState("");
  const [save, setSave] = useState<SaveStatus>({ stage: "idle" });
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsError, setRowsError] = useState<string | null>(null);

  async function refreshRows() {
    setRowsError(null);
    try {
      const res = await fetch("/api/me/vocab");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: Row[] };
      setRows(data.rows);
    } catch (err) {
      setRowsError((err as Error).message);
    }
  }

  useEffect(() => {
    refreshRows();
  }, []);

  async function handleSave() {
    const seg = segment.trim();
    const ctx = context.trim();
    if (!seg || !ctx || save.stage === "saving") return;
    setSave({ stage: "saving" });
    const start = performance.now();
    try {
      const res = await fetch("/api/me/vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segment: seg, context: ctx }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const result = (await res.json()) as SaveResult;
      const ms = Math.round(performance.now() - start);
      setSave({ stage: "ok", result, ms });
      refreshRows();
    } catch (err) {
      setSave({ stage: "error", message: (err as Error).message });
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`/api/me/vocab?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      refreshRows();
    } catch (err) {
      setRowsError((err as Error).message);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-8">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Vocab Save Playground</h1>
          <p className="text-sm text-neutral-500">
            Test the production save flow without the chat. Enter a target-language segment + the
            sentence it appeared in. The server runs description generation, lowercase lookup, and
            comparator (if collision) — same path the AIBubble will use in Phase B.
          </p>
        </header>

        <div className="space-y-3 border border-neutral-200 rounded-lg p-4 bg-white">
          <h2 className="text-sm font-medium text-neutral-700">Save</h2>
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wide text-neutral-400">
              Segment (target language)
            </label>
            <input
              type="text"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              placeholder='z.B. "banco" oder "te haya impresionado"'
              className="w-full text-base text-neutral-900 bg-white border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-600"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wide text-neutral-400">
              Context sentence
            </label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Der Satz, in dem das Wort vorkam"
              rows={2}
              className="w-full text-sm text-neutral-900 bg-white border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-600 resize-y"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={save.stage === "saving" || !segment.trim() || !context.trim()}
            className="px-4 py-1.5 text-sm rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {save.stage === "saving" ? "Saving…" : "Save"}
          </button>

          {save.stage === "ok" && (
            <div className="space-y-2 mt-2">
              <p className="text-xs text-neutral-400">{save.ms}ms</p>
              <ResultBadge result={save.result} />
              <pre className="text-xs text-neutral-500 bg-neutral-50 border border-neutral-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(save.result, null, 2)}
              </pre>
            </div>
          )}

          {save.stage === "error" && (
            <p className="text-sm text-red-500 mt-2">{save.message}</p>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-700">
              Stored rows ({rows.length})
            </h2>
            <button
              onClick={refreshRows}
              className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              Refresh
            </button>
          </div>
          {rowsError && <p className="text-xs text-red-500">{rowsError}</p>}
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-400">No rows yet. Save something above.</p>
          ) : (
            <ul className="divide-y divide-neutral-200 border border-neutral-200 rounded-lg bg-white">
              {rows.map((r) => (
                <li key={r.id} className="px-3 py-2 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-medium text-neutral-900">
                        {r.target_word_original}
                      </span>
                      <span className="text-xs text-neutral-400">
                        ({r.target_word_lower}) · stage {r.stage}
                      </span>
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
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function ResultBadge({ result }: { result: SaveResult }) {
  if (result.action === "inserted") {
    return (
      <p className="text-sm">
        <span className="inline-block bg-emerald-100 text-emerald-800 rounded px-2 py-0.5 text-xs uppercase tracking-wide">
          inserted
        </span>{" "}
        new row #{result.rowId} · description: <em>{result.description}</em>
      </p>
    );
  }
  if (result.action === "merged") {
    return (
      <p className="text-sm">
        <span className="inline-block bg-amber-100 text-amber-800 rounded px-2 py-0.5 text-xs uppercase tracking-wide">
          merged
        </span>{" "}
        synonym of row #{result.matchedRowId} (
        <em>{result.matchedDescription}</em>) — not saved, soft-lapsed
      </p>
    );
  }
  return (
    <p className="text-sm">
      <span className="inline-block bg-blue-100 text-blue-800 rounded px-2 py-0.5 text-xs uppercase tracking-wide">
        polysemy
      </span>{" "}
      new row #{result.rowId} · description: <em>{result.description}</em> · siblings:{" "}
      {result.siblingRowIds.join(", ")}
    </p>
  );
}
