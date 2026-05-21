"use client";

// Free Input tab — proactive segment practice. User taps the mic,
// speaks a sentence they're trying to formulate, gets the full
// correction breakdown without any AI conversation. Each segment is
// tap-explainable (and the follow-up Q&A bar lives inside that
// explanation), exactly like in the chat correction flow.

import { useState } from "react";
import AudioRecorder from "@/components/AudioRecorder";
import CorrectionBlock from "@/components/CorrectionBlock";
import InterpretationLine from "@/components/InterpretationLine";
import { useMe } from "@/components/MeProvider";
import type { CorrectionResult } from "@/types/correction";

type CorrectionStyle = "natural" | "transcript_aware";

type Stage =
  | { kind: "ready"; result: CorrectionResult | null }
  | { kind: "transcribing" }
  | { kind: "correcting"; transcript: string }
  | { kind: "error"; message: string };

async function transcribeAudio(blob: Blob, nativeLanguage: string): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "recording.webm");
  form.append("nativeLanguage", nativeLanguage);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw new Error("Transcription failed");
  const { transcript } = await res.json();
  return transcript as string;
}

async function correctTranscript(args: {
  transcript: string;
  nativeLanguage: string;
  style: CorrectionStyle;
  overrideIntendedMeaning?: string;
}): Promise<CorrectionResult> {
  const res = await fetch("/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error("Correction failed");
  return res.json();
}

export default function FreeInputPage() {
  const me = useMe();
  const [stage, setStage] = useState<Stage>({ kind: "ready", result: null });

  async function handleRecordingComplete(blob: Blob) {
    try {
      setStage({ kind: "transcribing" });
      const transcript = await transcribeAudio(blob, me.nativeLanguage);
      setStage({ kind: "correcting", transcript });
      const result = await correctTranscript({
        transcript,
        nativeLanguage: me.nativeLanguage,
        style: me.correctionStyle,
      });
      setStage({ kind: "ready", result });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  // Re-run correction with the user's edited interpretation. Reuses the
  // raw transcript already on the result so we don't need to re-record;
  // the API skips the interpret step when overrideIntendedMeaning is set.
  async function handleReCorrect(override: string) {
    if (stage.kind !== "ready" || !stage.result) return;
    const transcript = stage.result.transcript_raw;
    setStage({ kind: "correcting", transcript });
    try {
      const result = await correctTranscript({
        transcript,
        nativeLanguage: me.nativeLanguage,
        style: me.correctionStyle,
        overrideIntendedMeaning: override,
      });
      setStage({ kind: "ready", result });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  function resetForNext() {
    setStage({ kind: "ready", result: null });
  }

  const isProcessing = stage.kind === "transcribing" || stage.kind === "correcting";

  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 min-h-full">
      <div className="w-full max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 mb-2 text-center">
          Frei sprechen
        </h1>
        <p className="text-sm text-neutral-500 text-center mb-8">
          Sprich einen Satz ein — bekomme sofort die korrekte Version mit Erklärung.
        </p>

        {stage.kind === "ready" && stage.result && (
          <div className="mb-6 space-y-3">
            <InterpretationLine
              interpretation={stage.result.intended_meaning_native}
              onReCorrect={handleReCorrect}
              nativeLanguage={me.nativeLanguage}
              align="left"
            />
            <CorrectionBlock
              result={stage.result}
              nativeLanguage={me.nativeLanguage}
            />
          </div>
        )}

        {stage.kind === "error" && (
          <div className="text-center text-sm text-rose-500 mb-6">{stage.message}</div>
        )}

        {isProcessing && (
          <div className="flex flex-col items-center gap-2 mb-6">
            <span className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-neutral-600 animate-spin" />
            <p className="text-xs text-neutral-500">
              {stage.kind === "transcribing" ? "Transkribiere…" : `Korrigiere: "${stage.transcript}"`}
            </p>
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <AudioRecorder
            onRecordingComplete={handleRecordingComplete}
            onRecordingStart={resetForNext}
            disabled={isProcessing}
          />
          {stage.kind === "ready" && stage.result && (
            <button
              onClick={resetForNext}
              className="text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              Neuer Satz
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
