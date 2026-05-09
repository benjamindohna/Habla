"use client";

import { useEffect, useState } from "react";
import UserBubble from "@/components/UserBubble";
import type { CorrectionResult } from "@/types/correction";

type CorrectionStyle = "natural" | "transcript_aware";
type Tier = "mini" | "4o";
type PromptVersion = "v1" | "v2";

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

  // Per-step prompt-version toggles. Localize has no V2, so no toggle
  // for it. Default segment=v1 (matches current state, can flip to v2);
  // default explain=v2 (the dynamic-length version we set up earlier).
  const [segmentPrompt, setSegmentPrompt] = useState<PromptVersion>("v1");
  const [explainPrompt, setExplainPrompt] = useState<PromptVersion>("v2");

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
        improvedSegmentPrompt: segmentPrompt === "v2",
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

        <div className="border border-neutral-200 rounded-lg p-3 bg-white space-y-3">
          <div className="grid grid-cols-[auto_1fr_1fr] gap-x-6 gap-y-2 items-center text-xs">
            <span className="col-start-2 uppercase tracking-wide text-neutral-400">Model</span>
            <span className="uppercase tracking-wide text-neutral-400">Prompt</span>

            <span className="text-neutral-700 font-medium">Localize</span>
            <PillToggle value={localizeTier} options={["4o", "mini"]} onChange={setLocalizeTier} />
            <span className="text-[11px] text-neutral-400 italic">no V2 yet</span>

            <span className="text-neutral-700 font-medium">Segment</span>
            <PillToggle value={segmentTier} options={["4o", "mini"]} onChange={setSegmentTier} />
            <PillToggle value={segmentPrompt} options={["v1", "v2"]} onChange={setSegmentPrompt} />

            <span className="text-neutral-700 font-medium">Explain</span>
            <PillToggle value={explainTier} options={["4o", "mini"]} onChange={setExplainTier} />
            <PillToggle value={explainPrompt} options={["v1", "v2"]} onChange={setExplainPrompt} />
          </div>
          <p className="text-[11px] text-neutral-400">
            New corrections use the current toggles. Existing bubbles keep their original output;
            only the explain calls (segment-tap) re-fetch with the current explain toggle, but
            previously-cached explanations remain. Production chat is unaffected (always V1 + 4o).
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
                explainPromptV2={explainPrompt === "v2"}
                onReCorrect={(override) => handleReCorrect(b.id, override)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function PillToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, T];
  onChange: (v: T) => void;
}) {
  const [a, b] = options;
  return (
    <div className="inline-flex rounded border border-neutral-300 overflow-hidden self-start text-xs">
      <button
        onClick={() => onChange(a)}
        className={
          "px-2 py-1 transition-colors " +
          (value === a
            ? "bg-neutral-900 text-white"
            : "bg-white text-neutral-600 hover:bg-neutral-100")
        }
      >
        {a}
      </button>
      <button
        onClick={() => onChange(b)}
        className={
          "px-2 py-1 transition-colors border-l border-neutral-300 " +
          (value === b
            ? "bg-neutral-900 text-white"
            : "bg-white text-neutral-600 hover:bg-neutral-100")
        }
      >
        {b}
      </button>
    </div>
  );
}

function BubbleSlot({
  bubble,
  nativeLanguage,
  explainMini,
  explainPromptV2,
  onReCorrect,
}: {
  bubble: Bubble;
  nativeLanguage: string;
  explainMini: boolean;
  explainPromptV2: boolean;
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
      improvedExplainPrompt={explainPromptV2}
    />
  );
}
