"use client";

import { useEffect, useRef, useState } from "react";
import { WORD_REGEX } from "@/lib/aiBubblePipeline";

// ── Tokenisation (mirrors WORD_REGEX in lib/aiBubblePipeline.ts) ──────────

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

// ── State shapes ─────────────────────────────────────────────────────────

type GenStatus =
  | { stage: "idle" }
  | { stage: "loading" }
  | { stage: "ok"; text: string; topic: string; ms: number }
  | { stage: "error"; message: string };

type LookupState =
  | { kind: "loading" }
  | { kind: "done"; segment: string; translation: string; indices: number[] }
  | { kind: "error"; message: string };

// ── Page ─────────────────────────────────────────────────────────────────

export default function OnTapPlaygroundPage() {
  const [topic, setTopic] = useState("");
  const [gen, setGen] = useState<GenStatus>({ stage: "idle" });
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [lookups, setLookups] = useState<Map<number, LookupState>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  async function generate() {
    const t = topic.trim();
    if (!t || gen.stage === "loading") return;
    setGen({ stage: "loading" });
    setOpenIndex(null);
    setLookups(new Map());
    const start = performance.now();
    try {
      const res = await fetch("/api/playground/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { text: string };
      const ms = Math.round(performance.now() - start);
      setGen({ stage: "ok", text: data.text, topic: t, ms });
    } catch (err) {
      setGen({ stage: "error", message: (err as Error).message });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  }

  function handleWordTap(token: Extract<Token, { kind: "word" }>, sentence: string) {
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

    fetch("/api/playground/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sentence,
        word: token.text,
        wordIndex: token.wordIndex,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<{
          segment: string;
          translation: string;
          indices: number[];
        }>;
      })
      .then((data) => {
        const result: LookupState = {
          kind: "done",
          segment: data.segment,
          translation: data.translation,
          indices: data.indices,
        };
        // Populate the cache under every covered index so a later tap on
        // any related word returns the same answer without a fresh call.
        setLookups((prev) => {
          const next = new Map(prev);
          for (const idx of data.indices) next.set(idx, result);
          return next;
        });
      })
      .catch((err: Error) => {
        setLookups((prev) => {
          const next = new Map(prev);
          next.set(token.wordIndex, { kind: "error", message: err.message });
          return next;
        });
      });
  }

  // Click-outside closes the open popover.
  useEffect(() => {
    if (openIndex === null) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpenIndex(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openIndex]);

  const tokens = gen.stage === "ok" ? tokenize(gen.text) : [];
  const sentence = gen.stage === "ok" ? gen.text : "";

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-8">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">On-Tap Translate Playground</h1>
          <p className="text-sm text-neutral-500">
            Generates the AI message in one focused call. Each word is independently tappable;
            the translation is fetched only when you tap it (full-sentence context, contextually
            correct meaning, multi-word units grouped on the fly). Taps do <em>not</em> save to your vocab list.
          </p>
        </header>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-neutral-400">Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="z.B. Champions League · Stoizismus · Berlin Tech-Szene"
            disabled={gen.stage === "loading"}
            className="w-full text-base text-neutral-900 bg-white border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-600 disabled:opacity-50"
          />
          <p className="text-xs text-neutral-400">Press Enter to generate.</p>
        </div>

        {gen.stage === "loading" && (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
            <span>Generating…</span>
          </div>
        )}

        {gen.stage === "error" && (
          <p className="text-sm text-red-500">{gen.message}</p>
        )}

        {gen.stage === "ok" && (
          <div className="space-y-4">
            <div className="text-xs text-neutral-400">
              Topic: <span className="text-neutral-600">{gen.topic}</span>
              {" · "}
              {gen.ms}ms
            </div>

            <div ref={containerRef} className="rounded-2xl bg-neutral-100 px-4 py-3 text-base leading-relaxed text-neutral-900">
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
                      onTap={() => handleWordTap(tok, sentence)}
                    />
                  ),
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </main>
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
      {open && <Popover lookup={lookup} />}
    </span>
  );
}

function Popover({ lookup }: { lookup: LookupState | undefined }) {
  return (
    <span
      role="tooltip"
      className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-10 whitespace-nowrap rounded-lg bg-neutral-900 text-white text-xs px-3 py-2 shadow-md min-w-[120px]"
    >
      {!lookup || lookup.kind === "loading" ? (
        <span className="inline-flex items-center gap-2">
          <span className="block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          <span className="text-white/80">Übersetze…</span>
        </span>
      ) : lookup.kind === "error" ? (
        <span className="text-red-300">{lookup.message}</span>
      ) : (
        <span className="block text-left leading-snug">
          <span className="block">{lookup.translation}</span>
          {lookup.segment.includes(" ") && (
            <span className="block text-[10px] text-white/60 mt-1">{lookup.segment}</span>
          )}
        </span>
      )}
      <span
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 top-full -mt-px w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-neutral-900"
      />
    </span>
  );
}
