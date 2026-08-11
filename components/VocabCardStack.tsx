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
 *
 * TTS for the whole visible window (up to 5 cards) is prefetched in the
 * background as the window shifts, so by the time a card reaches the
 * front its audio is already in the in-memory cache and playback is
 * instant. /api/vocab/tts is itself cache-aware (DB hit → return blob;
 * miss → generate + persist + return), so a prefetch both warms this
 * component's cache and triggers server-side generation for any card
 * that has never been voiced.
 */

import { useEffect, useRef, useState } from "react";
import { MAX_STAGE } from "@/lib/vocabSrsConstants";

/** One dot per SRS stage (1..MAX_STAGE); dots up to the card's current
 *  stage are filled green. Compact enough for the card's top-left. */
function StageDots({ stage }: { stage: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]">
      {Array.from({ length: MAX_STAGE }, (_, i) => (
        <span
          key={i}
          className={
            "block w-[7px] h-[7px] rounded-full border " +
            (i < stage
              ? "bg-emerald-500 border-emerald-500"
              : "bg-transparent border-neutral-300")
          }
        />
      ))}
    </span>
  );
}

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
  /** Canonical word class from the classifier (null on legacy rows).
   *  Shown as a subtle German label under the word — disambiguates
   *  homographs like "echo" (Verb: ich werfe) vs "hecho" (Nomen). */
  word_class?: string | null;
}

/** German display labels for the classifier's canonical word classes. */
const WORD_CLASS_LABELS: Record<string, string> = {
  noun: "Nomen",
  verb: "Verb",
  adjective: "Adjektiv",
  adverb: "Adverb",
  preposition: "Präposition",
  conjunction: "Konjunktion",
  pronoun: "Pronomen",
  determiner: "Begleiter",
  interjection: "Interjektion",
  idiom: "Redewendung",
  phrase: "Phrase",
};

interface Props {
  cards: VocabCardData[];
  exitingId: number | null;
  /** Optional content rendered ON TOP of the front card. Lets the parent
   *  page place the answer input / feedback inside the same visual
   *  container without VocabCardStack knowing about that flow. */
  frontOverlay?: React.ReactNode;
  /** Optional handler invoked when the user taps the front card itself.
   *  The ENTIRE front face is the tap target; the TTS button stops
   *  propagation so it stays usable. Practice page wires this to "Ich
   *  weiß es nicht" so the user can reveal by tapping the card. */
  onTapFront?: () => void;
  /** When true the front card flips on its Y axis to show `back` instead
   *  of the target word. Practice page sets this when stage='revealed'.
   *  Animation is a 600ms 3D rotation; backface-visibility hides the
   *  inside of each face during the rotation. */
  revealed?: boolean;
  /** Content for the back face. Rendered behind the front face and only
   *  visible after the flip. Card stack only flips the topmost card. */
  back?: React.ReactNode;
}

