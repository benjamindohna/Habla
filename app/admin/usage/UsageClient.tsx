"use client";

// Single-page admin dashboard for LLM usage. Top-level state is just
// (range, userId); everything re-fetches when either changes. The page
// has one fixed layout — switching users or ranges only changes the
// numbers, never the structure.
//
// Costs are formatted as USD with 2-4 significant decimals depending on
// magnitude. Call counts are plain integers.

import { useEffect, useState } from "react";

type Range = "1h" | "12h" | "24h" | "7d" | "30d" | "all";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "1h", label: "1 h" },
  { value: "12h", label: "12 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "all", label: "Gesamt" },
];

interface FunctionBreakdown {
  label: string;
  calls: number;
  totalCost: string;
  avgCost: string;
}

interface UserSummary {
  id: number;
  email: string;
  calls: number;
  totalCost: string;
}

interface UsageResponse {
  range: Range;
  userIdFilter: number | null;
  totalCalls: number;
  totalCost: string;
  byFunction: FunctionBreakdown[];
  users: UserSummary[];
}

function formatUsd(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function formatCalls(n: number): string {
  return n.toLocaleString("de-DE");
}

export function UsageClient() {
  const [range, setRange] = useState<Range>("24h");
  const [userIdFilter, setUserIdFilter] = useState<number | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ range });
    if (userIdFilter !== null) params.set("userId", String(userIdFilter));
    fetch(`/api/admin/usage?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as UsageResponse;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, userIdFilter]);

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <h1 className="text-sm font-medium text-neutral-700">Admin · Usage</h1>
          {loading && (
            <span className="text-xs text-neutral-400">lädt…</span>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Range filter */}
        <section className="flex flex-wrap gap-1.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                range === opt.value
                  ? "bg-neutral-900 text-white"
                  : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </section>

        {/* User selector */}
        <section className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <button
            onClick={() => setUserIdFilter(null)}
            className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
              userIdFilter === null
                ? "bg-neutral-100"
                : "hover:bg-neutral-50"
            }`}
          >
            <span className="flex items-center gap-3">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  userIdFilter === null ? "bg-neutral-900" : "bg-neutral-300"
                }`}
              />
              <span className="text-sm font-medium text-neutral-800">
                Alle User
              </span>
            </span>
            {data && (
              <span className="text-xs text-neutral-500 tabular-nums">
                {formatUsd(data.totalCost)}
                <span className="ml-2 text-neutral-400">
                  · {formatCalls(data.totalCalls)} Calls
                </span>
              </span>
            )}
          </button>
          <div className="border-t border-neutral-100">
            {data?.users.length === 0 && (
              <p className="px-4 py-3 text-xs text-neutral-400">
                Keine User-Aktivität im gewählten Zeitraum.
              </p>
            )}
            {data?.users.map((u) => (
              <button
                key={u.id}
                onClick={() => setUserIdFilter(u.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors border-t border-neutral-100 ${
                  userIdFilter === u.id
                    ? "bg-neutral-100"
                    : "hover:bg-neutral-50"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      userIdFilter === u.id ? "bg-neutral-900" : "bg-neutral-300"
                    }`}
                  />
                  <span className="text-sm text-neutral-700">{u.email}</span>
                  <span className="text-xs text-neutral-400">#{u.id}</span>
                </span>
                <span className="text-xs text-neutral-500 tabular-nums">
                  {formatUsd(u.totalCost)}
                  <span className="ml-2 text-neutral-400">
                    · {formatCalls(u.calls)} Calls
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Totals headline */}
        <section className="bg-white rounded-2xl border border-neutral-200 px-5 py-5 flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-neutral-400">
              {userIdFilter === null ? "Alle User" : data?.users.find((u) => u.id === userIdFilter)?.email ?? `#${userIdFilter}`}
              {" · "}
              {RANGE_OPTIONS.find((r) => r.value === range)?.label}
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900">
              {data ? formatUsd(data.totalCost) : "—"}
            </p>
          </div>
          <p className="text-sm text-neutral-500 tabular-nums">
            {data ? formatCalls(data.totalCalls) : "—"}
            <span className="ml-1 text-neutral-400">Calls</span>
          </p>
        </section>

        {/* Function breakdown table */}
        <section className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_90px_90px] px-4 py-2.5 border-b border-neutral-100 text-xs uppercase tracking-wider text-neutral-400">
            <span>Function / Call</span>
            <span className="text-right">Calls</span>
            <span className="text-right">Total</span>
            <span className="text-right">Avg</span>
          </div>
          {data?.byFunction.length === 0 && (
            <p className="px-4 py-4 text-sm text-neutral-400">
              Keine Calls im gewählten Zeitraum.
            </p>
          )}
          {data?.byFunction.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1fr_70px_90px_90px] px-4 py-2.5 border-t border-neutral-100 first:border-t-0 text-sm tabular-nums"
            >
              <span className="font-mono text-xs text-neutral-700 truncate pr-2">
                {row.label}
              </span>
              <span className="text-right text-neutral-700">{formatCalls(row.calls)}</span>
              <span className="text-right text-neutral-900">{formatUsd(row.totalCost)}</span>
              <span className="text-right text-neutral-500">{formatUsd(row.avgCost)}</span>
            </div>
          ))}
        </section>

        {error && (
          <p className="text-sm text-rose-600">Fehler: {error}</p>
        )}

        <p className="text-xs text-neutral-400 leading-relaxed">
          Kosten sind geschätzt aus Token-Counts × OpenAI/xAI-Listenpreisen (siehe <code className="font-mono">lib/llmPricing.ts</code>).
          Calls ohne User (Background-Jobs, Skripte) sind in "Alle User"-Total enthalten, aber nicht in der User-Liste aufgeführt.
        </p>
      </div>
    </main>
  );
}
