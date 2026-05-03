"use client";

interface AIBubbleProps {
  text: string;
  /** Optional muted styling — used for placeholder messages (e.g. Phase 6 stub). */
  muted?: boolean;
}

// Phase 7 will extend this with tappable Spanish segments + native popovers.
// For now it just renders the AI's Spanish text in a left-aligned bubble.
export default function AIBubble({ text, muted = false }: AIBubbleProps) {
  return (
    <div className="flex justify-start">
      <div
        className={
          muted
            ? "max-w-[80%] rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm italic text-neutral-400"
            : "max-w-[80%] rounded-2xl bg-neutral-100 px-4 py-3 text-base leading-relaxed text-neutral-900"
        }
      >
        {text}
      </div>
    </div>
  );
}
