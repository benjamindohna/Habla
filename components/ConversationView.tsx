"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ChatInputBar from "./ChatInputBar";
import AIBubble from "./AIBubble";
import UserBubble from "./UserBubble";
import SealedUserBubble from "./SealedUserBubble";
import type { Topic } from "./TopicGrid";
import { pickGreeting } from "@/lib/greetingVerb";
import { correctTranscriptStream, readReplyStream } from "@/lib/sseClient";
import type { TargetLanguageSpec } from "@/lib/targetLanguage";
import type { CorrectionResult } from "@/types/correction";

interface TopicWithKind extends Topic {
  kind: "match" | "related" | "random";
}

type CorrectionStyle = "natural" | "transcript_aware";

/** Experiment-only per-call model overrides (BENCH_MODELS ids). Unset
 *  fields run on the production model. Only the mix-chat playground
 *  passes this; the normal chat never sets it. */
export interface ModelMix {
  interpret?: string;
  localize?: string;
  segment?: string;
  reply?: string;
}

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
  targetLanguage: TargetLanguageSpec;
  correctionStyle: CorrectionStyle;
  modelMix?: ModelMix;
  onBack: () => void;
  onLogout: () => void;
}

type Message =
  | { id: string; role: "ai"; text?: string; muted?: boolean; loading?: boolean; isFresh?: boolean; streaming?: boolean }
  | { id: string; role: "user-sealed"; textTarget: string }
  | { id: string; role: "user"; result: CorrectionResult; doneAt: number | null; isFresh?: boolean }
  // Progressive user turn while the correction streams in: interpretation
  // appears first, then the corrected text token by token. Replaced by a
  // full "user" message once the result (incl. pairs) lands.
  | { id: string; role: "user-pending"; transcript: string; interpretation: string | null; localized: string };

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
  modelMix?: ModelMix;
}): Promise<CorrectionResult> {
  const res = await fetch("/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error("Correction failed");
  return res.json();
}

// ── Streaming user bubble ─────────────────────────────────────────────────
// Progressive right-aligned bubble while the correction streams: the
// interpretation line lands first (native language, small), then the
// corrected target-language text grows token by token. Swapped for the
// full UserBubble once pairs arrive.

function StreamingUserBubble({
  interpretation,
  localized,
}: {
  interpretation: string | null;
  localized: string;
}) {
  return (
    <div className="flex justify-end">
      <div className="w-full max-w-[92%] space-y-2">
        <div className="flex justify-end">
          {interpretation ? (
            <p className="text-xs text-neutral-400 italic text-right">{interpretation}</p>
          ) : (
            <p className="text-xs text-neutral-300 italic inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin" />
              Verstehe…
            </p>
          )}
        </div>
        {localized && (
          <div className="flex justify-end">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-base leading-relaxed text-neutral-900">
              <span className="whitespace-pre-wrap">{localized}</span>
              <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-emerald-400 animate-pulse ml-0.5" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ConversationView({
  conversationId,
  topic: initialTopic,
  initialMessages,
  nativeLanguage,
  targetLanguage,
  correctionStyle,
  modelMix,
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
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    if (isEmpty && greeting === null) {
      setGreeting(pickGreeting(targetLanguage).sentence);
    }
  }, [isEmpty, greeting, targetLanguage]);

  // Inline topic picker (visible only while the chat is empty).
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [topics, setTopics] = useState<TopicWithKind[] | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [rerolling, setRerolling] = useState(false);
  const [pickingTopic, setPickingTopic] = useState<string | null>(null);

  // Viewport-aware positioning for the picker bubble. The Thema button
  // sits to the right of the recorder, so naïvely centering a 288px
  // picker over it pushes the right edge off-screen on narrow phones.
  // We measure on open, clamp the picker into the viewport with a
  // small margin, and slide the tail so it still points at the
  // button's center.
  const themaButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pickerOffset, setPickerOffset] = useState<{ left: number; tailLeftPercent: number } | null>(null);

  useLayoutEffect(() => {
    if (!topicPickerOpen) {
      setPickerOffset(null);
      return;
    }
    function reposition() {
      const btn = themaButtonRef.current;
      if (!btn) return;
      const PICKER_WIDTH = 288; // w-72
      const SCREEN_PADDING = 12;
      const rect = btn.getBoundingClientRect();
      const buttonCenterX = rect.left + rect.width / 2;
      const viewportWidth = window.innerWidth;

      let desiredLeft = buttonCenterX - PICKER_WIDTH / 2;
      const maxLeft = viewportWidth - PICKER_WIDTH - SCREEN_PADDING;
      const minLeft = SCREEN_PADDING;
      if (desiredLeft > maxLeft) desiredLeft = maxLeft;
      if (desiredLeft < minLeft) desiredLeft = minLeft;

      // The picker is positioned inside the button's `relative` wrapper,
      // so we convert from viewport-x to button-wrapper-relative offset.
      const leftRelativeToWrapper = desiredLeft - rect.left;
      const tailLeftPx = buttonCenterX - desiredLeft;
      const tailLeftPercent = Math.max(8, Math.min(92, (tailLeftPx / PICKER_WIDTH) * 100));
      setPickerOffset({ left: leftRelativeToWrapper, tailLeftPercent });
    }
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [topicPickerOpen]);

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
        body: JSON.stringify({
          conversationId,
          topic: picked.target,
          stream: true,
          ...(modelMix?.reply ? { replyModel: modelMix.reply } : {}),
        }),
      });
      const openerId = crypto.randomUUID();
      setTopic(picked.target);
      setTopicPickerOpen(false);
      setMessages([{ id: openerId, role: "ai", loading: true, isFresh: true }]);
      setPickingTopic(null);
      const data = await readReplyStream(res, (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === openerId && m.role === "ai"
              ? { ...m, text: (m.text ?? "") + delta, loading: false, streaming: true }
              : m,
          ),
        );
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === openerId && m.role === "ai"
            ? { ...m, text: data.text, loading: false, streaming: false }
            : m,
        ),
      );
    } catch (err) {
      console.error("[handleTopicPick]", err);
      // If the opener bubble was already appended, surface the failure
      // there instead of leaving an eternal loading bubble.
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "ai" && (m.loading || m.streaming)
            ? { ...m, text: `(Konnte den Chat nicht starten: ${(err as Error).message})`, loading: false, streaming: false, muted: true }
            : m,
        ),
      );
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
      modelMix,
    });
  }

  async function handleRecordingComplete(blob: Blob) {
    try {
      setPending({ stage: "processing", step: "Transcribing audio…" });
      const transcript = await transcribeAudio(blob, nativeLanguage);
      await runInput(transcript);
    } catch (err) {
      setPending({ stage: "error", message: (err as Error).message });
    }
  }

  // Text mode: the typed string IS the transcript — no ASR step. Same
  // correction pipeline downstream (typos and mixed-language input need
  // interpret/localize/segment exactly like spoken input does).
  async function handleTextSubmit(text: string) {
    try {
      await runInput(text);
    } catch (err) {
      setPending({ stage: "error", message: (err as Error).message });
    }
  }

  async function runInput(transcript: string) {
      // Playground model-mix runs stay on the buffered endpoint (the
      // stream route has no bench overrides). Normal chats stream.
      if (modelMix && (modelMix.interpret || modelMix.localize || modelMix.segment)) {
        const result = await runPipeline(transcript);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", result, doneAt: null, isFresh: true },
        ]);
        setPending({ stage: "idle" });
        return;
      }

      // Streaming path: show a progressive bubble immediately and fill it
      // as interpretation + corrected text arrive; swap in the full
      // correction view once pairs land.
      const pendingId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: pendingId, role: "user-pending", transcript, interpretation: null, localized: "" },
      ]);
      setPending({ stage: "idle" });
      const patchPending = (patch: Partial<Extract<Message, { role: "user-pending" }>>) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === pendingId && m.role === "user-pending" ? { ...m, ...patch } : m)),
        );
      try {
        const result = await correctTranscriptStream(
          { transcript, nativeLanguage, style: correctionStyle },
          {
            onInterpretation: (t) => patchPending({ interpretation: t }),
            onLocalizeDelta: (delta) =>
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === pendingId && m.role === "user-pending"
                    ? { ...m, localized: m.localized + delta }
                    : m,
                ),
              ),
          },
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { id: pendingId, role: "user", result, doneAt: null, isFresh: true }
              : m,
          ),
        );
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== pendingId));
        throw err;
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
          stream: true,
          ...(modelMix?.reply ? { replyModel: modelMix.reply } : {}),
        }),
      });
      const data = await readReplyStream(res, (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId && m.role === "ai"
              ? { ...m, text: (m.text ?? "") + delta, loading: false, streaming: true }
              : m,
          ),
        );
      });
      if (data.derivedTopic) setTopic(data.derivedTopic);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId && m.role === "ai"
            ? { ...m, text: data.text, loading: false, streaming: false }
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
          {isEmpty && greeting && (
            <div className="flex flex-col items-center justify-center pt-16">
              <h1 className="text-2xl font-semibold tracking-tight text-center text-neutral-800">
                {greeting}
              </h1>
              <p className="mt-3 text-sm text-neutral-400 text-center">
                Sprich oder schreib einfach drauflos — oder wähle ein Thema.
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
                  streaming={msg.streaming}
                  autoPlay={autoRead && !!msg.isFresh}
                />
              );
            }
            if (msg.role === "user-sealed") {
              return <SealedUserBubble key={msg.id} textTarget={msg.textTarget} />;
            }
            if (msg.role === "user-pending") {
              return (
                <StreamingUserBubble
                  key={msg.id}
                  interpretation={msg.interpretation}
                  localized={msg.localized}
                />
              );
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
          <div className="flex items-end justify-center gap-2">
            <div className="flex-1 max-w-xl">
              <ChatInputBar
                onSubmitText={handleTextSubmit}
                onRecordingComplete={handleRecordingComplete}
                disabled={isProcessing || pickingTopic !== null}
              />
            </div>
            {isEmpty && (
              <div className="relative">
                <button
                  ref={themaButtonRef}
                  onClick={() => setTopicPickerOpen((v) => !v)}
                  disabled={pickingTopic !== null}
                  className="text-sm text-neutral-600 hover:text-neutral-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400"
                >
                  <span>Thema</span>
                  <span aria-hidden="true" className="text-xs">
                    {topicPickerOpen ? "▾" : "▴"}
                  </span>
                </button>

                {/* Speech-bubble picker. Default position centres over the
                    Thema button; on narrow viewports the useLayoutEffect
                    above measures the button + viewport and clamps the
                    picker into the screen with a 12px margin, then nudges
                    the tail (via tailLeftPercent) so it still points at the
                    button's centre. The visibility/transition guard keeps
                    the picker invisible during the first measurement so
                    there's no flash of wrong position. */}
                {topicPickerOpen && (
                  <div
                    className="absolute bottom-full mb-3 z-20 w-72 rounded-xl border border-neutral-200 bg-white shadow-lg p-3"
                    role="dialog"
                    aria-label="Themen-Empfehlungen"
                    style={pickerOffset
                      ? { left: `${pickerOffset.left}px` }
                      : { visibility: "hidden", left: 0 }}
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
                            className="group aspect-square rounded-md border border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 transition-colors text-[10px] leading-tight px-1.5 py-1 flex items-center justify-center text-center disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <span className="line-clamp-4 text-neutral-700 group-hover:hidden">
                              {t.target}
                            </span>
                            <span className="hidden line-clamp-4 text-neutral-400 italic group-hover:inline">
                              {t.native}
                            </span>
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
                        matches the bubble's border. left% is set
                        dynamically so the tail tracks the Thema button
                        even when the bubble has been clamped sideways. */}
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-[7px] -translate-x-1/2 w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-neutral-200"
                      style={{ left: `${pickerOffset?.tailLeftPercent ?? 50}%` }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-white"
                      style={{ left: `${pickerOffset?.tailLeftPercent ?? 50}%` }}
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
