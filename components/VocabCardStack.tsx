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
 */

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
}

export default function VocabCardStack({ cards, exitingId, frontOverlay }: Props) {
  const isExiting = exitingId !== null;
  const visible = cards.slice(0, VISIBLE_LAYERS + (isExiting ? 1 : 0));

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
              <div className="flex flex-col items-center gap-3 px-6 py-8 w-full">
                <p className="text-xs uppercase tracking-wider text-neutral-400">
                  Stage {card.stage}
                </p>
                <p className="text-3xl font-medium text-neutral-900 text-center break-words">
                  {card.target_word_original}
                </p>
                {frontOverlay ? <div className="w-full mt-2">{frontOverlay}</div> : null}
              </div>
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
