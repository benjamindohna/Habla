"use client";

import { useState } from "react";
import CorrectionBlock from "./CorrectionBlock";
import type { CorrectionResult } from "@/types/correction";

interface UserBubbleProps {
  result: CorrectionResult;
  nativeLanguage: string;
  showDone: boolean;
  onDone: () => void;
  onReCorrect: (override: string) => void;
  /** Test-only: forwarded to CorrectionBlock so /api/explain runs on
   *  chat_light. Used by /playground/correct-test. Default false. */
  explainMini?: boolean;
  /** Test-only: forwarded to CorrectionBlock for V2 explain prompt. */
  improvedExplainPrompt?: boolean;
}

// One user turn in the chat: the corrected interpretation, the segmented
// correction block (re-used from the MVP), and a Done button that the user
// presses when they're finished reviewing — that's what advances the
// conversation.
export default function UserBubble({
  result,
  nativeLanguage,
  showDone,
  onDone,
  onReCorrect,
  explainMini = false,
  improvedExplainPrompt = false,
}: UserBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(result.intended_meaning_native);

  function commitEdit() {
    if (!draft.trim()) return;
    setEditing(false);
    onReCorrect(draft.trim());
  }

  return (
    <div className="flex justify-end">
      <div className="w-full max-w-[92%] space-y-3">
        {/* Interpretation */}
        <div className="px-1">
          <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1 text-right">
            What I think you tried to say
          </p>
          {editing ? (
            <div className="space-y-1">
              <input
                autoFocus
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="w-full text-base text-neutral-900 bg-transparent border-b border-neutral-300 focus:border-neutral-600 focus:outline-none py-0.5 text-right"
              />
              <p className="text-xs text-neutral-400 text-right">
                Press Enter to re-correct · Esc to cancel
              </p>
            </div>
          ) : (
            <div className="flex items-baseline gap-2 justify-end">
              <button
                onClick={() => {
                  setDraft(result.intended_meaning_native);
                  setEditing(true);
                }}
                className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
              >
                Edit
              </button>
              <p className="text-base text-neutral-700">{result.intended_meaning_native}</p>
            </div>
          )}
        </div>

        {/* The correction itself */}
        <CorrectionBlock
          result={result}
          nativeLanguage={nativeLanguage}
          explainMini={explainMini}
          improvedExplainPrompt={improvedExplainPrompt}
        />

        {/* Done — only shown on the latest user bubble while AI hasn't replied */}
        {showDone && (
          <div className="flex justify-end pt-1">
            <button
              onClick={onDone}
              className="px-4 py-1.5 text-sm rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