export default function VocabCardStack({
  cards,
  exitingId,
  frontOverlay,
  onTapFront,
  revealed = false,
  back,
}: Props) {
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
  // In-flight fetches keyed by card id, so a prefetch and a click that
  // race on the same card share one request instead of firing two.
  const inflightRef = useRef<Map<number, Promise<Blob | null>>>(new Map());

  const frontCardId = isExiting ? cards[1]?.id : cards[0]?.id;

  // Fetch (or reuse) the TTS blob for a card id. Resolves null on
  // failure. Dedupes via blobCacheRef (done) and inflightRef (pending).
  async function fetchBlob(id: number): Promise<Blob | null> {
    const cached = blobCacheRef.current.get(id);
    if (cached) return cached;
    const pending = inflightRef.current.get(id);
    if (pending) return pending;

    const p = (async (): Promise<Blob | null> => {
      try {
        const res = await fetch("/api/vocab/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: id }),
        });
        if (!res.ok) throw new Error("TTS failed");
        const blob = await res.blob();
        blobCacheRef.current.set(id, blob);
        return blob;
      } catch {
        return null;
      } finally {
        inflightRef.current.delete(id);
      }
    })();
    inflightRef.current.set(id, p);
    return p;
  }

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

  // Prefetch TTS for every card in the visible window. Runs whenever the
  // window's id set changes (a card committed + the stack shifted), so
  // the next cards' audio is warm before they reach the front. fetchBlob
  // is a no-op for ids already cached or in flight.
  const visibleIdsKey = visible.map((c) => c.id).join(",");
  useEffect(() => {
    for (const card of visible) {
      void fetchBlob(card.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIdsKey]);

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

    // Warm from the prefetch cache when possible; otherwise fetch now
    // (sharing any in-flight prefetch for this id) and show the spinner.
    let blob = blobCacheRef.current.get(frontCardId);
    if (!blob) {
      setTtsLoading(true);
      const fetched = await fetchBlob(frontCardId);
      setTtsLoading(false);
      if (!fetched) return;
      blob = fetched;
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
    // perspective on the outer container makes the inner rotateY look
    // like a real 3D flip instead of a flat horizontal squash. Value
    // tuned so the card front feels close to the eye but not fish-eyed.
    <div className="relative w-full max-w-md mx-auto h-72" style={{ perspective: 1400 }}>
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

        // The front card uses an inner rotating shell with two
        // back-face-hidden sides; non-front cards skip all that and
        // render flat. Avoids paying the 3D layer cost for the silhouettes.
        const innerRotate = isFront && revealed ? "rotateY(180deg)" : "rotateY(0deg)";

        return (
          <div
            key={card.id}
            className="absolute inset-0 transition-all duration-[400ms] ease-out"
            style={{ transform, opacity, zIndex }}
            aria-hidden={!isFront}
          >
            {isFront ? (
              // Inner flip shell — preserve-3d lets the children sit at
              // different rotateY values. transition on transform alone
              // (not transform-all) so the parent's translateY stack
              // animation doesn't get smeared by the flip's easing.
              <div
                className="relative w-full h-full"
                style={{
                  transformStyle: "preserve-3d",
                  transform: innerRotate,
                  transition: "transform 600ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {/* Front face */}
                <div
                  className={`absolute inset-0 rounded-2xl border shadow-sm flex items-center justify-center ${LAYER_BG[0]} ${LAYER_BORDER[0]}`}
                  style={{
                    backfaceVisibility: "hidden",
                    WebkitBackfaceVisibility: "hidden",
                  }}
                  onClick={!revealed && onTapFront ? onTapFront : undefined}
                  role={!revealed && onTapFront ? "button" : undefined}
                  tabIndex={!revealed && onTapFront ? 0 : undefined}
                >
                  {/* Stage progress: one dot per SRS stage, filled up
                      to the card's current stage. New card → all empty;
                      each correct answer fills one more. */}
                  <div className="absolute top-4 left-3.5" title={`Stage ${card.stage} von ${MAX_STAGE}`}>
                    <StageDots stage={card.stage} />
                  </div>

                  {/* TTS button. stopPropagation so tapping it doesn't
                      also fire onTapFront → no accidental reveal. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSpeak();
                    }}
                    disabled={ttsLoading}
                    aria-label={ttsPlaying ? "Stop" : "Wort vorlesen"}
                    title={ttsPlaying ? "Stop" : "Wort vorlesen"}
                    className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-neutral-300 hover:text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {ttsLoading ? <TtsSpinner /> : ttsPlaying ? <StopIcon /> : <SpeakerIcon />}
                  </button>

                  <div className="flex flex-col items-center gap-3 px-6 py-8 w-full pointer-events-none">
                    <p className="text-3xl font-medium text-neutral-900 text-center break-words">
                      {card.target_word_original}
                    </p>
                    {card.word_class && WORD_CLASS_LABELS[card.word_class] && (
                      <p className="text-xs text-neutral-400 -mt-1">
                        {WORD_CLASS_LABELS[card.word_class]}
                      </p>
                    )}
                    {frontOverlay ? (
                      // re-enable pointer events for the overlay (input
                      // would be unusable inside a pointer-events-none
                      // wrapper).
                      <div className="w-full mt-2 pointer-events-auto">{frontOverlay}</div>
                    ) : null}
                  </div>
                </div>

                {/* Back face — same rectangle, pre-rotated 180deg so it
                    faces forward when the shell finishes rotating. */}
                <div
                  className="absolute inset-0 rounded-2xl"
                  style={{
                    transform: "rotateY(180deg)",
                    backfaceVisibility: "hidden",
                    WebkitBackfaceVisibility: "hidden",
                  }}
                >
                  {back}
                </div>
              </div>
            ) : (
              <div
                className={`w-full h-full rounded-2xl border shadow-sm flex items-center justify-center ${
                  LAYER_BG[layer] ?? LAYER_BG[VISIBLE_LAYERS - 1]
                } ${LAYER_BORDER[layer] ?? LAYER_BORDER[VISIBLE_LAYERS - 1]}`}
              >
                <span className="text-2xl text-neutral-400 select-none">
                  {card.target_word_original}
                </span>
              </div>
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
