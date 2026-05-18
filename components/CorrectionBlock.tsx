"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import type { CorrectionResult, Pair } from "@/types/correction";

interface FollowupTurn {
  question: string;
  answer: string;
}

interface CorrectionBlockProps {
  result: CorrectionResult;
  nativeLanguage: string;
  /** Override the explain model. undefined → server default (chat_light).
   *  Playground sets explicit boolean via the model toggle. */
  explainMini?: boolean;
  /** Override the explain prompt version. undefined → server default (V2).
   *  Playground sets explicit boolean via the prompt-version toggle. */
  improvedExplainPrompt?: boolean;
  /** When true, auto-play the corrected sentence's TTS once preload
   *  finishes. Driven by the chat-level Auto-Read toggle for fresh
   *  user turns only (not for past turns loaded from DB). */
  autoPlay?: boolean;
}

export default function CorrectionBlock({
  result,
  nativeLanguage,
  explainMini,
  improvedExplainPrompt,
  autoPlay = false,
}: CorrectionBlockProps) {
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<Record<number, string>>({});

  // Follow-up Q&A per segment. Each index keeps its own conversation
  // history while the user toggles between segments. Cleared whenever
  // a new result arrives. Ephemeral by design — not persisted to DB.
  const [followups, setFollowups] = useState<Record<number, FollowupTurn[]>>({});
  const [followupInput, setFollowupInput] = useState("");
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const followupInputRef = useRef<HTMLInputElement | null>(null);

  const [ttsLoading, setTtsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playCount, setPlayCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Cached blobs per speed so repeated clicks skip the API call
  const blobCacheRef = useRef<{ normal?: Blob; slow?: Blob }>({});
  // Has Auto-Read already triggered the auto-play for this result?
  const autoPlayedRef = useRef(false);

  // Clear everything when a new result arrives (new recording)
  useEffect(() => {
    setCache({});
    setSelectedIndex(null);
    setSelectedPair(null);
    setExplanation(null);
    setFollowups({});
    setFollowupInput("");
    setFollowupLoading(false);
    setFollowupError(null);
    setPlayCount(0);
    setIsPlaying(false);
    blobCacheRef.current = {};
    autoPlayedRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // Preload normal-speed TTS so the first click plays instantly.
    // Slow speed is generated on demand (rare second-click).
    let cancelled = false;
    fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: result.local_version_target, speed: 1.0 }),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        blobCacheRef.current.normal = blob;
        // Auto-Read: if turned on at the moment the blob arrived, play
        // once. Captured via autoPlay-at-fetch-start through the closure
        // — toggling the chat-level Auto-Read while the audio loads
        // does not retroactively trigger old bubbles.
        if (autoPlay && !autoPlayedRef.current && !audioRef.current) {
          autoPlayedRef.current = true;
          playCachedNormal();
        }
      })
      .catch(() => {
        // Silent — handleSpeak will fall back to a fresh fetch on click.
      });
    return () => {
      cancelled = true;
    };
    // intentionally NOT depending on autoPlay so toggling Auto-Read
    // doesn't retroactively replay already-loaded bubbles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function playCachedNormal() {
    const blob = blobCacheRef.current.normal;
    if (!blob) return;
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
      setPlayCount((c) => c + 1);
      setIsPlaying(false);
    };
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }

  async function handlePairClick(pair: Pair, index: number) {
    if (pair.is_match) return;

    // Toggle off if already selected — clears the per-segment ephemeral
    // history too, matching the "follow-ups die when the segment is
    // closed" rule.
    if (selectedIndex === index) {
      setSelectedIndex(null);
      setSelectedPair(null);
      setExplanation(null);
      setFollowupInput("");
      setFollowupError(null);
      setFollowups((prev) => {
        if (!(index in prev)) return prev;
        const next = { ...prev };
        delete next[index];
        return next;
      });
      return;
    }

    setSelectedIndex(index);
    setSelectedPair(pair);
    setFollowupInput("");
    setFollowupError(null);

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
          localVersionTarget: result.local_version_target,
          localSegment: pair.local_segment,
          userSegment: pair.user_segment,
          nativeLanguage,
          explainMini,
          improvedExplainPrompt,
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

  async function handleFollowupSend() {
    if (followupLoading) return;
    if (selectedIndex === null || !selectedPair) return;
    const question = followupInput.trim();
    if (!question) return;
    const baseExplanation = cache[selectedIndex] ?? explanation;
    if (!baseExplanation) return;

    const priorTurns = followups[selectedIndex] ?? [];
    const history = priorTurns.flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.answer },
    ]);

    setFollowupInput("");
    setFollowupError(null);
    setFollowupLoading(true);
    try {
      const res = await fetch("/api/explain/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localVersionTarget: result.local_version_target,
          localSegment: selectedPair.local_segment,
          userSegment: selectedPair.user_segment,
          initialExplanation: baseExplanation,
          history,
          question,
          nativeLanguage,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { answer?: string };
      const answer = data.answer?.trim();
      if (!answer) throw new Error("Empty answer");
      setFollowups((prev) => ({
        ...prev,
        [selectedIndex]: [...(prev[selectedIndex] ?? []), { question, answer }],
      }));
    } catch (err) {
      console.error("[followup]", err);
      setFollowupError((err as Error).message || "Konnte Antwort nicht laden");
      // Put the user's draft back so they can retry without retyping.
      setFollowupInput(question);
    } finally {
      setFollowupLoading(false);
      // Refocus the input for fast follow-up Q&A.
      setTimeout(() => followupInputRef.current?.focus(), 0);
    }
  }

  function handleStop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  }

  async function handleSpeak() {
    if (ttsLoading) return;

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // Speed alternates only when playback completes fully — use current count to decide
    const speedKey = playCount % 2 === 0 ? "normal" : "slow";
    const speed = speedKey === "slow" ? 0.75 : 1.0;

    // Use cached blob if available — text only changes on a new recording
    let blob = blobCacheRef.current[speedKey];
    if (!blob) {
      setTtsLoading(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: result.local_version_target, speed }),
        });
        if (!res.ok) throw new Error("TTS failed");
        blob = await res.blob();
        blobCacheRef.current[speedKey] = blob;
      } catch {
        setTtsLoading(false);
        return;
      }
      setTtsLoading(false);
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      // Only advance the counter when the full sentence was heard
      setPlayCount(c => c + 1);
      setIsPlaying(false);
    };
    audio.play();
    setIsPlaying(true);
  }

  // Next play will be slow if playCount is currently even (0, 2, 4 → next is odd → slow)
  const nextIsSlow = playCount % 2 === 1;
  const speakLabel = ttsLoading
    ? "Generating audio…"
    : isPlaying
    ? "Stop"
    : nextIsSlow
    ? "Play sentence (slow)"
    : "Play sentence";

  return (
    <div className="w-full space-y-3">
      {/* Segment display */}
      <div className="relative w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        {/* TTS button */}
        <button
          onClick={isPlaying ? handleStop : handleSpeak}
          disabled={ttsLoading}
          aria-label={speakLabel}
          title={speakLabel}
          className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-neutral-300 hover:text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {ttsLoading ? <TtsSpinner /> : isPlaying ? <StopIcon /> : <SpeakerIcon slow={nextIsSlow} />}
        </button>

        <div
          className="text-lg leading-[3rem] text-neutral-900 pr-8"
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

          {/* Follow-up Q&A — shown only once the initial explanation is on screen */}
          {selectedIndex !== null && explanation && !loading && (
            <div className="border-t border-neutral-100 px-5 py-3 bg-neutral-50">
              {(followups[selectedIndex] ?? []).map((turn, i) => (
                <div key={i} className="mb-3 space-y-1.5">
                  <p className="text-xs text-neutral-500 leading-snug">
                    <span className="font-medium text-neutral-600">Du:</span> {turn.question}
                  </p>
                  <div className="text-sm text-neutral-700 pl-3 border-l-2 border-neutral-200">
                    <FormattedText text={turn.answer} />
                  </div>
                </div>
              ))}

              {followupLoading && (
                <p className="flex items-center gap-2 text-xs text-neutral-400 mb-2">
                  <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
                  Antwort wird geladen…
                </p>
              )}

              <div className="flex gap-2 items-center mt-1">
                <input
                  ref={followupInputRef}
                  type="text"
                  value={followupInput}
                  onChange={(e) => setFollowupInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleFollowupSend();
                    }
                  }}
                  disabled={followupLoading}
                  placeholder="Folgefrage zur Grammatik…"
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={handleFollowupSend}
                  disabled={followupLoading || !followupInput.trim()}
                  className="shrink-0 h-9 px-3 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Senden
                </button>
              </div>

              {followupError && (
                <p className="mt-1.5 text-xs text-rose-500">{followupError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TTS icons ──────────────────────────────────────────────────────────────

function TtsSpinner() {
  return (
    <span className="block w-4 h-4 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin" />
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <rect x="4" y="4" width="12" height="12" rx="2" />
    </svg>
  );
}

// Speaker icon; shows a small turtle badge when the next click will be slow
function SpeakerIcon({ slow }: { slow: boolean }) {
  return (
    <span className="relative block w-4 h-4">
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M9.25 3.35a.75.75 0 00-1.23-.573L4.18 6.25H2.75A.75.75 0 002 7v6a.75.75 0 00.75.75H4.18l3.84 3.473A.75.75 0 009.25 16.65V3.35z" />
        <path d="M13.537 5.963a.75.75 0 00-1.06 1.061 4.5 4.5 0 010 5.952.75.75 0 001.06 1.06 6 6 0 000-8.073z" />
        <path d="M15.66 3.84a.75.75 0 00-1.06 1.06 7.5 7.5 0 010 10.2.75.75 0 001.06 1.06 9 9 0 000-12.32z" />
      </svg>
      {slow && (
        <span
          className="absolute -bottom-1 -right-1 text-[8px] leading-none"
          aria-hidden="true"
        >
          🐢
        </span>
      )}
    </span>
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
      {/* Local target-language segment — primary text with green highlight */}
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
