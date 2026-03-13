"use client";

import { useState, useEffect, Fragment } from "react";
import type { CorrectionResult, Pair } from "@/types/correction";

interface CorrectionBlockProps {
  result: CorrectionResult;
  nativeLanguage: string;
}

export default function CorrectionBlock({ result, nativeLanguage }: CorrectionBlockProps) {
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<Record<number, string>>({});

  // Clear everything when a new result arrives (new recording)
  useEffect(() => {
    setCache({});
    setSelectedIndex(null);
    setSelectedPair(null);
    setExplanation(null);
  }, [result]);

  async function handlePairClick(pair: Pair, index: number) {
    if (pair.is_match) return;

    // Toggle off if already selected
    if (selectedIndex === index) {
      setSelectedIndex(null);
      setSelectedPair(null);
      setExplanation(null);
      return;
    }

    setSelectedIndex(index);
    setSelectedPair(pair);

    // Serve from cache if already fetched
    if (cache[index] !== undefined) {
      setExplanation(cache[index]);
      return;
    }

    setExplanation(null);
    setLoading(true);

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localVersionEs: result.local_version_es,
          localSegment: pair.local_segment,
          userSegment: pair.user_segment,
          nativeLanguage,
        }),
      });
      const data = await res.json();
      const text = data.explanation ?? "Could not load explanation.";
      setCache(prev => ({ ...prev, [index]: text }));
      setExplanation(text);
    } catch {
      setExplanation("Could not load explanation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full space-y-3">
      {/* Segment display */}
      <div className="w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div
          className="text-lg leading-[3rem] text-neutral-900"
          aria-label="Corrected sentence"
        >
          {result.pairs.map((pair, i) => (
            <Fragment key={i}>
              <PairChip
                pair={pair}
                isSelected={selectedIndex === i}
                onClick={() => handlePairClick(pair, i)}
              />
              {" "}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Explanation panel */}
      {(loading || explanation || selectedPair) && (
        <div className="w-full rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">

          {/* Context header */}
          {selectedPair && (
            <div className="flex items-stretch text-xs border-b border-neutral-100">
              <div className="flex-1 px-4 py-2.5 bg-rose-50">
                <p className="text-rose-400 font-medium mb-0.5">I said</p>
                <p className="text-rose-600 font-mono">
                  {selectedPair.user_segment.trim() || "—"}
                </p>
              </div>
              <div className="w-px bg-neutral-100" />
              <div className="flex-1 px-4 py-2.5 bg-green-50">
                <p className="text-green-600 font-medium mb-0.5">Correct</p>
                <p className="text-green-800 font-mono">
                  {selectedPair.local_segment.trim()}
                </p>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="px-5 py-4 text-sm text-neutral-700">
            {loading ? (
              <p className="flex items-center gap-2 text-neutral-400">
                <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
                Loading explanation…
              </p>
            ) : explanation ? (
              <FormattedText text={explanation} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lightweight markdown renderer: **bold** and line breaks ────────────────

function FormattedText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {text.split(/\n+/).map((paragraph, i) => (
        <p key={i} className="leading-relaxed">
          {parseBold(paragraph)}
        </p>
      ))}
    </div>
  );
}

function parseBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold text-neutral-900">{part}</strong> : part
  );
}

// ── Pair chip ──────────────────────────────────────────────────────────────

interface PairChipProps {
  pair: Pair;
  isSelected: boolean;
  onClick: () => void;
}

function PairChip({ pair, isSelected, onClick }: PairChipProps) {
  const local = pair.local_segment.trim();
  const user = pair.user_segment.trim();

  if (pair.is_match) {
    return <span>{local}</span>;
  }

  return (
    <span
      className={`inline-block relative mx-0.5 cursor-pointer rounded transition-colors ${
        isSelected ? "outline outline-2 outline-offset-2 outline-green-400" : ""
      }`}
      style={{ lineHeight: 0 }}
      onClick={onClick}
      title="Tap for an explanation"
    >
      {/* What the learner said — floats above the green chip */}
      <span
        className="absolute left-0 w-full text-center text-[0.65rem] leading-none text-rose-400 whitespace-nowrap"
        style={{ bottom: "calc(100% + 4px)" }}
        aria-label={`learner said: ${user}`}
      >
        {user}
      </span>
      {/* Local Spanish — primary text with green highlight */}
      <span
        className={`inline-block rounded px-1.5 pt-[2px] pb-[4px] leading-none transition-colors ${
          isSelected
            ? "bg-green-200 text-green-900"
            : "bg-green-100 text-green-800 hover:bg-green-200"
        }`}
      >
        {local}
      </span>
    </span>
  );
}
