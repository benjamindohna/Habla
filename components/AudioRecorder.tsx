"use client";

import { useRef, useState } from "react";

type RecorderState = "idle" | "recording";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
  disabled?: boolean;
}

export default function AudioRecorder({ onRecordingComplete, disabled }: AudioRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
    const recorder = new MediaRecorder(stream, { mimeType });

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      console.log("[AudioRecorder] chunks:", chunksRef.current.length, "blob size:", blob.size, "type:", blob.type);
      stream.getTracks().forEach((t) => t.stop());
      onRecordingComplete(blob);
    };

    recorder.start(250); // collect a chunk every 250ms so we always get real audio data
    mediaRecorderRef.current = recorder;
    setState("recording");
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setState("idle");
  }

  const isRecording = state === "recording";

  return (
    <button
      onClick={isRecording ? stopRecording : startRecording}
      disabled={disabled}
      className={[
        "flex items-center gap-2 px-5 py-3 rounded-full font-medium text-sm transition-all",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        isRecording
          ? "bg-red-500 hover:bg-red-600 text-white focus-visible:ring-red-400 animate-pulse"
          : "bg-neutral-900 hover:bg-neutral-700 text-white focus-visible:ring-neutral-500",
        disabled && !isRecording ? "opacity-40 cursor-not-allowed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Mic / Stop icon */}
      {isRecording ? (
        <>
          <span className="w-3 h-3 rounded-sm bg-white" />
          Stop recording
        </>
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
            <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
          </svg>
          Record
        </>
      )}
    </button>
  );
}
