import type { CorrectionResult, Pair } from "@/types/correction";

interface CorrectionBlockProps {
  result: CorrectionResult;
}

export default function CorrectionBlock({ result }: CorrectionBlockProps) {
  return (
    <div className="w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div
        className="text-lg leading-[3rem] text-neutral-900"
        aria-label="Corrected sentence"
      >
        {result.pairs.map((pair, i) => (
          <PairChip key={i} pair={pair} />
        ))}
      </div>
    </div>
  );
}

function PairChip({ pair }: { pair: Pair }) {
  // Matched — already correct, render as plain neutral text
  if (pair.is_match) {
    return <span>{pair.local_segment}</span>;
  }

  // Mismatch — show user_segment above in rose, local_segment in green chip below
  return (
    <span className="inline-block relative mx-0.5" style={{ lineHeight: 0 }}>
      {/* What the learner said — floats above the green chip */}
      <span
        className="absolute left-0 w-full text-center text-[0.65rem] leading-none text-rose-400 whitespace-nowrap"
        style={{ bottom: "calc(100% + 4px)" }}
        aria-label={`learner said: ${pair.user_segment}`}
      >
        {pair.user_segment}
      </span>
      {/* Local Spanish — primary text with green highlight */}
      <span className="inline-block bg-green-100 text-green-800 rounded px-1.5 pt-[2px] pb-[4px] leading-none">
        {pair.local_segment}
      </span>
    </span>
  );
}
