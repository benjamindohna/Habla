"use client";

// The "What I think you tried to say" line that sits above the segmented
// correction. The learner has two ways to fix our interpretation:
//
//   ✏️ Pencil → opens a wrapping textarea with Abbrechen / Fertig
//   🎙️ Mic   → records the learner speaking the intended meaning in
//             their native language; the transcript replaces the
//             interpretation and triggers re-correction
//
// While recording, the previous interpretation stays visible above the
// recording control so the learner can read it as reference and only
// rephrase the part that was wrong. Both edit modes converge on a single
// onReCorrect(override) callback that the parent forwards to /api/correct
// as overrideIntendedMeaning.
//
// Alignment is configurable: chat user bubbles right-align, the Frei
// page left-aligns to match its centred single-column layout.

import { useEffect, useRef, useState } from "react";

interface InterpretationLineProps {
  interpretation: string;
  onReCorrect: (override: string) => void;
  /** User's native language — passed to /api/transcribe so Whisper
   *  knows what to expect when the user re-speaks the meaning. */
  nativeLanguage: string;
  align?: "left" | "right";
}

type Mode =
  | { kind: "view" }
  | { kind: "editing" }
  | { kind: "recording" }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

export default function InterpretationLine({
  interpretation,
  onReCorrect,
  nativeLanguage,
  align = "right",
}: InterpretationLineProps) {
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [draft, setDraft] = useState(interpretation);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Keep the displayed text in sync with re-corrected interpretations
  // from the server — but only when not actively editing, so a
  // background result update doesn't clobber the user's draft.
  useEffect(() => {
    if (mode.kind !== "editing") setDraft(interpretation);
  }, [interpretation, mode.kind]);

  function commitTextEdit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setMode({ kind: "view" });
    if (trimmed !== interpretation.trim()) {
      onReCorrect(trimmed);
    }
  }

  function cancelTextEdit() {
    setDraft(interpretation);
    setMode({ kind: "view" });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await transcribeAndCommit(blob);
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setMode({ kind: "recording" });
    } catch (err) {
      setMode({ kind: "error", message: (err as Error).message || "Microphone unavailable" });
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setMode({ kind: "transcribing" });
  }

  async function transcribeAndCommit(blob: Blob) {
    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      form.append("nativeLanguage", nativeLanguage);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error("Transcription failed");
      const { transcript } = (await res.json()) as { transcript: string };
      const trimmed = (transcript ?? "").trim();
      if (!trimmed) {
        setMode({ kind: "error", message: "Empty transcript" });
        return;
      }
      setMode({ kind: "view" });
      if (trimmed !== interpretation.trim()) {
        onReCorrect(trimmed);
      }
    } catch (err) {
      setMode({ kind: "error", message: (err as Error).message });
    }
  }

  const alignText = align === "right" ? "text-right" : "text-left";
  const justifyEnd = align === "right" ? "justify-end" : "justify-start";

  return (
    <div className="px-1">
      <p className={`text-xs text-neutral-400 uppercase tracking-wide mb-1 ${alignText}`}>
        What I think you tried to say
      </p>

      {/* The interpretation text stays visible in every mode except the
          text-edit textarea — including while recording, so the learner
          can use it as a reference for what to rephrase. */}
      {mode.kind !== "editing" && (
        <div className={`flex items-baseline gap-2 ${justifyEnd}`}>
          {align === "right" && (
            <ButtonStack
              mode={mode}
              onPencil={() => setMode({ kind: "editing" })}
              onMicStart={startRecording}
              onMicStop={stopRecording}
            />
          )}
          <p className="text-base text-neutral-700">{interpretation}</p>
          {align === "left" && (
            <ButtonStack
              mode={mode}
              onPencil={() => setMode({ kind: "editing" })}
              onMicStart={startRecording}
              onMicStop={stopRecording}
            />
          )}
        </div>
      )}

      {mode.kind === "editing" && (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelTextEdit();
            }}
            className="w-full text-base text-neutral-900 bg-white border border-neutral-300 rounded-lg p-3 leading-relaxed focus:border-neutral-600 focus:outline-none resize-none"
          />
          <div className={`flex gap-2 ${justifyEnd}`}>
            <button
              onClick={cancelTextEdit}
              className="text-xs text-neutral-500 hover:text-neutral-800 px-2 py-1.5 transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={commitTextEdit}
              disabled={!draft.trim() || draft.trim() === interpretation.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Fertig
            </button>
          </div>
        </div>
      )}

      {mode.kind === "transcribing" && (
        <p className={`text-xs text-neutral-400 mt-1 flex items-center gap-1.5 ${justifyEnd} flex`}>
          <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
          Transkribiere…
        </p>
      )}

      {mode.kind === "error" && (
        <p className={`text-xs text-rose-500 mt-1 ${alignText}`}>{mode.message}</p>
      )}
    </div>
  );
}

interface ButtonStackProps {
  mode: Mode;
  onPencil: () => void;
  onMicStart: () => void;
  onMicStop: () => void;
}

function ButtonStack({ mode, onPencil, onMicStart, onMicStop }: ButtonStackProps) {
  const recording = mode.kind === "recording";
  const busy = mode.kind === "transcribing";

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={onPencil}
        disabled={recording || busy}
        aria-label="Edit interpretation as text"
        title="Edit as text"
        className="p-1.5 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <PencilIcon />
      </button>
      <button
        onClick={recording ? onMicStop : onMicStart}
        disabled={busy}
        aria-label={recording ? "Stop recording" : "Re-record interpretation"}
        title={recording ? "Stop recording" : "Re-record in your language"}
        className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          recording
            ? "text-rose-500 bg-rose-50 animate-pulse"
            : "text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
        }`}
      >
        {recording ? <StopIcon /> : <MicIcon />}
      </button>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793l2.828 2.828L6.5 16.328H3.672v-2.828l7.707-7.707z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
      <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <rect x="4" y="4" width="12" height="12" rx="2" />
    </svg>
  );
}
