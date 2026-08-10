"use client";

// Reading mode — a short story woven from the user's own vocabulary.
// The user picks a study angle, the LLM writes a level-bounded text
// that embeds ~25 of those words, and every word is tappable exactly
// like in chat (lookup + save; known words soft-lapse). One play
// button reads the whole story aloud (podcast light). "Fertig
// gelesen" has NO SRS effect in v1 — passive recognition is weaker
// evidence than trainer recall; reading is its own reward.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AIBubble from "@/components/AIBubble";

type ReadingSort = "stale" | "recent" | "important" | "wrong";

const SORT_OPTIONS: Array<{ key: ReadingSort; label: string }> = [
  { key: "stale", label: "Lange nicht geübt" },
  { key: "recent", label: "Neueste" },
  { key: "important", label: "Wichtigste" },
  { key: "wrong", label: "Oft falsch" },
];

type Stage =
  | { kind: "pick" }
  | { kind: "generating" }
  | { kind: "reading"; title: string; paragraphs: string[]; fullText: string }
  | { kind: "done"; title: string }
  | { kind: "error"; message: string };

export default function ReadingPage() {
  const router = useRouter();
  const [sort, setSort] = useState<ReadingSort>("stale");
  const [stage, setStage] = useState<Stage>({ kind: "pick" });

  // ── Whole-story TTS ───────────────────────────────────────────────
  const [ttsBlob, setTtsBlob] = useState<Blob | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    setIsPlaying(false);
  }

  async function toggleAudio(fullText: string) {
    if (isPlaying) {
      stopAudio();
      return;
    }
    let blob = ttsBlob;
    if (!blob) {
      setTtsLoading(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: fullText, speed: 1.0 }),
        });
        if (!res.ok) throw new Error("TTS failed");
        blob = await res.blob();
        setTtsBlob(blob);
      } catch {
        setTtsLoading(false);
        return;
      }
      setTtsLoading(false);
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      audioRef.current = null;
      setIsPlaying(false);
    };
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }

  async function handleGenerate() {
    setStage({ kind: "generating" });
    setTtsBlob(null);
    stopAudio();
    try {
      const res = await fetch("/api/reading/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = (await res.json()) as { title?: string; story?: string; error?: string };
      if (!res.ok || !data.story) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const paragraphs = data.story.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
      setStage({
        kind: "reading",
        title: data.title || "Lectura",
        paragraphs,
        fullText: data.story,
      });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  function handleFinished() {
    stopAudio();
    if (stage.kind === "reading") setStage({ kind: "done", title: stage.title });
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-sm font-medium text-neutral-700">Lesen</h1>
          <span className="w-10" />
        </div>
      </header>

      <div className="max-w-xl mx-auto px-5 py-8">
        {(stage.kind === "pick" || stage.kind === "generating" || stage.kind === "error") && (
          <div className="mt-6">
            <p className="text-sm text-neutral-500 text-center mb-6 leading-relaxed">
              Eine kurze Geschichte, gewoben aus deinen eigenen Vokabeln.
              <br />
              Tippe beim Lesen auf alles, was du nicht verstehst.
            </p>
            <div className="flex justify-center gap-1.5 mb-8 flex-wrap">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSort(opt.key)}
                  disabled={stage.kind === "generating"}
                  className={
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors border " +
                    (sort === opt.key
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {stage.kind === "error" && (
              <p className="text-center text-sm text-rose-500 mb-4">{stage.message}</p>
            )}
            <button
              onClick={handleGenerate}
              disabled={stage.kind === "generating"}
              className="w-full px-4 py-3 rounded-2xl bg-neutral-900 text-white text-base font-medium hover:bg-neutral-800 transition-colors disabled:opacity-60"
            >
              {stage.kind === "generating" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Schreibe deine Geschichte…
                </span>
              ) : (
                "Text erstellen"
              )}
            </button>
          </div>
        )}

        {stage.kind === "reading" && (
          <article className="mt-2">
            <div className="flex items-start justify-between gap-3 mb-6">
              <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
                {stage.title}
              </h2>
              <button
                onClick={() => toggleAudio(stage.fullText)}
                disabled={ttsLoading}
                className="shrink-0 mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-300 text-xs text-neutral-600 hover:border-neutral-500 hover:text-neutral-900 transition-colors disabled:opacity-50"
              >
                {ttsLoading ? "Lade…" : isPlaying ? "■ Stop" : "▶ Anhören"}
              </button>
            </div>
            <div className="space-y-5">
              {stage.paragraphs.map((p, i) => (
                <AIBubble key={i} text={p} variant="article" disableTts />
              ))}
            </div>
            <button
              onClick={handleFinished}
              className="mt-10 w-full px-4 py-3 rounded-2xl bg-neutral-900 text-white text-base font-medium hover:bg-neutral-800 transition-colors"
            >
              Text fertig gelesen
            </button>
          </article>
        )}

        {stage.kind === "done" && (
          <div className="text-center mt-16 space-y-4">
            <p className="text-3xl">📖</p>
            <p className="text-lg font-medium text-neutral-800">Schön gelesen!</p>
            <p className="text-sm text-neutral-500 leading-relaxed">
              Alles, was du angetippt hast, ist in deinem Vokabeltrainer gelandet.
            </p>
            <div className="flex flex-col items-center gap-2 mt-4">
              <button
                onClick={() => setStage({ kind: "pick" })}
                className="px-5 py-2 rounded-lg border border-neutral-300 text-neutral-700 text-sm hover:border-neutral-500 hover:text-neutral-900 transition-colors"
              >
                Noch eine Geschichte
              </button>
              <button
                onClick={() => router.push("/")}
                className="px-5 py-2 rounded-lg bg-neutral-900 text-white text-sm hover:bg-neutral-800 transition-colors"
              >
                Zurück zur App →
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
