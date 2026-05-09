"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

interface OpenState {
  wordIndex: number;
  word: string;
  rect: DOMRect;
}

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
  const [open, setOpen] = useState<OpenState | null>(null);
  const [lookups, setLookups] = useState<Map<number, LookupState>>(new Map());
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reset on text change.
  useEffect(() => {
    setOpen(null);
    setLookups(new Map());
  }, [text]);

  // Close on outside click. The popover is portaled, so we check both
  // its own ref AND the originating button (we can't easily reach the
  // button without another ref dance — accept that an outside click on
  // the same word that's open will close-then-immediately-reopen via
  // the button onClick; the toggle logic handles that fine).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return;
      // If the click hit a word button (any), let the button handler
      // decide what to do (toggle / switch). Otherwise close.
      const target = e.target as HTMLElement;
      if (target.closest("[data-ai-word]")) return;
      setOpen(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Close on any scroll — capture phase to catch the messages container's
  // scroll, plus window resize since fixed-positioned popover would dangle.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function handleWordTap(token: Extract<Token, { kind: "word" }>, button: HTMLButtonElement) {
    if (!text) return;
    if (open?.wordIndex === token.wordIndex) {
      setOpen(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setOpen({ wordIndex: token.wordIndex, word: token.text, rect });
    if (lookups.has(token.wordIndex)) return;

    setLookups((prev) => {
      const next = new Map(prev);
      next.set(token.wordIndex, { kind: "loading" });
      return next;
    });

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
        setLookups((prev) => {
          const next = new Map(prev);
          const state: LookupState = { kind: "done", result };
          for (const idx of result.indices) next.set(idx, state);
          return next;
        });
        if (!disableSave) {
          fetch("/api/me/vocab", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              segment: result.segment,
              context: text,
              wordIndex: token.wordIndex,
            }),
          }).catch(() => {});
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
      <div className={baseClasses}>
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
                  open={open?.wordIndex === tok.wordIndex}
                  lookup={lookups.get(tok.wordIndex)}
                  onTap={(button) => handleWordTap(tok, button)}
                />
              ),
            )}
          </span>
        ) : (
          <span className="whitespace-pre-wrap">{text}</span>
        )}
      </div>
      {open &&
        createPortal(
          <PortaledPopover
            ref={popoverRef}
            anchor={open.rect}
            tappedWord={open.word}
            lookup={lookups.get(open.wordIndex)}
          />,
          document.body,
        )}
    </div>
  );
}

// ── Word button (no popover — the popover is portaled) ───────────────────

function WordButton({
  token,
  open,
  lookup,
  onTap,
}: {
  token: Extract<Token, { kind: "word" }>;
  open: boolean;
  lookup: LookupState | undefined;
  onTap: (button: HTMLButtonElement) => void;
}) {
  const looked = lookup?.kind === "done";
  return (
    <button
      data-ai-word
      onClick={(e) => onTap(e.currentTarget)}
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
  );
}

// ── Portaled popover ─────────────────────────────────────────────────────

interface PortaledPopoverProps {
  anchor: DOMRect;
  tappedWord: string;
  lookup: LookupState | undefined;
}

const PortaledPopover = forwardRef<HTMLDivElement, PortaledPopoverProps>(
  function PortaledPopover({ anchor, tappedWord, lookup }, ref) {
    const GAP = 8;
    // Anchor the popover ABOVE the word using `bottom`. position: fixed
    // escapes the messages container's overflow-y-auto clipping.
    const style: React.CSSProperties = {
      position: "fixed",
      bottom: window.innerHeight - anchor.top + GAP,
      left: anchor.left + anchor.width / 2,
      transform: "translateX(-50%)",
      zIndex: 50,
    };
    return (
      <div
        ref={ref}
        role="tooltip"
        style={style}
        className="rounded-lg bg-neutral-900 text-white text-xs px-3 py-2 shadow-md min-w-[140px] max-w-[280px]"
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
      </div>
    );
  },
);

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
