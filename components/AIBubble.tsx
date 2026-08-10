"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WORD_REGEX } from "@/lib/wordRegex";

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

/** Mirror of lib/annotate.ts:SentenceAnnotation (client-safe copy — the
 *  lib module transitively pulls server-only deps). */
interface AnnotationSpan {
  id: number;
  indices: number[];
  text: string;
  translation: string | null;
}
interface SentenceAnnotation {
  words: string[];
  spans: AnnotationSpan[];
  tokenToSpan: Record<number, number>;
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
  /** When true, auto-play the TTS once the preload finishes. Set per-bubble
   *  by ConversationView based on (autoRead toggle && this is a fresh
   *  message added during the session). */
  autoPlay?: boolean;
  /** True while the message text is still being streamed in. Suppresses
   *  TTS preload and annotation prefetch until the text is final —
   *  otherwise every token delta would refire both effects. */
  streaming?: boolean;
  /** "chat" (default): bubble styling inside a chat column.
   *  "article": plain full-width paragraph for the reading mode — no
   *  bubble chrome, larger serif-ish reading size. Tap-to-translate,
   *  annotation prefetch, and vocab saves work identically. */
  variant?: "chat" | "article";
  /** Skip the per-bubble TTS preload + speaker button. The reading
   *  page renders one play control for the WHOLE story instead of one
   *  per paragraph. */
  disableTts?: boolean;
}

