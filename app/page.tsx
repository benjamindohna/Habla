"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AudioRecorder from "@/components/AudioRecorder";
import CorrectionBlock from "@/components/CorrectionBlock";
import type { CorrectionResult } from "@/types/correction";

const NATIVE_LANGUAGES = ["English", "German", "Italian", "French", "Greek"] as const;
type NativeLanguage = (typeof NATIVE_LANGUAGES)[number];

type AppStatus =
  | { stage: "idle" }
  | { stage: "processing"; step: string; transcript?: string }
  | { stage: "done"; result: CorrectionResult }
  | { stage: "error"; message: string };

// ── API helpers ────────────────────────────────────────────────────────────

async function transcribeAudio(blob: Blob, nativeLanguage: NativeLanguage): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "recording.webm");
  form.append("nativeLanguage", nativeLanguage);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw new Error("Transcription failed");
  const { transcript } = await res.json();
  return transcript as string;
}

async function interpretTranscript(
  transcript: string,
  nativeLanguage: NativeLanguage,
): Promise<{ intended_meaning_native: string; confidence: string; notes_native: string }> {
  const res = await fetch("/api/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, nativeLanguage }),
  });
  if (!res.ok) throw new Error("Interpretation failed");
  return res.json();
}

async function localizeInterpretation(intendedMeaning: string): Promise<string> {
  const res = await fetch("/api/localize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intendedMeaning }),
  });
  if (!res.ok) throw new Error("Localization failed");
  const { local_version_es } = await res.json();
  return local_version_es as string;
}

async function segmentSentences(
  transcript: string,
  localVersionEs: string,
  nativeLanguage: NativeLanguage,
): Promise<import("@/types/correction").Pair[]> {
  const res = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, localVersionEs, nativeLanguage }),
  });
  if (!res.ok) throw new Error("Segmentation failed");
  const { pairs } = await res.json();
  return pairs;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Page() {
  const router = useRouter();
  const [status, setStatus] = useState<AppStatus>({ stage: "idle" });
  const [nativeLanguage, setNativeLanguage] = useState<NativeLanguage>("German");
  const [editingInterpretation, setEditingInterpretation] = useState(false);
  const [interpretationDraft, setInterpretationDraft] = useState("");

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function runPipeline(
    transcript: string,
    overrideInterpretation?: string,
  ) {
    try {
      // Step 2: interpret
      setStatus({ stage: "processing", step: "Interpreting…", transcript });
      const interpretation = overrideInterpretation
        ? { intended_meaning_native: overrideInterpretation, confidence: "high", notes_native: "" }
        : await interpretTranscript(transcript, nativeLanguage);

      // Step 3: localize
      setStatus({ stage: "processing", step: "Translating to Spanish…", transcript });
      const local_version_es = await localizeInterpretation(interpretation.intended_meaning_native);

      // Step 4: segment
      setStatus({ stage: "processing", step: "Comparing versions…", transcript });
      const pairs = await segmentSentences(transcript, local_version_es, nativeLanguage);

      const result: CorrectionResult = {
        transcript_raw: transcript,
        intended_meaning_native: interpretation.intended_meaning_native,
        local_version_es,
        confidence: interpretation.confidence as CorrectionResult["confidence"],
        notes_native: interpretation.notes_native,
        pairs,
      };

      setStatus({ stage: "done", result });
    } catch (err) {
      setStatus({ stage: "error", message: (err as Error).message });
    }
  }

  async function handleRecordingComplete(blob: Blob) {
    try {
      setStatus({ stage: "processing", step: "Transcribing audio…" });
      const transcript = await transcribeAudio(blob, nativeLanguage);
      await runPipeline(transcript);
    } catch (err) {
      setStatus({ stage: "error", message: (err as Error).message });
    }
  }

  async function handleReCorrect(transcript: string, overrideInterpretation: string) {
    setEditingInterpretation(false);
    await runPipeline(transcript, overrideInterpretation);
  }

  const isProcessing = status.stage === "processing";

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">

      {/* Top bar */}
      <div className="w-full max-w-xl flex items-center justify-between mb-12">
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

        <button
          onClick={handleLogout}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Main content */}
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

        {/* Processing status */}
        {status.stage === "processing" && (
          <div className="space-y-2 text-center">
            <StatusLine>{status.step}</StatusLine>
            {status.transcript && (
              <p className="text-sm text-neutral-400 italic">
                &ldquo;{status.transcript}&rdquo;
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {status.stage === "error" && (
          <p className="text-center text-sm text-red-500">{status.message}</p>
        )}

        {/* Result */}
        {status.stage === "done" && (
          <div className="w-full space-y-4">

            {/* Interpretation */}
            <div className="px-1">
              <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">
                What I think you tried to say
              </p>
              {editingInterpretation ? (
                <div className="space-y-1">
                  <input
                    autoFocus
                    type="text"
                    value={interpretationDraft}
                    onChange={(e) => setInterpretationDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && interpretationDraft.trim()) {
                        handleReCorrect(status.result.transcript_raw, interpretationDraft.trim());
                      }
                      if (e.key === "Escape") setEditingInterpretation(false);
                    }}
                    className="w-full text-base text-neutral-900 bg-transparent border-b border-neutral-300 focus:border-neutral-600 focus:outline-none py-0.5"
                  />
                  <p className="text-xs text-neutral-400">Press Enter to re-correct · Esc to cancel</p>
                </div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <p className="text-base text-neutral-600">
                    {status.result.intended_meaning_native}
                  </p>
                  <button
                    onClick={() => {
                      setInterpretationDraft(status.result.intended_meaning_native);
                      setEditingInterpretation(true);
                    }}
                    className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            {/* Corrected Spanish block */}
            <CorrectionBlock result={status.result} nativeLanguage={nativeLanguage} />

            <div className="flex justify-center">
              <button
                onClick={() => { setStatus({ stage: "idle" }); setEditingInterpretation(false); }}
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
