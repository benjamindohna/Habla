"use client";

import { useEffect, useRef, useState } from "react";
import { WORD_REGEX } from "@/lib/aiBubblePipeline";

// ── Tokenisation ─────────────────────────────────────────────────────────

type Token =
  | { kind: "word"; text: string; wordIndex: number }
  | { kind: "spacing"; text: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = new RegExp(WORD_REGEX.source, WORD_REGEX.flags);
  let lastEnd = 0;
  let wordIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastEnd) {
      tokens.push({ kind: "spacing", text: text.slice(lastEnd, m.index) });
    }
    tokens.push({ kind: "word", text: m[0], wordIndex: wordIndex++ });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    tokens.push({ kind: "spacing", text: text.slice(lastEnd) });
  }
  return tokens;
}

// ── Lookup state ─────────────────────────────────────────────────────────

interface LookupResult {
  segment: string;
  translation: string;
  indices: number[];
}

type LookupState =
  | { kind: "loading" }
  | { kind: "done"; result: LookupResult }
  | { kind: "error"; message: string };

// ── Component ────────────────────────────────────────────────────────────

interface AIBubbleProps {
  /** The plain-text AI message. Required when not loading and not muted. */
  text?: string;
  /** Optional muted styling — used for placeholder/error messages. */
  muted?: boolean;
  /** Show three-dot pulse instead of text — used while the message loads. */
  loading?: boolean;
  /** Skip the fire-and-forget /api/me/vocab save on first tap. Used by
   *  the playground so test taps don't pollute the user's vocab list. */
  disableSave?: boolean;
}

export default function AIBubble({
  text,
  muted = false,
  loading = false,
  disableSave = false,
}: AIBubbleProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [lookups, setLookups] = useState<Map<number, LookupState>>(new Map());
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Reset lookup state when the bubble's text changes (new message, edit).
  useEffect(() => {
    setOpenIndex(null);
    setLookups(new Map());
  }, [text]);

  // Click-outside closes the open popover.
  useEffect(() => {
    if (openIndex === null) return;
    function onDown(e: MouseEvent) {
      if (!bubbleRef.current?.contains(e.target as Node)) setOpenIndex(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openIndex]);

  function handleWordTap(token: Extract<Token, { kind: "word" }>) {
    if (!text) return;
    if (openIndex === token.wordIndex) {
      setOpenIndex(null);
      return;
    }
    setOpenIndex(token.wordIndex);
    if (lookups.has(token.wordIndex)) return; // cached

    setLookups((prev) => {
      const next = new Map(prev);
      next.set(token.wordIndex, { kind: "loading" });
      return next;
    });

    // Translate the tapped word in context. Same endpoint the playground
    // uses; production reuses the proven pipeline.
    fetch("/api/playground/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sentence: text,
        word: token.text,
        wordIndex: token.wordIndex,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<LookupResult>;
      })
      .then((result) => {
        // Cache under every covered index so a later tap on a related
        // word in the same segment returns the same answer instantly.
        setLookups((prev) => {
          const next = new Map(prev);
          const state: LookupState = { kind: "done", result };
          for (const idx of result.indices) next.set(idx, state);
          return next;
        });

        // Fire-and-forget save to the user's vocab list. Skipped when
        // disableSave is on (playground). The new save flow handles
        // dedup and polysemy server-side.
        if (!disableSave) {
          fetch("/api/me/vocab", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              segment: result.segment,
              context: text,
            }),
          }).catch(() => {
            // Silent — failed save is non-blocking; user still sees translation.
          });
        }
      })
      .catch((err: Error) => {
        setLookups((prev) => {
          const next = new Map(prev);
          next.set(token.wordIndex, { kind: "error", message: err.message });
          return next;
        });
      });
  }

  // ── Render ────────────────────────────────────────────────────────────

  const baseClasses = muted
    ? "max-w-[80%] rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm italic text-neutral-400"
    : "max-w-[80%] rounded-2xl bg-neutral-100 px-4 py-3 text-base leading-relaxed text-neutral-900";

  const tokens = !loading && text ? tokenize(text) : null;

  return (
    <div className="flex justify-start">
      <div ref={bubbleRef} className={`${baseClasses} relative`}>
        {loading ? (
          <PulsingDots />
        ) : tokens ? (
          <span className="whitespace-pre-wrap">
            {tokens.map((tok, i) =>
              tok.kind === "spacing" ? (
                <span key={i}>{tok.text}</span>
              ) : (
                <WordButton
                  key={i}
                  token={tok}
                  open={openIndex === tok.wordIndex}
                  lookup={lookups.get(tok.wordIndex)}
                  onTap={() => handleWordTap(tok)}
                />
              ),
            )}
          </span>
        ) : (
          <span className="whitespace-pre-wrap">{text}</span>
        )}
      </div>
    </div>
  );
}

// ── Word button + popover ────────────────────────────────────────────────

function WordButton({
  token,
  open,
  lookup,
  onTap,
}: {
  token: Extract<Token, { kind: "word" }>;
  open: boolean;
  lookup: LookupState | undefined;
  onTap: () => void;
}) {
  const looked = lookup?.kind === "done";
  return (
    <span className="relative inline-block">
      <button
        onClick={onTap}
        className={
          "cursor-pointer rounded transition-colors px-0.5 -mx-0.5 " +
          (open
            ? "bg-amber-100 text-neutral-900"
            : looked
            ? "underline decoration-dotted decoration-neutral-300 underline-offset-[3px] hover:bg-neutral-200"
            : "hover:bg-neutral-200")
        }
      >
        {token.text}
      </button>
      {open && <Popover lookup={lookup} tappedWord={token.text} />}
    </span>
  );
}

function Popover({
  lookup,
  tappedWord,
}: {
  lookup: LookupState | undefined;
  tappedWord: string;
}) {
  return (
    <span
      role="tooltip"
      className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-10 rounded-lg bg-neutral-900 text-white text-xs px-3 py-2 shadow-md min-w-[140px] max-w-[280px]"
    >
      {!lookup || lookup.kind === "loading" ? (
        <span className="inline-flex items-center gap-2">
          <span className="block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          <span className="text-white/80">Übersetze…</span>
        </span>
      ) : lookup.kind === "error" ? (
        <span className="text-red-300">{lookup.message}</span>
      ) : (
        <ResultBody result={lookup.result} tappedWord={tappedWord} />
      )}
      <span
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 top-full -mt-px w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-neutral-900"
      />
    </span>
  );
}

function ResultBody({ result, tappedWord }: { result: LookupResult; tappedWord: string }) {
  const norm = (s: string) => s.trim().toLowerCase();
  const segmentDiffersFromTap = norm(result.segment) !== norm(tappedWord);
  return (
    <span className="block text-left leading-snug">
      <span className="block whitespace-normal">{result.translation}</span>
      {segmentDiffersFromTap && (
        <span className="block text-[10px] text-white/60 mt-0.5 whitespace-normal">
          {result.segment}
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
