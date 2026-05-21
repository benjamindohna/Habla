"use client";

import CorrectionBlock from "./CorrectionBlock";
import InterpretationLine from "./InterpretationLine";
import type { CorrectionResult } from "@/types/correction";

interface UserBubbleProps {
  result: CorrectionResult;
  nativeLanguage: string;
  showDone: boolean;
  onDone: () => void;
  onReCorrect: (override: string) => void;
  /** Override forwarded to CorrectionBlock. undefined → server defaults. */
  explainMini?: boolean;
  /** Override forwarded to CorrectionBlock. undefined → server defaults. */
  improvedExplainPrompt?: boolean;
  /** When true, CorrectionBlock auto-plays the corrected sentence's TTS
   *  once preload finishes (Auto-Read toggle in the chat). */
  autoPlay?: boolean;
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
  explainMini,
  improvedExplainPrompt,
  autoPlay,
}: UserBubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="w-full max-w-[92%] space-y-3">
        <InterpretationLine
          interpretation={result.intended_meaning_native}
          onReCorrect={onReCorrect}
          nativeLanguage={nativeLanguage}
          align="right"
        />

        {/* The correction itself */}
        <CorrectionBlock
          result={result}
          nativeLanguage={nativeLanguage}
          explainMini={explainMini}
          improvedExplainPrompt={improvedExplainPrompt}
          autoPlay={autoPlay}
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
