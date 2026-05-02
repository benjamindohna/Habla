"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AudioRecorder from "@/components/AudioRecorder";
import CorrectionBlock from "@/components/CorrectionBlock";
import TopicGrid from "@/components/TopicGrid";
import type { CorrectionResult } from "@/types/correction";

// Placeholder tiles for Phase 2. Phase 3 replaces these with LLM-generated topics.
const PLACEHOLDER_TOPICS = [
  "Football",
  "Cars",
  "Psychology",
  "Space",
  "Sci-fi novels",
  "Technology",
  "Music",
  "Travel",
  "Cooking",
];

interface Me {
  id: number;
  email: string;
  nativeLanguage: string;
  level: number;
  interests: string[];
  interestsText: string;
}

type AppMode = { kind: "home" } | { kind: "chat"; topic: string };

type AppStatus =
  | { stage: "idle" }
  | { stage: "processing"; step: string; transcript?: string }
  | { stage: "done"; result: CorrectionResult }
  | { stage: "error"; message: string };

// ── API helpers ────────────────────────────────────────────────────────────

async function transcribeAudio(blob: Blob, nativeLanguage: string): Promise<string> {
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
  nativeLanguage: string,
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
  nativeLanguage: string,
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
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<AppMode>({ kind: "home" });
  const [status, setStatus] = useState<AppStatus>({ stage: "idle" });
  const [editingInterpretation, setEditingInterpretation] = useState(false);
  const [interpretationDraft, setInterpretationDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load profile"))))
      .then((data: Me) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) router.push("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function enterChat(topic: string) {
    setStatus({ stage: "idle" });
    setEditingInterpretation(false);
    setMode({ kind: "chat", topic });
  }

  function backToHome() {
    setStatus({ stage: "idle" });
    setEditingInterpretation(false);
    setMode({ kind: "home" });
  }

  async function runPipeline(transcript: string, overrideInterpretation?: string) {
    if (!me) return;
    try {
      setStatus({ stage: "processing", step: "Interpreting…", transcript });
      const interpretation = overrideInterpretation
        ? { intended_meaning_native: overrideInterpretation, confidence: "high", notes_native: "" }
        : await interpretTranscript(transcript, me.nativeLanguage);

      setStatus({ stage: "processing", step: "Translating to Spanish…", transcript });
      const local_version_es = await localizeInterpretation(interpretation.intended_meaning_native);

      setStatus({ stage: "processing", step: "Comparing versions…", transcript });
      const pairs = await segmentSentences(transcript, local_version_es, me.nativeLanguage);

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
    if (!me) return;
    try {
      setStatus({ stage: "processing", step: "Transcribing audio…" });
      const transcript = await transcribeAudio(blob, me.nativeLanguage);
      await runPipeline(transcript);
    } catch (err) {
      setStatus({ stage: "error", message: (err as Error).message });
    }
  }

  async function handleReCorrect(transcript: string, overrideInterpretation: string) {
    setEditingInterpretation(false);
    await runPipeline(transcript, overrideInterpretation);
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  // ── Home mode ───────────────────────────────────────────────────────────
  if (mode.kind === "home") {
    const interestsLine = me.interestsText.trim() || me.interests.join(", ");
    return (
      <main className="flex min-h-screen flex-col items-center px-4 py-8">
        <div className="w-full max-w-xl flex items-center justify-end mb-12">
          <button
            onClick={handleLogout}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Sign out
          </button>
        </div>

        <div className="w-full max-w-xl flex flex-col items-center gap-8 flex-1">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Hola, ¿de qué quieres hablar hoy?
            </h1>
            {interestsLine && (
              <p className="text-xs text-neutral-400 italic">
                Tus intereses: {interestsLine}
              </p>
            )}
          </div>

          <TopicGrid topics={PLACEHOLDER_TOPICS} onSelect={enterChat} />

          <button
            onClick={() => { /* Phase 4 will wire re-roll */ }}
            disabled
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Re-roll comes in Phase 4"
          >
            Re-roll topics
          </button>
        </div>
      </main>
    );
  }

  // ── Chat mode (existing single-sentence flow as placeholder) ────────────
  const isProcessing = status.stage === "processing";

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="w-full max-w-xl flex items-center justify-between mb-12">
        <button
          onClick={backToHome}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          ← Back
        </button>
        <p className="text-xs text-neutral-500">{mode.topic}</p>
        <button
          onClick={handleLogout}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Sign out
        </button>
      </div>

      <div className="w-full max-w-xl flex flex-col items-center gap-8 flex-1 justify-center">
        <AudioRecorder onRecordingComplete={handleRecordingComplete} disabled={isProcessing} />

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

        {status.stage === "error" && (
          <p className="text-center text-sm text-red-500">{status.message}</p>
        )}

        {status.stage === "done" && (
          <div className="w-full space-y-4">
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

            <CorrectionBlock result={status.result} nativeLanguage={me.nativeLanguage} />

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
