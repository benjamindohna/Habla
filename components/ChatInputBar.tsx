"use client";

// WhatsApp-style input bar: one rounded text field with a mic button
// inside its right edge. Empty field → mic prominent (voice is the
// primary mode); typed text → send button replaces the mic. Both input
// modes are available on EVERY turn — the user decides per input.
//
// Text submits skip transcription entirely; the parent feeds the typed
// string straight into the correction pipeline. Recording logic mirrors
// components/AudioRecorder.tsx (kept for the playground pages).

import { useRef, useState } from "react";

interface ChatInputBarProps {
  /** Typed-text submit. Parent runs the correction pipeline on it
   *  directly (no transcription step). */
  onSubmitText: (text: string) => void;
  onRecordingComplete: (blob: Blob) => void;
  /** Fires when recording actually starts (stream acquired). */
  onRecordingStart?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInputBar({
  onSubmitText,
  onRecordingComplete,
  onRecordingStart,
  disabled = false,
  placeholder = "Schreiben oder sprechen…",
}: ChatInputBarProps) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const hasText = text.trim().length > 0;

  function submitText() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    onSubmitText(trimmed);
  }

  async function startRecording() {
    if (disabled) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
    const recorder = new MediaRecorder(stream, { mimeType });

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      stream.getTracks().forEach((t) => t.stop());
      onRecordingComplete(blob);
    };

    recorder.start(250); // collect a chunk every 250ms so we always get real audio data
    mediaRecorderRef.current = recorder;
    setRecording(true);
    onRecordingStart?.();
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  if (recording) {
    return (
      <button
        onClick={stopRecording}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full font-medium text-sm bg-red-500 hover:bg-red-600 text-white animate-pulse transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
      >
        <span className="w-3 h-3 rounded-sm bg-white" />
        Aufnahme beenden
      </button>
    );
  }

  return (
    <div
      className={
        "flex items-end gap-1 w-full rounded-3xl border border-neutral-300 bg-white pl-4 pr-1.5 py-1.5 focus-within:border-neutral-500 transition-colors" +
        (disabled ? " opacity-50" : "")
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitText();
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="flex-1 resize-none bg-transparent text-base leading-relaxed py-1.5 outline-none placeholder:text-neutral-400 max-h-32"
        style={{ height: "auto" }}
        onInput={(e) => {
          // Auto-grow up to max-h; shrink back when cleared.
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
      />
      {hasText ? (
        <button
          onClick={submitText}
          disabled={disabled}
          aria-label="Senden"
          className="shrink-0 w-10 h-10 rounded-full bg-neutral-900 hover:bg-neutral-700 text-white flex items-center justify-center transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 translate-x-[1px]">
            <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
          </svg>
        </button>
      ) : (
        <button
          onClick={startRecording}
          disabled={disabled}
          aria-label="Aufnehmen"
          className="shrink-0 w-10 h-10 rounded-full bg-neutral-900 hover:bg-neutral-700 text-white flex items-center justify-center transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
            <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
          </svg>
        </button>
      )}
    </div>
  );
}
