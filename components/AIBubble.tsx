"use client";

interface AIBubbleProps {
  text?: string;
  /** Optional muted styling — used for placeholder messages (e.g. Phase 6 stub). */
  muted?: boolean;
  /** Show three-dot pulse instead of text — used while the opener loads. */
  loading?: boolean;
}

// Phase 7 will extend this with tappable Spanish segments + native popovers.
// For now it just renders the AI's Spanish text in a left-aligned bubble.
export default function AIBubble({ text, muted = false, loading = false }: AIBubbleProps) {
  return (
    <div className="flex justify-start">
      <div
        className={
          muted
            ? "max-w-[80%] rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm italic text-neutral-400"
            : "max-w-[80%] rounded-2xl bg-neutral-100 px-4 py-3 text-base leading-relaxed text-neutral-900"
        }
      >
        {loading ? <PulsingDots /> : text}
      </div>
    </div>
  );
}

function PulsingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Loading">
      <span className="block w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="block w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="block w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}
