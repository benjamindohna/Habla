"use client";

import { useEffect, useState } from "react";
import UserBubble from "@/components/UserBubble";
import type { CorrectionResult } from "@/types/correction";

type CorrectionStyle = "natural" | "transcript_aware";
type Tier = "mini" | "4o";

interface Me {
  nativeLanguage: string;
  correctionStyle: CorrectionStyle;
}

interface Bubble {
  id: string;
  status:
    | { kind: "pending"; transcript: string }
    | { kind: "ok"; result: CorrectionResult; transcript: string }
    | { kind: "error"; message: string; transcript: string };
}

export default function CorrectTestPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [input, setInput] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [meError, setMeError] = useState<string | null>(null);

  // Per-step model toggles. Default mini for all so testing the cheaper
  // tier is the starting state; flip to 4o per step to A/B-compare.
  const [localizeTier, setLocalizeTier] = useState<Tier>("mini");
  const [segmentTier, setSegmentTier] = useState<Tier>("mini");
  const [explainTier, setExplainTier] = useState<Tier>("mini");

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMe)
      .catch((err: Error) => setMeError(err.message));
  }, []);

  async function correctOnce(args: {
    transcript: string;
    overrideIntendedMeaning?: string;
  }): Promise<CorrectionResult> {
    if (!me) throw new Error("Profile not loaded");
    const res = await fetch("/api/correct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: args.transcript,
        overrideIntendedMeaning: args.overrideIntendedMeaning,
        nativeLanguage: me.nativeLanguage,
        style: me.correctionStyle,
        localizeMini: localizeTier === "mini",
        segmentMini: segmentTier === "mini",
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function handleSubmit() {
    const t = input.trim();
    if (!t || !me) return;
    const id = crypto.randomUUID();
    setBubbles((prev) => [...prev, { id, status: { kind: "pending", transcript: t } }]);
    setInput("");
    try {
      const result = await correctOnce({ transcript: t });
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, status: { kind: "ok", result, transcript: t } } : b,
        ),
      );
    } catch (err) {
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                status: { kind: "error", message: (err as Error).message, transcript: t },
              }
            : b,
        ),
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleReCorrect(bubbleId: string, override: string) {
    const bubble = bubbles.find((b) => b.id === bubbleId);
    if (!bubble || bubble.status.kind !== "ok") return;
    const transcript = bubble.status.transcript;
    setBubbles((prev) =>
      prev.map((b) =>
        b.id === bubbleId ? { ...b, status: { kind: "pending", transcript } } : b,
      ),
    );
    try {
      const result = await correctOnce({ transcript, overrideIntendedMeaning: override });
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === bubbleId ? { ...b, status: { kind: "ok", result, transcript } } : b,
        ),
      );
    } catch (err) {
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === bubbleId
            ? {
                ...b,
                status: { kind: "error", message: (err as Error).message, transcript },
              }
            : b,
        ),
      );
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Correction Pipeline Playground</h1>
          <p className="text-sm text-neutral-500">
            Type what would normally come from STT — any mix of {me?.nativeLanguage ?? "your native language"}{" "}
            and Spanish, with errors. Press Enter to fire the full correction pipeline
            (interpret → localize → segment) and render a user-bubble like the chat would. Per-segment
            explanations on click. No Done button — this is read-only for inspection.
          </p>
          {me && (
            <p className="text-xs text-neutral-400">
              Using your profile: native={me.nativeLanguage} · style={me.correctionStyle}
            </p>
          )}
          {meError && <p className="text-xs text-red-500">profile load failed: {meError}</p>}
        </header>

        <div className="border border-neutral-200 rounded-lg p-3 bg-white space-y-2">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Model per step</p>
          <div className="flex flex-wrap gap-4">
            <TierToggle label="Localize" value={localizeTier} onChange={setLocalizeTier} />
            <TierToggle label="Segment" value={segmentTier} onChange={setSegmentTier} />
            <TierToggle label="Explain" value={explainTier} onChange={setExplainTier} />
          </div>
          <p className="text-[11px] text-neutral-400">
            New corrections use the current toggles. Existing bubbles keep their original output;
            only the explain calls (segment-tap) re-fetch with the current explain toggle, but
            previously-cached explanations remain.
          </p>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='z.B. "ich gehe a la playa con mein Freund"'
            disabled={!me}
            className="w-full text-base text-neutral-900 bg-white border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-600 disabled:opacity-50"
          />
          <p className="text-xs text-neutral-400">Press Enter to correct.</p>
        </div>

        {bubbles.length === 0 ? (
          <p className="text-sm text-neutral-400 italic">No corrections yet.</p>
        ) : (
          <div className="space-y-6">
            {bubbles.map((b) => (
              <BubbleSlot
                key={b.id}
                bubble={b}
                nativeLanguage={me?.nativeLanguage ?? "German"}
                explainMini={explainTier === "mini"}
                onReCorrect={(override) => handleReCorrect(b.id, override)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function TierToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Tier;
  onChange: (t: Tier) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-neutral-600 font-medium">{label}</span>
      <div className="inline-flex rounded border border-neutral-300 overflow-hidden">
        <button
          onClick={() => onChange("4o")}
          className={
            "px-2 py-1 transition-colors " +
            (value === "4o"
              ? "bg-neutral-900 text-white"
              : "bg-white text-neutral-600 hover:bg-neutral-100")
          }
        >
          4o
        </button>
        <button
          onClick={() => onChange("mini")}
          className={
            "px-2 py-1 transition-colors border-l border-neutral-300 " +
            (value === "mini"
              ? "bg-neutral-900 text-white"
              : "bg-white text-neutral-600 hover:bg-neutral-100")
          }
        >
          mini
        </button>
      </div>
    </div>
  );
}

function BubbleSlot({
  bubble,
  nativeLanguage,
  explainMini,
  onReCorrect,
}: {
  bubble: Bubble;
  nativeLanguage: string;
  explainMini: boolean;
  onReCorrect: (override: string) => void;
}) {
  const status = bubble.status;
  if (status.kind === "pending") {
    return (
      <div className="flex justify-end">
        <div className="text-xs text-neutral-400 italic flex items-center gap-2">
          <span className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
          <span>Correcting…</span>
          <span className="text-neutral-300">· &ldquo;{status.transcript}&rdquo;</span>
        </div>
      </div>
    );
  }
  if (status.kind === "error") {
    return (
      <div className="flex justify-end">
        <p className="text-sm text-red-500">
          {status.message}{" "}
          <span className="text-neutral-400 italic">· &ldquo;{status.transcript}&rdquo;</span>
        </p>
      </div>
    );
  }
  return (
    <UserBubble
      result={status.result}
      nativeLanguage={nativeLanguage}
      showDone={false}
      onDone={() => {}}
      onReCorrect={onReCorrect}
      explainMini={explainMini}
    />
  );
}
