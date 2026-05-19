"use client";

/**
 * Visual card-stack with up to 5 layers visible at any time. The front
 * card is fully opaque, scaled normally; each card behind peeks 6px
 * higher than the one in front of it, with progressively more grey and
 * less opacity. When the front card exits, the rest shift forward via
 * CSS transitions on transform/opacity, and a new card appears at the
 * back of the visible window.
 *
 * Caller controls the queue and the "exit" trigger via props:
 *   - cards: the full remaining queue (we render only the first 5)
 *   - exitingId: id of the card currently animating out, or null
 *
 * The exit animation translates the front card down by ~80px and fades
 * to opacity 0 over 400ms — deliberately short, doesn't leave the
 * viewport (per UX brief).
 *
 * The front card has a small TTS speaker button in its top-right
 * corner — click to hear the target word pronounced. Audio blob is
 * cached per card id within this component so re-clicks are instant.
 * Auto-stops on card change.
 */

import { useEffect, useRef, useState } from "react";

const VISIBLE_LAYERS = 5;
const TRANSLATE_PER_LAYER = 6;   // px each card peeks above the one in front
const EXIT_TRANSLATE_Y = 80;     // px the dismissing card moves down

const LAYER_OPACITY = [1, 0.78, 0.56, 0.36, 0.2];
const LAYER_BG = [
  "bg-white",
  "bg-neutral-50",
  "bg-neutral-100",
  "bg-neutral-200",
  "bg-neutral-300",
];
const LAYER_BORDER = [
  "border-neutral-200",
  "border-neutral-300",
  "border-neutral-400",
  "border-neutral-500",
  "border-neutral-600",
];

export interface VocabCardData {
  id: number;
  target_word_original: string;
  stage: number;
}

interface Props {
  cards: VocabCardData[];
  exitingId: number | null;
  /** Optional content rendered ON TOP of the front card. Lets the parent
   *  page place the answer input / feedback inside the same visual
   *  container without VocabCardStack knowing about that flow. */
  frontOverlay?: React.ReactNode;
  /** Optional handler invoked when the user taps the front card itself
   *  (specifically the word). Used by the practice page as a "flip /
   *  reveal answer" shortcut so the user doesn't have to reach for the
   *  X button. No-op when omitted. */
  onTapFront?: () => void;
}

export default function VocabCardStack({ cards, exitingId, frontOverlay, onTapFront }: Props) {
  const isExiting = exitingId !== null;
  const visible = cards.slice(0, VISIBLE_LAYERS + (isExiting ? 1 : 0));

  // ── TTS state — front-card-scoped ───────────────────────────────────
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Per-card-id blob cache so repeat clicks within a session don't
  // refetch. Invalidated implicitly when the user navigates away
  // (component unmount) — fresh queue load on remount starts cold.
  const blobCacheRef = useRef<Map<number, Blob>>(new Map());

  const frontCardId = isExiting ? cards[1]?.id : cards[0]?.id;

  // Stop any in-flight playback when the front card changes (after a
  // commit + exit, the next card slides in — we don't want the previous
  // card's audio to continue playing into the new one).
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setTtsPlaying(false);
  }, [frontCardId]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  async function handleSpeak() {
    if (!frontCardId) return;
    if (ttsLoading) return;

    // Toggle off if currently playing.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setTtsPlaying(false);
      return;
    }

    let blob = blobCacheRef.current.get(frontCardId);
    if (!blob) {
      setTtsLoading(true);
      try {
        const res = await fetch("/api/vocab/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: frontCardId }),
        });
        if (!res.ok) throw new Error("TTS failed");
        blob = await res.blob();
        blobCacheRef.current.set(frontCardId, blob);
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
      audioRef.current = null;
      setTtsPlaying(false);
    };
    audio
      .play()
      .then(() => setTtsPlaying(true))
      .catch(() => setTtsPlaying(false));
  }

  return (
    <div className="relative w-full max-w-md mx-auto h-72">
      {visible.map((card, i) => {
        const isExitingThis = card.id === exitingId;
        // While exiting, cards behind the dismissing one move forward by
        // one layer. The dismissing card itself gets the special "exit"
        // styling regardless of its position.
        const layer = isExitingThis ? 0 : isExiting ? Math.max(0, i - 1) : i;
        const isFront = layer === 0 && !isExitingThis;

        const transform = isExitingThis
          ? `translateY(${EXIT_TRANSLATE_Y}px)`
          : `translateY(-${layer * TRANSLATE_PER_LAYER}px)`;
        const opacity = isExitingThis ? 0 : LAYER_OPACITY[layer] ?? 0;
        const zIndex = isExitingThis ? VISIBLE_LAYERS + 1 : VISIBLE_LAYERS - layer;

        return (
          <div
            key={card.id}
            className={`absolute inset-0 rounded-2xl border shadow-sm transition-all duration-[400ms] ease-out flex items-center justify-center ${
              LAYER_BG[layer] ?? LAYER_BG[VISIBLE_LAYERS - 1]
            } ${LAYER_BORDER[layer] ?? LAYER_BORDER[VISIBLE_LAYERS - 1]}`}
            style={{ transform, opacity, zIndex }}
            aria-hidden={!isFront}
          >
            {isFront ? (
              <>
                {/* TTS button — top-right of the front card. */}
                <button
                  onClick={handleSpeak}
                  disabled={ttsLoading}
                  aria-label={ttsPlaying ? "Stop" : "Wort vorlesen"}
                  title={ttsPlaying ? "Stop" : "Wort vorlesen"}
                  className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-neutral-300 hover:text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {ttsLoading ? <TtsSpinner /> : ttsPlaying ? <StopIcon /> : <SpeakerIcon />}
                </button>

                <div className="flex flex-col items-center gap-3 px-6 py-8 w-full">
                  <p className="text-xs uppercase tracking-wider text-neutral-400">
                    Stage {card.stage}
                  </p>
                  {onTapFront ? (
                    <button
                      type="button"
                      onClick={onTapFront}
                      title="Antippen für die Lösung"
                      className="text-3xl font-medium text-neutral-900 text-center break-words cursor-pointer hover:text-neutral-600 transition-colors focus:outline-none focus-visible:underline"
                    >
                      {card.target_word_original}
                    </button>
                  ) : (
                    <p className="text-3xl font-medium text-neutral-900 text-center break-words">
                      {card.target_word_original}
                    </p>
                  )}
                  {frontOverlay ? <div className="w-full mt-2">{frontOverlay}</div> : null}
                </div>
              </>
            ) : (
              <span className="text-2xl text-neutral-400 select-none">
                {card.target_word_original}
              </span>
            )}
          </div>
        );
      })}
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

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M9.25 3.35a.75.75 0 00-1.23-.573L4.18 6.25H2.75A.75.75 0 002 7v6a.75.75 0 00.75.75H4.18l3.84 3.473A.75.75 0 009.25 16.65V3.35z" />
      <path d="M13.537 5.963a.75.75 0 00-1.06 1.061 4.5 4.5 0 010 5.952.75.75 0 001.06 1.06 6 6 0 000-8.073z" />
      <path d="M15.66 3.84a.75.75 0 00-1.06 1.06 7.5 7.5 0 010 10.2.75.75 0 001.06 1.06 9 9 0 000-12.32z" />
    </svg>
  );
}
