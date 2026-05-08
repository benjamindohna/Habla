"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "@/types/segment";

/**
 * Defensive whitespace insertion. The LLM is supposed to emit non-tappable
 * whitespace segments between tappable ones, but it sometimes forgets and
 * delivers segments back-to-back with no spacing — which renders as one
 * compressed blob. We compensate by inserting an inert space wherever the
 * boundary between two segments needs one and doesn't have one.
 *
 * Rules at a segment boundary:
 *  - If either side already has whitespace → no insertion.
 *  - If previous ends with a "glue-after" char (¿ ¡ « " ' ( [ {) → no insertion.
 *  - If current starts with a "glue-before" char (, . ; : ! ? » " ' ) ] }) → no insertion.
 *  - Otherwise → insert a single space.
 */
function withInferredSpaces(segments: Segment[]): Segment[] {
  const GLUE_AFTER_PREV = /[¿¡«"'([{]/;
  const GLUE_BEFORE_CURR = /[,.;:!?»"')\]}]/;
  const out: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const curr = segments[i];
    if (!curr.es) continue;
    const prev = out[out.length - 1];
    if (prev && prev.es && curr.es) {
      const lastChar = prev.es.slice(-1);
      const firstChar = curr.es[0];
      const hasSpace = /\s/.test(lastChar) || /\s/.test(firstChar);
      const glued = GLUE_AFTER_PREV.test(lastChar) || GLUE_BEFORE_CURR.test(firstChar);
      if (!hasSpace && !glued) {
        out.push({ es: " " });
      }
    }
    out.push(curr);
  }
  return out;
}

interface AIBubbleProps {
  text?: string;
  segments?: Segment[] | null;
  /** Optional muted styling — used for placeholder/error messages. */
  muted?: boolean;
  /** Show three-dot pulse instead of text — used while the message loads. */
  loading?: boolean;
}

export default function AIBubble({ text, segments, muted = false, loading = false }: AIBubbleProps) {
  // Index of the segment whose translation popover is currently open. null = none.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Indexes of segments whose translation has been viewed at least once
  // (persistent subtle marker so the user knows what they've already looked up).
  const [lookedUp, setLookedUp] = useState<Set<number>>(new Set());

  const bubbleRef = useRef<HTMLDivElement>(null);

  const renderedSegments = useMemo(
    () => (segments && segments.length > 0 ? withInferredSpaces(segments) : null),
    [segments],
  );

  // Click-outside closes the open popover.
  useEffect(() => {
    if (openIndex === null) return;
    function onDown(e: MouseEvent) {
      if (!bubbleRef.current?.contains(e.target as Node)) setOpenIndex(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openIndex]);

  function handleSegmentTap(index: number, seg: Segment) {
    if (!seg.native) return;
    // Toggle if it's already open.
    if (openIndex === index) {
      setOpenIndex(null);
      return;
    }
    setOpenIndex(index);
    // First-time tap → fire-and-forget save to user_unknown_words.
    if (!lookedUp.has(index)) {
      setLookedUp((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
      fetch("/api/me/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: seg.es, native: seg.native }),
      }).catch(() => {
        // Silent — failing here just means the word isn't saved this time.
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const baseClasses = muted
    ? "max-w-[80%] rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm italic text-neutral-400"
    : "max-w-[80%] rounded-2xl bg-neutral-100 px-4 py-3 text-base leading-relaxed text-neutral-900";

  return (
    <div className="flex justify-start">
      <div ref={bubbleRef} className={`${baseClasses} relative`}>
        {loading ? (
          <PulsingDots />
        ) : renderedSegments ? (
          <span className="whitespace-pre-wrap">
            {renderedSegments.map((seg, i) =>
              seg.native ? (
                <TappableSpan
                  key={i}
                  text={seg.es}
                  native={seg.native}
                  open={openIndex === i}
                  lookedUp={lookedUp.has(i)}
                  onTap={() => handleSegmentTap(i, seg)}
                />
              ) : (
                <span key={i}>{seg.es}</span>
              ),
            )}
          </span>
        ) : (
          // Fallback for messages without segments (legacy or stub).
          <span className="whitespace-pre-wrap">{text}</span>
        )}
      </div>
    </div>
  );
}

interface TappableSpanProps {
  text: string;
  native: string;
  open: boolean;
  lookedUp: boolean;
  onTap: () => void;
}

function TappableSpan({ text, native, open, lookedUp, onTap }: TappableSpanProps) {
  return (
    <span className="relative inline-block">
      <button
        onClick={onTap}
        className={
          "cursor-pointer rounded transition-colors px-0.5 -mx-0.5 " +
          (open
            ? "bg-amber-100 text-neutral-900"
            : lookedUp
            ? "underline decoration-dotted decoration-neutral-300 underline-offset-[3px] hover:bg-neutral-200"
            : "hover:bg-neutral-200")
        }
      >
        {text}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-10 whitespace-nowrap rounded-lg bg-neutral-900 text-white text-xs px-3 py-1.5 shadow-md"
        >
          {native}
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 top-full -mt-px w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-neutral-900"
          />
        </span>
      )}
    </span>
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
