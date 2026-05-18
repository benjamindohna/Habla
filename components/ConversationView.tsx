"use client";

import { useEffect, useRef, useState } from "react";
import AudioRecorder from "./AudioRecorder";
import AIBubble from "./AIBubble";
import UserBubble from "./UserBubble";
import SealedUserBubble from "./SealedUserBubble";
import type { Topic } from "./TopicGrid";
import { pickGreetingVerb } from "@/lib/greetingVerb";
import type { CorrectionResult } from "@/types/correction";

interface TopicWithKind extends Topic {
  kind: "match" | "related" | "random";
}

type CorrectionStyle = "natural" | "transcript_aware";

export interface InitialMessage {
  id: number;
  role: "ai" | "user";
  textTarget: string;
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
  | { id: string; role: "ai"; text?: string; muted?: boolean; loading?: boolean; isFresh?: boolean }
  | { id: string; role: "user-sealed"; textTarget: string }
  | { id: string; role: "user"; result: CorrectionResult; doneAt: number | null; isFresh?: boolean };

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
  topic: initialTopic,
  initialMessages,
  nativeLanguage,
  correctionStyle,
  onBack,
  onLogout,
}: ConversationViewProps) {
  const [messages, setMessages] = useState<Message[]>(() =>
    initialMessages.map((m) =>
      m.role === "ai"
        ? ({ id: `seed-${m.id}`, role: "ai", text: m.textTarget } as Message)
        : ({ id: `seed-${m.id}`, role: "user-sealed", textTarget: m.textTarget } as Message),
    ),
  );
  const [pending, setPending] = useState<PendingStatus>({ stage: "idle" });
  const [topic, setTopic] = useState<string>(initialTopic ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Empty-chat state: the conversation has no messages yet. Drives the
  // inline topic picker visibility and the empty-state placeholder.
  // Recomputed whenever messages change — once an AI opener arrives or
  // the user records anything, the picker disappears.
  const isEmpty = messages.length === 0;

  // Greeting verb rotates per empty-chat instance. Picked once on
  // mount (client-only so localStorage rotation works and we avoid SSR
  // mismatch), then stable for the lifetime of this view.
  const [greetingVerb, setGreetingVerb] = useState<string | null>(null);
  useEffect(() => {
    if (isEmpty && greetingVerb === null) {
      setGreetingVerb(pickGreetingVerb());
    }
  }, [isEmpty, greetingVerb]);

  // Inline topic picker (visible only while the chat is empty).
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [topics, setTopics] = useState<TopicWithKind[] | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [rerolling, setRerolling] = useState(false);
  const [pickingTopic, setPickingTopic] = useState<string | null>(null);

  // Pre-load topics as soon as we know the chat is empty — the
  // /api/topics/current endpoint is a plain DB read against the
  // already-rotated `current` set (the `next` set is also pre-
  // generated server-side, so re-roll is also instant). By the time
  // the user taps "Thema ▴" the array is already in state, so the
  // picker opens with content, not a spinner.
  useEffect(() => {
    if (!isEmpty || topics !== null) return;
    let cancelled = false;
    fetch("/api/topics/current")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load topics"))))
      .then((data: { topics: TopicWithKind[] }) => {
        if (!cancelled) setTopics(data.topics);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setTopics([]);
          setTopicsError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isEmpty, topics]);

  async function handleReroll() {
    if (rerolling) return;
    setRerolling(true);
    setTopicsError(null);
    try {
      const res = await fetch("/api/topics/reroll", { method: "POST" });
      if (!res.ok) throw new Error("Re-roll failed");
      const data = (await res.json()) as { topics: TopicWithKind[] };
      setTopics(data.topics);
    } catch (err) {
      setTopicsError((err as Error).message);
    } finally {
      setRerolling(false);
    }
  }

  async function handleTopicPick(picked: Topic) {
    if (pickingTopic || !isEmpty) return;
    setPickingTopic(picked.target);
    // Fire-and-forget interest harvest, matches the old homepage flow.
    fetch("/api/me/interests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interest: picked.target }),
    }).catch(() => {});
    try {
      const res = await fetch("/api/converse/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, topic: picked.target }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { conversationId: number; text: string };
      setTopic(picked.target);
      setMessages([
        { id: crypto.randomUUID(), role: "ai", text: data.text, isFresh: true },
      ]);
      setTopicPickerOpen(false);
    } catch (err) {
      console.error("[handleTopicPick]", err);
    } finally {
      setPickingTopic(null);
    }
  }

  // Auto-Read toggle: when on, every fresh AI bubble auto-plays its TTS
  // when preload finishes, and every fresh user bubble auto-plays the
  // corrected sentence. Persisted in localStorage so the preference
  // survives across sessions. "Fresh" means added during this mount —
  // bubbles loaded from DB on /chat/[id] navigation don't auto-play.
  const [autoRead, setAutoRead] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setAutoRead(window.localStorage.getItem("autoRead") === "1");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("autoRead", autoRead ? "1" : "0");
  }, [autoRead]);

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
        { id: crypto.randomUUID(), role: "user", result, doneAt: null, isFresh: true },
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
    setMessages((prev) => [...prev, { id: loadingId, role: "ai", loading: true, isFresh: true }]);

    try {
      const res = await fetch("/api/converse/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          userTextTarget: userMsg.result.local_version_target,
          userRaw: userMsg.result.transcript_raw,
          segments: userMsg.result.pairs,
        }),
      });
      if (!res.ok) throw new Error("Reply failed");
      const data = (await res.json()) as { text: string; derivedTopic?: string };
      if (data.derivedTopic) setTopic(data.derivedTopic);
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
    if (isEmpty) {
      // User abandoned an empty chat — delete the row so it doesn't
      // pollute history. Fire-and-forget; navigation happens immediately
      // either way. Server-side guards prevent deletion of non-empty
      // chats, so a race between this and a just-sent message is safe.
      fetch(`/api/conversations/${conversationId}`, { method: "DELETE" }).catch(() => {});
    } else {
      // Non-empty chat: harvest interests + invalidate the stale 'next'
      // topic set so future re-rolls reflect this conversation.
      fetch(`/api/conversations/${conversationId}/extract`, {
        method: "POST",
      }).catch(() => {});
    }
    onBack();
  }

  // Only the latest user bubble (whose Done hasn't been clicked yet) shows the button.
  const latestUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const isProcessing = pending.stage === "processing";

  return (
    <main className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="w-full max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <button
            onClick={handleBack}
            className="text-sm text-neutral-500 hover:text-neutral-800 transition-colors shrink-0"
          >
            ← Back
          </button>
          <p className="text-sm font-medium text-neutral-700 truncate flex-1 text-center">
            {topic || "Neuer Chat"}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setAutoRead((v) => !v)}
              className={
                "text-xs transition-colors inline-flex items-center gap-1 " +
                (autoRead
                  ? "text-emerald-600 hover:text-emerald-700"
                  : "text-neutral-400 hover:text-neutral-600")
              }
              title={autoRead ? "Auto-Read on — click to disable" : "Auto-Read off — click to enable"}
            >
              <span aria-hidden="true">{autoRead ? "🔊" : "🔇"}</span>
              <span>Auto-Read</span>
            </button>
            <button
              onClick={onLogout}
              className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-10 pb-6">
        <div className="w-full max-w-3xl mx-auto space-y-6">
          {isEmpty && greetingVerb && (
            <div className="flex flex-col items-center justify-center pt-16">
              <h1 className="text-2xl font-semibold tracking-tight text-center text-neutral-800">
                Hola, ¿de qué quieres {greetingVerb} hoy?
              </h1>
              <p className="mt-3 text-sm text-neutral-400 text-center">
                Sprich einfach drauflos oder wähle ein Thema.
              </p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "ai") {
              return (
                <AIBubble
                  key={msg.id}
                  text={msg.text}
                  muted={msg.muted}
                  loading={msg.loading}
                  autoPlay={autoRead && !!msg.isFresh}
                />
              );
            }
            if (msg.role === "user-sealed") {
              return <SealedUserBubble key={msg.id} textTarget={msg.textTarget} />;
            }
            // User turn that's already been Done'd → collapse the rich
            // correction view into a sealed bubble. The full view stays
            // only for the latest unfinished user turn.
            if (msg.doneAt !== null) {
              return (
                <SealedUserBubble key={msg.id} textTarget={msg.result.local_version_target} />
              );
            }
            return (
              <UserBubble
                key={msg.id}
                result={msg.result}
                nativeLanguage={nativeLanguage}
                showDone={msg.id === latestUserMsg?.id && msg.doneAt === null}
                onDone={() => handleDone(msg.id)}
                onReCorrect={(override) => handleReCorrect(msg.id, override)}
                autoPlay={autoRead && !!msg.isFresh}
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

      {/* Recorder + (when empty) topic-button → compact bubble picker */}
      <div className="border-t border-neutral-200 bg-white">
        <div className="w-full max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-3">
            <AudioRecorder
              onRecordingComplete={handleRecordingComplete}
              disabled={isProcessing || pickingTopic !== null}
            />
            {isEmpty && (
              <div className="relative">
                <button
                  onClick={() => setTopicPickerOpen((v) => !v)}
                  disabled={pickingTopic !== null}
                  className="text-sm text-neutral-600 hover:text-neutral-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400"
                >
                  <span>Thema</span>
                  <span aria-hidden="true" className="text-xs">
                    {topicPickerOpen ? "▾" : "▴"}
                  </span>
                </button>

                {/* Speech-bubble picker anchored to the Thema button. The
                    tail is drawn with two stacked triangles (outer = border
                    colour, inner = bg) so the border shows through. */}
                {topicPickerOpen && (
                  <div
                    className="absolute bottom-full right-0 mb-3 z-20 w-72 rounded-xl border border-neutral-200 bg-white shadow-lg p-3"
                    role="dialog"
                    aria-label="Themen-Empfehlungen"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] uppercase tracking-wider text-neutral-400">
                        Themen
                      </p>
                      <button
                        onClick={handleReroll}
                        disabled={topics === null || rerolling}
                        className="text-[11px] text-neutral-500 hover:text-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {rerolling ? "…" : "Re-roll"}
                      </button>
                    </div>
                    {topics === null ? (
                      <p className="text-xs text-neutral-400 py-2 text-center">Lade…</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        {topics.slice(0, 9).map((t) => (
                          <button
                            key={t.target}
                            onClick={() => handleTopicPick(t)}
                            disabled={pickingTopic !== null || rerolling}
                            title={t.target}
                            className="aspect-square rounded-md border border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 transition-colors text-[10px] leading-tight text-neutral-700 px-1.5 py-1 flex items-center justify-center text-center disabled:opacity-40 disabled:cursor-not-allowed line-clamp-4"
                          >
                            {t.target}
                          </button>
                        ))}
                      </div>
                    )}
                    {topicsError && (
                      <p className="mt-2 text-[10px] text-red-500">{topicsError}</p>
                    )}
                    {pickingTopic && (
                      <p className="mt-2 text-[10px] text-neutral-400 truncate">
                        Starte Chat…
                      </p>
                    )}

                    {/* Tail: 8px triangle, outline + inner fill so it
                        matches the bubble's border. Positioned right-side
                        to point at the Thema button below. */}
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-[7px] right-6 w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-neutral-200"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-[6px] right-6 w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-white"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
