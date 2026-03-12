"use client";

import { useState } from "react";
import type { CorrectionResult, Pair } from "@/types/correction";

interface CorrectionBlockProps {
  result: CorrectionResult;
  nativeLanguage: string;
}

export default function CorrectionBlock({ result, nativeLanguage }: CorrectionBlockProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePairClick(pair: Pair, index: number) {
    if (pair.is_match) return;

    // Toggle off if already selected
    if (selectedIndex === index) {
      setSelectedIndex(null);
      setExplanation(null);
      return;
    }

    setSelectedIndex(index);
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
      setExplanation(data.explanation ?? "Could not load explanation.");
    } catch {
      setExplanation("Could not load explanation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full space-y-4">
      <div className="w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div
          className="text-lg leading-[3rem] text-neutral-900"
          aria-label="Corrected sentence"
        >
          {result.pairs.map((pair, i) => (
            <PairChip
              key={i}
              pair={pair}
              isSelected={selectedIndex === i}
              onClick={() => handlePairClick(pair, i)}
            />
          ))}
        </div>
      </div>

      {/* Explanation area — shown below the block when a mismatch is tapped */}
      {(loading || explanation) && (
        <div className="w-full rounded-2xl border border-neutral-200 bg-white px-6 py-4 shadow-sm text-sm text-neutral-700">
          {loading ? (
            <p className="flex items-center gap-2 text-neutral-400">
              <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
              Loading explanation…
            </p>
          ) : (
            explanation
          )}
        </div>
      )}
    </div>
  );
}

interface PairChipProps {
  pair: Pair;
  isSelected: boolean;
  onClick: () => void;
}

function PairChip({ pair, isSelected, onClick }: PairChipProps) {
  if (pair.is_match) {
    return <span>{pair.local_segment}</span>;
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
        aria-label={`learner said: ${pair.user_segment}`}
      >
        {pair.user_segment}
      </span>
      {/* Local Spanish — primary text with green highlight */}
      <span
        className={`inline-block rounded px-1.5 pt-[2px] pb-[4px] leading-none transition-colors ${
          isSelected
            ? "bg-green-200 text-green-900"
            : "bg-green-100 text-green-800 hover:bg-green-200"
        }`}
      >
        {pair.local_segment}
      </span>
    </span>
  );
}
