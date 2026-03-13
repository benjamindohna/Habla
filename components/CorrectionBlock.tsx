"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import type { CorrectionResult, Pair } from "@/types/correction";

interface CorrectionBlockProps {
  result: CorrectionResult;
  nativeLanguage: string;
}

export default function CorrectionBlock({ result, nativeLanguage }: CorrectionBlockProps) {
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<Record<number, string>>({});

  const [ttsLoading, setTtsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playCount, setPlayCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Cached blobs per speed so repeated clicks skip the API call
  const blobCacheRef = useRef<{ normal?: Blob; slow?: Blob }>({});

  // Clear everything when a new result arrives (new recording)
  useEffect(() => {
    setCache({});
    setSelectedIndex(null);
    setSelectedPair(null);
    setExplanation(null);
    setPlayCount(0);
    setIsPlaying(false);
    blobCacheRef.current = {};
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [result]);

  async function handlePairClick(pair: Pair, index: number) {
    if (pair.is_match) return;

    // Toggle off if already selected
    if (selectedIndex === index) {
      setSelectedIndex(null);
      setSelectedPair(null);
      setExplanation(null);
      return;
    }

    setSelectedIndex(index);
    setSelectedPair(pair);

    // Serve from cache if already fetched
    if (cache[index] !== undefined) {
      setExplanation(cache[index]);
      return;
    }

    setExplanation(null);
    setLoading(true);

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localVersionEs: result.local_version_es,
          localSegment: pair.local_segment,
          userSegment: pair.user_segment,
          nativeLanguage,
        }),
      });
      const data = await res.json();
      const text = data.explanation ?? "Could not load explanation.";
      setCache(prev => ({ ...prev, [index]: text }));
      setExplanation(text);
    } catch {
      setExplanation("Could not load explanation.");
    } finally {
      setLoading(false);
    }
  }

  function handleStop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  }

  async function handleSpeak() {
    if (ttsLoading) return;

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // Speed alternates only when playback completes fully — use current count to decide
    const speedKey = playCount % 2 === 0 ? "normal" : "slow";
    const speed = speedKey === "slow" ? 0.75 : 1.0;

    // Use cached blob if available — text only changes on a new recording
    let blob = blobCacheRef.current[speedKey];
    if (!blob) {
      setTtsLoading(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: result.local_version_es, speed }),
        });
        if (!res.ok) throw new Error("TTS failed");
        blob = await res.blob();
        blobCacheRef.current[speedKey] = blob;
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
      // Only advance the counter when the full sentence was heard
      setPlayCount(c => c + 1);
      setIsPlaying(false);
    };
    audio.play();
    setIsPlaying(true);
  }

  // Next play will be slow if playCount is currently even (0, 2, 4 → next is odd → slow)
  const nextIsSlow = playCount % 2 === 1;
  const speakLabel = ttsLoading
    ? "Generating audio…"
    : isPlaying
    ? "Stop"
    : nextIsSlow
    ? "Play sentence (slow)"
    : "Play sentence";

  return (
    <div className="w-full space-y-3">
      {/* Segment display */}
      <div className="relative w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        {/* TTS button */}
        <button
          onClick={isPlaying ? handleStop : handleSpeak}
          disabled={ttsLoading}
          aria-label={speakLabel}
          title={speakLabel}
          className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-neutral-300 hover:text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {ttsLoading ? <TtsSpinner /> : isPlaying ? <StopIcon /> : <SpeakerIcon slow={nextIsSlow} />}
        </button>

        <div
          className="text-lg leading-[3rem] text-neutral-900 pr-8"
          aria-label="Corrected sentence"
        >
          {result.pairs.map((pair, i) => (
            <Fragment key={i}>
              <PairChip
                pair={pair}
                isSelected={selectedIndex === i}
                onClick={() => handlePairClick(pair, i)}
              />
              {" "}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Explanation panel */}
      {(loading || explanation || selectedPair) && (
        <div className="w-full rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">

          {/* Context header */}
          {selectedPair && (
            <div className="flex items-stretch text-xs border-b border-neutral-100">
              <div className="flex-1 px-4 py-2.5 bg-rose-50">
                <p className="text-rose-400 font-medium mb-0.5">I said</p>
                <p className="text-rose-600 font-mono">
                  {selectedPair.user_segment.trim() || "—"}
                </p>
              </div>
              <div className="w-px bg-neutral-100" />
              <div className="flex-1 px-4 py-2.5 bg-green-50">
                <p className="text-green-600 font-medium mb-0.5">Correct</p>
                <p className="text-green-800 font-mono">
                  {selectedPair.local_segment.trim()}
                </p>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="px-5 py-4 text-sm text-neutral-700">
            {loading ? (
              <p className="flex items-center gap-2 text-neutral-400">
                <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
                Loading explanation…
              </p>
            ) : explanation ? (
              <FormattedText text={explanation} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── TTS icons ──────────────────────────────────────────────────────────────

function TtsSpinner() {
  return (
    <span className="block w-4 h-4 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin" />
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <rect x="4" y="4" width="12" height="12" rx="2" />
    </svg>
  );
}

// Speaker icon; shows a small turtle badge when the next click will be slow
function SpeakerIcon({ slow }: { slow: boolean }) {
  return (
    <span className="relative block w-4 h-4">
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M9.25 3.35a.75.75 0 00-1.23-.573L4.18 6.25H2.75A.75.75 0 002 7v6a.75.75 0 00.75.75H4.18l3.84 3.473A.75.75 0 009.25 16.65V3.35z" />
        <path d="M13.537 5.963a.75.75 0 00-1.06 1.061 4.5 4.5 0 010 5.952.75.75 0 001.06 1.06 6 6 0 000-8.073z" />
        <path d="M15.66 3.84a.75.75 0 00-1.06 1.06 7.5 7.5 0 010 10.2.75.75 0 001.06 1.06 9 9 0 000-12.32z" />
      </svg>
      {slow && (
        <span
          className="absolute -bottom-1 -right-1 text-[8px] leading-none"
          aria-hidden="true"
        >
          🐢
        </span>
      )}
    </span>
  );
}

// ── Lightweight markdown renderer: **bold** and line breaks ────────────────

function FormattedText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {text.split(/\n+/).map((paragraph, i) => (
        <p key={i} className="leading-relaxed">
          {parseBold(paragraph)}
        </p>
      ))}
    </div>
  );
}

function parseBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold text-neutral-900">{part}</strong> : part
  );
}

// ── Pair chip ──────────────────────────────────────────────────────────────

interface PairChipProps {
  pair: Pair;
  isSelected: boolean;
  onClick: () => void;
}

function PairChip({ pair, isSelected, onClick }: PairChipProps) {
  const local = pair.local_segment.trim();
  const user = pair.user_segment.trim();

  if (pair.is_match) {
    return <span>{local}</span>;
  }

  return (
    <span
      className={`inline-block relative mx-0.5 cursor-pointer rounded transition-colors ${
        isSelected ? "outline outline-2 outline-offset-2 outline-green-400" : ""
      }`}
      style={{ lineHeight: 0 }}
      onClick={onClick}
      title="Tap for an explanation"
    >
      {/* What the learner said — floats above the green chip */}
      <span
        className="absolute left-0 w-full text-center text-[0.65rem] leading-none text-rose-400 whitespace-nowrap"
        style={{ bottom: "calc(100% + 4px)" }}
        aria-label={`learner said: ${user}`}
      >
        {user}
      </span>
      {/* Local Spanish — primary text with green highlight */}
      <span
        className={`inline-block rounded px-1.5 pt-[2px] pb-[4px] leading-none transition-colors ${
          isSelected
            ? "bg-green-200 text-green-900"
            : "bg-green-100 text-green-800 hover:bg-green-200"
        }`}
      >
        {local}
      </span>
    </span>
  );
}
