"use client";

import { useEffect, useRef, useState } from "react";
import AudioRecorder from "./AudioRecorder";
import AIBubble from "./AIBubble";
import UserBubble from "./UserBubble";
import type { CorrectionResult, Pair } from "@/types/correction";

type CorrectionStyle = "natural" | "transcript_aware";

interface ConversationViewProps {
  topic: string;
  nativeLanguage: string;
  correctionStyle: CorrectionStyle;
  onBack: () => void;
  onLogout: () => void;
}

type Message =
  | { id: string; role: "ai"; text?: string; muted?: boolean; loading?: boolean }
  | { id: string; role: "user"; result: CorrectionResult; doneAt: number | null };

type PendingStatus =
  | { stage: "idle" }
  | { stage: "processing"; step: string; transcript?: string }
  | { stage: "error"; message: string };

// ── API helpers (same as the old single-sentence flow) ────────────────────

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

async function localizeInterpretation(
  intendedMeaning: string,
  transcript: string,
  nativeLanguage: string,
  style: CorrectionStyle,
): Promise<string> {
  const res = await fetch("/api/localize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intendedMeaning, transcript, nativeLanguage, style }),
  });
  if (!res.ok) throw new Error("Localization failed");
  const { local_version_es } = await res.json();
  return local_version_es as string;
}

async function segmentSentences(
  transcript: string,
  localVersionEs: string,
  nativeLanguage: string,
): Promise<Pair[]> {
  const res = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, localVersionEs, nativeLanguage }),
  });
  if (!res.ok) throw new Error("Segmentation failed");
  const { pairs } = await res.json();
  return pairs;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ConversationView({
  topic,
  nativeLanguage,
  correctionStyle,
  onBack,
  onLogout,
}: ConversationViewProps) {
  const openerIdRef = useRef<string>(crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: openerIdRef.current, role: "ai", loading: true },
  ]);
  const [pending, setPending] = useState<PendingStatus>({ stage: "idle" });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch the LLM-generated opener on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/converse/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load opener"))))
      .then((data: { text: string }) => {
        if (cancelled) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === openerIdRef.current && m.role === "ai"
              ? { ...m, text: data.text, loading: false }
              : m,
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === openerIdRef.current && m.role === "ai"
              ? { ...m, text: `(Couldn't load opener. Topic: ${topic})`, loading: false, muted: true }
              : m,
          ),
        );
      });
    return () => {
      cancelled = true;
    };
    // Deliberately runs once on mount — opener is per-conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to the bottom on every message append or status change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function runPipeline(
    transcript: string,
    overrideInterpretation?: string,
  ): Promise<CorrectionResult> {
    setPending({ stage: "processing", step: "Interpreting…", transcript });
    const interpretation = overrideInterpretation
      ? { intended_meaning_native: overrideInterpretation, confidence: "high", notes_native: "" }
      : await interpretTranscript(transcript, nativeLanguage);

    setPending({ stage: "processing", step: "Translating to Spanish…", transcript });
    const local_version_es = await localizeInterpretation(
      interpretation.intended_meaning_native,
      transcript,
      nativeLanguage,
      correctionStyle,
    );

    setPending({ stage: "processing", step: "Comparing versions…", transcript });
    const pairs = await segmentSentences(transcript, local_version_es, nativeLanguage);

    return {
      transcript_raw: transcript,
      intended_meaning_native: interpretation.intended_meaning_native,
      local_version_es,
      confidence: interpretation.confidence as CorrectionResult["confidence"],
      notes_native: interpretation.notes_native,
      pairs,
    };
  }

  async function handleRecordingComplete(blob: Blob) {
    try {
      setPending({ stage: "processing", step: "Transcribing audio…" });
      const transcript = await transcribeAudio(blob, nativeLanguage);
      const result = await runPipeline(transcript);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", result, doneAt: null },
      ]);
      setPending({ stage: "idle" });
    } catch (err) {
      setPending({ stage: "error", message: (err as Error).message });
    }
  }

  async function handleReCorrect(messageId: string, override: string) {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== "user") return;
    try {
      const result = await runPipeline(msg.result.transcript_raw, override);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === "user" ? { ...m, result } : m,
        ),
      );
      setPending({ stage: "idle" });
    } catch (err) {
      setPending({ stage: "error", message: (err as Error).message });
    }
  }

  function handleDone(messageId: string) {
    setMessages((prev) => {
      const updated = prev.map((m) =>
        m.id === messageId && m.role === "user" ? { ...m, doneAt: Date.now() } : m,
      );
      // Phase 6 stub — Phase 7 replaces this with the real /api/converse/turn call.
      return [
        ...updated,
        {
          id: crypto.randomUUID(),
          role: "ai",
          text: "(Phase 7 will generate a real reply here.)",
          muted: true,
        },
      ];
    });
  }

  // Only the latest user bubble (whose Done hasn't been clicked yet) shows the button.
  const latestUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const isProcessing = pending.stage === "processing";

  return (
    <main className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="w-full max-w-3xl mx-auto flex items-center justify-between px-4 py-3">
          <button
            onClick={onBack}
            className="text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            ← Back
          </button>
          <p className="text-sm font-medium text-neutral-700 truncate mx-4">{topic}</p>
          <button
            onClick={onLogout}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="w-full max-w-3xl mx-auto space-y-6">
          {messages.map((msg) =>
            msg.role === "ai" ? (
              <AIBubble key={msg.id} text={msg.text} muted={msg.muted} loading={msg.loading} />
            ) : (
              <UserBubble
                key={msg.id}
                result={msg.result}
                nativeLanguage={nativeLanguage}
                showDone={msg.id === latestUserMsg?.id && msg.doneAt === null}
                onDone={() => handleDone(msg.id)}
                onReCorrect={(override) => handleReCorrect(msg.id, override)}
              />
            ),
          )}

          {pending.stage === "processing" && (
            <div className="flex justify-end">
              <div className="text-xs text-neutral-400 italic flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
                <span>{pending.step}</span>
                {pending.transcript && (
                  <span className="text-neutral-300">· &ldquo;{pending.transcript}&rdquo;</span>
                )}
              </div>
            </div>
          )}

          {pending.stage === "error" && (
            <p className="text-center text-sm text-red-500">{pending.message}</p>
          )}
        </div>
      </div>

      {/* Recorder */}
      <div className="border-t border-neutral-200 bg-white">
        <div className="w-full max-w-3xl mx-auto px-4 py-4 flex justify-center">
          <AudioRecorder onRecordingComplete={handleRecordingComplete} disabled={isProcessing} />
        </div>
      </div>
    </main>
  );
}
