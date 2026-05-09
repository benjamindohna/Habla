"use client";

import { useEffect, useRef, useState } from "react";
import AudioRecorder from "./AudioRecorder";
import AIBubble from "./AIBubble";
import UserBubble from "./UserBubble";
import SealedUserBubble from "./SealedUserBubble";
import type { CorrectionResult } from "@/types/correction";

type CorrectionStyle = "natural" | "transcript_aware";

export interface InitialMessage {
  id: number;
  role: "ai" | "user";
  textEs: string;
  // We don't reconstruct the full CorrectionResult for past user
  // turns; they render as SealedUserBubbles.
}

interface ConversationViewProps {
  conversationId: number;
  topic: string;
  initialMessages: InitialMessage[];
  nativeLanguage: string;
  correctionStyle: CorrectionStyle;
  onBack: () => void;
  onLogout: () => void;
}

type Message =
  | { id: string; role: "ai"; text?: string; muted?: boolean; loading?: boolean }
  | { id: string; role: "user-sealed"; textEs: string }
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

async function correctTranscript(args: {
  transcript: string;
  overrideIntendedMeaning?: string;
  nativeLanguage: string;
  style: CorrectionStyle;
}): Promise<CorrectionResult> {
  const res = await fetch("/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error("Correction failed");
  return res.json();
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ConversationView({
  conversationId,
  topic,
  initialMessages,
  nativeLanguage,
  correctionStyle,
  onBack,
  onLogout,
}: ConversationViewProps) {
  const [messages, setMessages] = useState<Message[]>(() =>
    initialMessages.map((m) =>
      m.role === "ai"
        ? ({ id: `seed-${m.id}`, role: "ai", text: m.textEs } as Message)
        : ({ id: `seed-${m.id}`, role: "user-sealed", textEs: m.textEs } as Message),
    ),
  );
  const [pending, setPending] = useState<PendingStatus>({ stage: "idle" });
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setPending({ stage: "processing", step: "Correcting…", transcript });
    return correctTranscript({
      transcript,
      overrideIntendedMeaning: overrideInterpretation,
      nativeLanguage,
      style: correctionStyle,
    });
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

  async function handleDone(messageId: string) {
    const userMsg = messages.find((m) => m.id === messageId);
    if (!userMsg || userMsg.role !== "user") return;

    // Mark this user bubble as Done (hides its Done button).
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === "user" ? { ...m, doneAt: Date.now() } : m,
      ),
    );

    // Append a loading AI bubble while we wait for the reply.
    const loadingId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: loadingId, role: "ai", loading: true }]);

    try {
      const res = await fetch("/api/converse/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          userTextEs: userMsg.result.local_version_es,
          userRaw: userMsg.result.transcript_raw,
          segments: userMsg.result.pairs,
        }),
      });
      if (!res.ok) throw new Error("Reply failed");
      const data = (await res.json()) as { text: string };
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId && m.role === "ai"
            ? { ...m, text: data.text, loading: false }
            : m,
        ),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId && m.role === "ai"
            ? {
                ...m,
                text: `(Couldn't load reply: ${(err as Error).message})`,
                loading: false,
                muted: true,
              }
            : m,
        ),
      );
    }
  }

  function handleBack() {
    // Fire-and-forget: harvest interests + invalidate the stale 'next' topic
    // set so future re-rolls reflect this conversation. User navigates home
    // immediately; if the network call lags or fails, no UX impact.
    fetch(`/api/conversations/${conversationId}/extract`, {
      method: "POST",
    }).catch(() => {});
    onBack();
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
            onClick={handleBack}
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
          {messages.map((msg) => {
            if (msg.role === "ai") {
              return (
                <AIBubble
                  key={msg.id}
                  text={msg.text}
                  muted={msg.muted}
                  loading={msg.loading}
                />
              );
            }
            if (msg.role === "user-sealed") {
              return <SealedUserBubble key={msg.id} textEs={msg.textEs} />;
            }
            return (
              <UserBubble
                key={msg.id}
                result={msg.result}
                nativeLanguage={nativeLanguage}
                showDone={msg.id === latestUserMsg?.id && msg.doneAt === null}
                onDone={() => handleDone(msg.id)}
                onReCorrect={(override) => handleReCorrect(msg.id, override)}
              />
            );
          })}

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
