"use client";

import { useState } from "react";
import AudioRecorder from "@/components/AudioRecorder";
import CorrectionBlock from "@/components/CorrectionBlock";
import type { CorrectionResult } from "@/types/correction";

const NATIVE_LANGUAGES = ["English", "German", "Italian", "French", "Greek"] as const;
type NativeLanguage = (typeof NATIVE_LANGUAGES)[number];


type AppStatus =
  | { stage: "idle" }
  | { stage: "transcribing" }
  | { stage: "correcting"; transcript: string }
  | { stage: "done"; result: CorrectionResult }
  | { stage: "error"; message: string };

async function transcribeAudio(blob: Blob, nativeLanguage: NativeLanguage): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "recording.webm");
  form.append("nativeLanguage", nativeLanguage);

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw new Error("Transcription failed");
  const { transcript } = await res.json();
  return transcript as string;
}

async function correctTranscript(transcript: string, nativeLanguage: NativeLanguage): Promise<CorrectionResult> {
  const res = await fetch("/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, nativeLanguage }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Correction failed");
  }
  return res.json() as Promise<CorrectionResult>;
}

export default function Page() {
  const [status, setStatus] = useState<AppStatus>({ stage: "idle" });
  const [nativeLanguage, setNativeLanguage] = useState<NativeLanguage>("German");

  async function handleRecordingComplete(blob: Blob) {
    try {
      setStatus({ stage: "transcribing" });
      const transcript = await transcribeAudio(blob, nativeLanguage);

      console.log("[transcript]", transcript);
      setStatus({ stage: "correcting", transcript });
      const result = await correctTranscript(transcript, nativeLanguage);

      setStatus({ stage: "done", result });
    } catch (err) {
      setStatus({ stage: "error", message: (err as Error).message });
    }
  }

  const isProcessing = status.stage === "transcribing" || status.stage === "correcting";

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">

      {/* Selectors — top center, minimal */}
      <div className="flex items-center gap-4 mb-12">
        <div className="flex items-center gap-2">
          <label htmlFor="lang-select" className="text-xs text-neutral-400">
            Native language
          </label>
          <select
            id="lang-select"
            value={nativeLanguage}
            onChange={(e) => setNativeLanguage(e.target.value as NativeLanguage)}
            className="text-xs text-neutral-500 bg-transparent border border-neutral-200 rounded px-2 py-1 focus:outline-none focus:border-neutral-400 cursor-pointer"
          >
            {NATIVE_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        </div>

      </div>

      {/* Main content — vertically centered */}
      <div className="w-full max-w-xl flex flex-col items-center gap-8 flex-1 justify-center">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Habla</h1>
          <p className="text-sm text-neutral-500">
            Speak in Spanish — mix in your language for words you don&rsquo;t know yet.
          </p>
        </div>

        {/* Recorder */}
        <AudioRecorder
          onRecordingComplete={handleRecordingComplete}
          disabled={isProcessing}
        />

        {/* Status feedback */}
        {status.stage === "transcribing" && (
          <StatusLine>Transcribing audio&hellip;</StatusLine>
        )}
        {status.stage === "correcting" && (
          <div className="space-y-2 text-center">
            <StatusLine>Correcting&hellip;</StatusLine>
            <p className="text-sm text-neutral-400 italic">
              &ldquo;{status.transcript}&rdquo;
            </p>
          </div>
        )}
        {status.stage === "error" && (
          <p className="text-center text-sm text-red-500">{status.message}</p>
        )}

        {/* Result */}
        {status.stage === "done" && (
          <div className="w-full space-y-4">

            {/* Interpretation in native language */}
            <div className="px-1">
              <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">
                What I think you tried to say
              </p>
              <p className="text-base text-neutral-600">
                {status.result.intended_meaning_native}
              </p>
            </div>

            {/* Corrected Spanish block */}
            <CorrectionBlock result={status.result} />

            <div className="flex justify-center">
              <button
                onClick={() => setStatus({ stage: "idle" })}
                className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}

function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-center text-sm text-neutral-400 flex items-center justify-center gap-2">
      <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
      {children}
    </p>
  );
}
