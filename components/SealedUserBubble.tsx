"use client";

/**
 * Right-aligned user bubble used for past turns loaded from the DB —
 * we have the corrected Spanish text but not the full in-memory
 * CorrectionResult (interpretation, confidence, notes), so the rich
 * correction view from UserBubble can't render. Just shows the
 * corrected target-language text.
 *
 * Live new turns continue to use UserBubble with its full correction
 * view. See BACKLOG "Collapse user-turn correction view on Done;
 * show as sealed bubble" for the planned UX consolidation where ALL
 * post-Done bubbles look like this.
 */
export default function SealedUserBubble({ textEs }: { textEs: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-neutral-900 px-4 py-3 text-base leading-relaxed text-white">
        <span className="whitespace-pre-wrap">{textEs}</span>
      </div>
    </div>
  );
}
