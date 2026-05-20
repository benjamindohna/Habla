"use client";

// The "What I think you tried to say" line that sits above the segmented
// correction. The user can tap Edit to override our interpretation —
// committing fires onReCorrect with the new text, which the parent
// forwards to /api/correct as overrideIntendedMeaning so the pipeline
// re-runs localize + segment against the user's own meaning.
//
// Editing uses a wrapping textarea instead of a single-line input so
// long sentences are fully visible without horizontal scrolling. A
// Fertig button commits, Abbrechen reverts the draft. Alignment is
// configurable: chat user bubbles right-align, the Frei page left-
// aligns to match its centered single-column layout.

import { useState, useEffect } from "react";

interface InterpretationLineProps {
  interpretation: string;
  onReCorrect: (override: string) => void;
  align?: "left" | "right";
}

export default function InterpretationLine({
  interpretation,
  onReCorrect,
  align = "right",
}: InterpretationLineProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(interpretation);

  // Keep the displayed text in sync with re-corrected interpretations
  // from the server — but only when not actively editing, so a
  // background result update doesn't clobber the user's draft.
  useEffect(() => {
    if (!editing) setDraft(interpretation);
  }, [interpretation, editing]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setEditing(false);
    if (trimmed !== interpretation.trim()) {
      onReCorrect(trimmed);
    }
  }

  function cancel() {
    setDraft(interpretation);
    setEditing(false);
  }

  const alignClass = align === "right" ? "text-right" : "text-left";
  const flexJustify = align === "right" ? "justify-end" : "justify-start";

  return (
    <div className="px-1">
      <p className={`text-xs text-neutral-400 uppercase tracking-wide mb-1 ${alignClass}`}>
        What I think you tried to say
      </p>
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
            }}
            className="w-full text-base text-neutral-900 bg-white border border-neutral-300 rounded-lg p-3 leading-relaxed focus:border-neutral-600 focus:outline-none resize-none"
          />
          <div className={`flex gap-2 ${flexJustify}`}>
            <button
              onClick={cancel}
              className="text-xs text-neutral-500 hover:text-neutral-800 px-2 py-1.5 transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={commit}
              disabled={!draft.trim() || draft.trim() === interpretation.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Fertig
            </button>
          </div>
        </div>
      ) : (
        <div className={`flex items-baseline gap-2 ${flexJustify}`}>
          {align === "right" && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
            >
              Edit
            </button>
          )}
          <p className="text-base text-neutral-700">{interpretation}</p>
          {align === "left" && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
            >
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