export default function AIBubble({
  text,
  muted = false,
  loading = false,
  disableSave = false,
  autoPlay = false,
  streaming = false,
  variant = "chat",
  disableTts = false,
}: AIBubbleProps) {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [lookups, setLookups] = useState<Map<number, LookupState>>(new Map());
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── Pre-annotation ────────────────────────────────────────────────────
  // As soon as the final text is on screen, fetch the whole-sentence
  // annotation in the background (server: cache → tiny model). Taps then
  // resolve locally with zero network; a tap racing the fetch awaits the
  // SAME promise — never a second, redundant call. Spans the annotator
  // missed (translation: null) fall back to the live per-word endpoint.
  const annotationRef = useRef<Promise<SentenceAnnotation | null> | null>(null);
  const savedSegmentsRef = useRef<Set<number>>(new Set());
  // Bumped whenever text changes so in-flight tap resolutions from a
  // previous text can detect they're stale and drop their result.
  const generationRef = useRef(0);

  useEffect(() => {
    annotationRef.current = null;
    savedSegmentsRef.current = new Set();
    if (!text || muted || loading || streaming) return;
    annotationRef.current = fetch("/api/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<SentenceAnnotation>) : null))
      .catch(() => null);
  }, [text, muted, loading, streaming]);

  // ── TTS state ─────────────────────────────────────────────────────────
  const [ttsBlob, setTtsBlob] = useState<Blob | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayedRef = useRef(false);

  // Preload TTS as soon as text is available. Auto-play once when the
  // blob lands if autoPlay was true at that moment.
  useEffect(() => {
    if (!text || muted || loading || streaming || disableTts) return;
    autoPlayedRef.current = false;
    setTtsBlob(null);
    setTtsLoading(true);
    let cancelled = false;
    fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speed: 1.0 }),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled) return;
        setTtsLoading(false);
        if (!blob) return;
        setTtsBlob(blob);
        if (autoPlay && !autoPlayedRef.current && !audioRef.current) {
          autoPlayedRef.current = true;
          playBlob(blob);
        }
      })
      .catch(() => {
        if (!cancelled) setTtsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // intentionally NOT depending on autoPlay so that toggling Auto-Read
    // mid-bubble doesn't retroactively play already-arrived messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, muted, loading, streaming]);

  // Cleanup any running audio on unmount.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  function playBlob(blob: Blob) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      audioRef.current = null;
      setIsPlaying(false);
    };
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }

  function toggleTts() {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return;
    }
    if (ttsBlob) playBlob(ttsBlob);
  }

  // Reset on text change.
  useEffect(() => {
    generationRef.current += 1;
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

  function applyLookup(result: LookupResult, tappedIndex: number, spanId: number | null) {
    setLookups((prev) => {
      const next = new Map(prev);
      const state: LookupState = { kind: "done", result };
      for (const idx of result.indices) next.set(idx, state);
      return next;
    });
    // Vocab save: once per segment per bubble (mirrors the old "only the
    // first tap saves" behaviour — cached re-taps never re-saved either).
    const saveKey = spanId ?? -1 - tappedIndex;
    if (!disableSave && !savedSegmentsRef.current.has(saveKey)) {
      savedSegmentsRef.current.add(saveKey);
      fetch("/api/me/vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: result.segment,
          context: text,
          wordIndex: tappedIndex,
        }),
      }).catch(() => {});
    }
  }

  /** Live per-word call — fallback when no annotation is available or the
   *  annotator produced no gloss for this span. */
  function liveLookup(token: Extract<Token, { kind: "word" }>, generation: number) {
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
        if (generation !== generationRef.current) return;
        applyLookup(result, token.wordIndex, null);
      })
      .catch((err: Error) => {
        if (generation !== generationRef.current) return;
        setLookups((prev) => {
          const next = new Map(prev);
          next.set(token.wordIndex, { kind: "error", message: err.message });
          return next;
        });
      });
  }

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

    const generation = generationRef.current;
    const annotationPromise = annotationRef.current;

    void (async () => {
      // Preferred path: resolve from the pre-annotation. If the fetch is
      // still in flight we await it here — no second call is fired.
      const annotation = annotationPromise ? await annotationPromise : null;
      if (generation !== generationRef.current) return;

      const spanId = annotation?.tokenToSpan?.[token.wordIndex];
      const span = spanId !== undefined ? annotation?.spans?.[spanId] : undefined;
      // Sanity guard: server and client must agree on tokenisation.
      const aligned = annotation?.words?.[token.wordIndex] === token.text;

      if (span && aligned && span.translation) {
        applyLookup(
          { segment: span.text, translation: span.translation, indices: span.indices },
          token.wordIndex,
          span.id,
        );
        return;
      }
      liveLookup(token, generation);
    })();
  }

  // ── Render ────────────────────────────────────────────────────────────

  const isArticle = variant === "article";
  const baseClasses = isArticle
    ? "w-full text-lg leading-loose text-neutral-900"
    : muted
    ? "max-w-[80%] rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm italic text-neutral-400"
    : "max-w-[80%] rounded-2xl bg-neutral-100 px-4 py-3 text-base leading-relaxed text-neutral-900";

  const tokens = !loading && text ? tokenize(text) : null;

  const showSpeakControls = !loading && !muted && text && !disableTts;

  return (
    <div className={isArticle ? "w-full" : "flex justify-start"}>
      <div className={isArticle ? "w-full" : "flex flex-col items-start max-w-[80%]"}>
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
        {showSpeakControls && (
          <button
            onClick={toggleTts}
            disabled={!ttsBlob && ttsLoading}
            className="mt-1 ml-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors inline-flex items-center gap-1 disabled:opacity-60"
            aria-label={isPlaying ? "Stop" : "Speak"}
          >
            {isPlaying ? "■ Stop" : ttsLoading && !ttsBlob ? "Loading audio…" : "▶ Speak"}
          </button>
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
    const SCREEN_PADDING = 8;
    const wordCenterX = anchor.left + anchor.width / 2;

    // Viewport clamping: default is centred over the word, but a word
    // near either screen edge would push the popover off-screen. We
    // render invisibly at the naive position first, measure the actual
    // width, clamp into [padding, viewport - padding], and slide the
    // tail so it keeps pointing at the tapped word. Re-measured on
    // every content change (loading → result changes the width).
    const innerRef = useRef<HTMLDivElement | null>(null);
    const [clamp, setClamp] = useState<{ left: number; tailLeft: number } | null>(null);

    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      const width = el.offsetWidth;
      const viewportWidth = window.innerWidth;
      let left = wordCenterX - width / 2;
      const maxLeft = viewportWidth - width - SCREEN_PADDING;
      if (left > maxLeft) left = maxLeft;
      if (left < SCREEN_PADDING) left = SCREEN_PADDING;
      // Tail follows the word centre, but stays inside the rounded
      // corners of the bubble (10px margin either side).
      const tailLeft = Math.max(10, Math.min(width - 10, wordCenterX - left));
      setClamp({ left, tailLeft });
    }, [wordCenterX, lookup]);

    // Anchor the popover ABOVE the word using `bottom`. position: fixed
    // escapes the messages container's overflow-y-auto clipping. Until
    // the first measurement lands, keep it invisible at the naive spot
    // so there's no flash of an off-screen or jumping bubble.
    const style: React.CSSProperties = {
      position: "fixed",
      bottom: window.innerHeight - anchor.top + GAP,
      left: clamp ? clamp.left : wordCenterX,
      transform: clamp ? undefined : "translateX(-50%)",
      visibility: clamp ? "visible" : "hidden",
      zIndex: 50,
    };
    return (
      <div
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
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
          className="absolute top-full -mt-px w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-neutral-900"
          style={{ left: clamp ? clamp.tailLeft : "50%", transform: "translateX(-50%)" }}
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
