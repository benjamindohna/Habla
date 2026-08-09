"use client";

// Free Input tab — proactive segment practice. User taps the mic,
// speaks a sentence they're trying to formulate, gets the full
// correction breakdown without any AI conversation. Each segment is
// tap-explainable (and the follow-up Q&A bar lives inside that
// explanation), exactly like in the chat correction flow.

import { useState } from "react";
import ChatInputBar from "@/components/ChatInputBar";
import CorrectionBlock from "@/components/CorrectionBlock";
import InterpretationLine from "@/components/InterpretationLine";
import { useMe } from "@/components/MeProvider";
import { correctTranscriptStream } from "@/lib/sseClient";
import type { CorrectionResult } from "@/types/correction";

type CorrectionStyle = "natural" | "transcript_aware";

type Stage =
  | { kind: "ready"; result: CorrectionResult | null }
  | { kind: "transcribing" }
  | { kind: "correcting"; transcript: string; interpretation: string | null; localized: string }
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

export default function FreeInputPage() {
  const me = useMe();
  const [stage, setStage] = useState<Stage>({ kind: "ready", result: null });

  async function handleRecordingComplete(blob: Blob) {
    try {
      setStage({ kind: "transcribing" });
      const transcript = await transcribeAudio(blob, me.nativeLanguage);
      await runInput(transcript);
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  // Text mode: typed input skips ASR and goes straight into the same
  // streaming correction pipeline.
  async function handleTextSubmit(text: string) {
    try {
      await runInput(text);
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  async function runInput(transcript: string) {
    setStage({ kind: "correcting", transcript, interpretation: null, localized: "" });
    const result = await correctTranscriptStream(
      {
        transcript,
        nativeLanguage: me.nativeLanguage,
        style: me.correctionStyle,
      },
      {
        onInterpretation: (t) =>
          setStage((s) => (s.kind === "correcting" ? { ...s, interpretation: t } : s)),
        onLocalizeDelta: (delta) =>
          setStage((s) => (s.kind === "correcting" ? { ...s, localized: s.localized + delta } : s)),
      },
    );
    setStage({ kind: "ready", result });
  }

  // Re-run correction with the user's edited interpretation. Reuses the
  // raw transcript already on the result so we don't need to re-record;
  // the API skips the interpret step when overrideIntendedMeaning is set.
  async function handleReCorrect(override: string) {
    if (stage.kind !== "ready" || !stage.result) return;
    const transcript = stage.result.transcript_raw;
    setStage({ kind: "correcting", transcript, interpretation: override, localized: "" });
    try {
      const result = await correctTranscriptStream(
        {
          transcript,
          nativeLanguage: me.nativeLanguage,
          style: me.correctionStyle,
          overrideIntendedMeaning: override,
        },
        {
          onLocalizeDelta: (delta) =>
            setStage((s) => (s.kind === "correcting" ? { ...s, localized: s.localized + delta } : s)),
        },
      );
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
          Sprich oder tippe einen Satz — bekomme sofort die korrekte Version mit Erklärung.
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

        {stage.kind === "transcribing" && (
          <div className="flex flex-col items-center gap-2 mb-6">
            <span className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-neutral-600 animate-spin" />
            <p className="text-xs text-neutral-500">Transkribiere…</p>
          </div>
        )}

        {stage.kind === "correcting" && (
          <div className="mb-6 space-y-3">
            {stage.interpretation ? (
              <p className="text-xs text-neutral-400 italic">{stage.interpretation}</p>
            ) : (
              <p className="text-xs text-neutral-400 italic inline-flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin" />
                Verstehe: &bdquo;{stage.transcript}&ldquo;
              </p>
            )}
            {stage.localized && (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-base leading-relaxed text-neutral-900">
                <span className="whitespace-pre-wrap">{stage.localized}</span>
                <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-emerald-400 animate-pulse ml-0.5" />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <div className="w-full max-w-xl">
            <ChatInputBar
              onSubmitText={handleTextSubmit}
              onRecordingComplete={handleRecordingComplete}
              onRecordingStart={resetForNext}
              disabled={isProcessing}
            />
          </div>
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
