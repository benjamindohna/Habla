"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import VocabCardStack, { type VocabCardData } from "@/components/VocabCardStack";
import {
  STAGE_INTERVALS_SECONDS,
  formatStageInterval,
  projectNextStage,
} from "@/lib/vocab";

type Stage = "loading" | "ready" | "revealed" | "exiting" | "empty" | "error";

interface QueueResponse {
  cards: Array<{
    id: number;
    target_word_original: string;
    english_description: string;
    stage: number;
    last_seen: number;
    native_translation: string | null;
    native_hint: string | null;
  }>;
}

interface ServerCard extends VocabCardData {
  english_description: string;
  native_translation: string | null;
  native_hint: string | null;
}

interface Explanation {
  translation: string;
  hint: string;
}

const EXIT_DURATION_MS = 400;

export default function VocabPracticePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [cards, setCards] = useState<ServerCard[]>([]);
  const [exitingId, setExitingId] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/vocab/queue?mode=recognition")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          throw new Error("Not authenticated");
        }
        if (!res.ok) throw new Error(`Queue fetch failed (HTTP ${res.status})`);
        return (await res.json()) as QueueResponse;
      })
      .then((data) => {
        if (cancelled) return;
        const next: ServerCard[] = data.cards.map((c) => ({
          id: c.id,
          target_word_original: c.target_word_original,
          english_description: c.english_description,
          stage: c.stage,
          native_translation: c.native_translation,
          native_hint: c.native_hint,
        }));
        setCards(next);
        setStage(next.length > 0 ? "ready" : "empty");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMessage(err.message);
        setStage("error");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const currentCard = cards[0];

  function dismissCurrent() {
    if (!currentCard) return;
    setExitingId(currentCard.id);
    setStage("exiting");
    setTimeout(() => {
      setCards((cs) => cs.slice(1));
      setExitingId(null);
      setExplanation(null);
      setStage((prev) => (prev === "exiting" ? "ready" : prev));
    }, EXIT_DURATION_MS);
  }

  /** Fast path: translation + hint already came down with the queue
   *  payload, so on flip we use what we have instantly — no network
   *  roundtrip. Only when the row was saved so recently that the
   *  background explain job hasn't landed yet do we fall back to
   *  /api/vocab/explain (which then generates + caches). */
  async function fetchExplanation(rowId: number) {
    const card = cards.find((c) => c.id === rowId);
    if (card && card.native_translation) {
      setExplanation({
        translation: card.native_translation,
        hint: card.native_hint ?? "",
      });
      return;
    }
    setExplanation(null);
    try {
      const res = await fetch("/api/vocab/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId }),
      });
      if (!res.ok) throw new Error(`Explain failed (HTTP ${res.status})`);
      const data = (await res.json()) as Explanation;
      setExplanation({
        translation: data.translation || "(keine Übersetzung)",
        hint: data.hint ?? "",
      });
    } catch (err) {
      console.error("[vocab/explain]", err);
      setExplanation({ translation: "(Konnte Antwort nicht laden)", hint: "" });
    }
  }

  function handleReveal() {
    if (stage !== "ready" || !currentCard) return;
    setStage("revealed");
    fetchExplanation(currentCard.id);
  }

  function commitAndDismiss(result: "0" | "1" | "2") {
    if (!currentCard) return;
    void fetch("/api/vocab/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId: currentCard.id, result, mode: "recognition" }),
    }).catch(() => {});
    dismissCurrent();
  }

  function handleDelete() {
    if (!currentCard) return;
    void fetch("/api/vocab/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId: currentCard.id }),
    }).catch(() => {});
    dismissCurrent();
  }

  useEffect(() => {
    if (cards.length === 0 && stage !== "loading" && stage !== "exiting" && stage !== "empty" && stage !== "error") {
      setStage("empty");
    }
  }, [cards.length, stage]);

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
          <h1 className="text-sm font-medium text-neutral-700">Vocab Practice</h1>
          <span className="text-xs text-neutral-400 tabular-nums">
            {stage === "loading" ? "…" : `${cards.length} fällig`}
          </span>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 py-12">
        {stage === "loading" && (
          <p className="text-center text-sm text-neutral-400 mt-12">Lade Karten…</p>
        )}

        {stage === "error" && (
          <div className="text-center mt-12 space-y-3">
            <p className="text-sm text-red-500">{errorMessage}</p>
            <button
              onClick={() => router.push("/")}
              className="text-sm text-neutral-500 hover:text-neutral-800 underline"
            >
              ← zur Startseite
            </button>
          </div>
        )}

        {stage === "empty" && (
          <div className="text-center mt-12 space-y-4">
            <p className="text-3xl">🎉</p>
            <p className="text-lg font-medium text-neutral-800">Alles gelernt!</p>
            <p className="text-sm text-neutral-500 leading-relaxed">
              Du hast alle fälligen Karten durch.<br />
              Starte einen neuen Chat, um neue Wörter zu entdecken —<br />
              sie landen automatisch hier.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-4 px-5 py-2 rounded-lg bg-neutral-900 text-white text-sm hover:bg-neutral-800 transition-colors"
            >
              Neuen Chat starten →
            </button>
          </div>
        )}

        {(stage === "ready" || stage === "revealed" || stage === "exiting") && currentCard && (
          <div className="space-y-6">
            <VocabCardStack
              cards={cards}
              exitingId={exitingId}
              onTapFront={stage === "ready" ? handleReveal : undefined}
              revealed={stage === "revealed"}
              back={<CardBack explanation={explanation} />}
            />

            {stage === "ready" && (
              <button
                onClick={handleReveal}
                className="w-full px-4 py-3 rounded-2xl bg-neutral-900 text-white text-base font-medium hover:bg-neutral-800 transition-colors"
              >
                Antwort zeigen
              </button>
            )}

            {stage === "revealed" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <RevealButton
                    label="Falsch"
                    intervalLabel={formatStageInterval(
                      STAGE_INTERVALS_SECONDS[projectNextStage(currentCard.stage, "0")],
                    )}
                    color="rose"
                    disabled={explanation === null}
                    onClick={() => commitAndDismiss("0")}
                  />
                  <RevealButton
                    label="Gut"
                    intervalLabel={formatStageInterval(
                      STAGE_INTERVALS_SECONDS[projectNextStage(currentCard.stage, "1")],
                    )}
                    color="emerald"
                    disabled={explanation === null}
                    onClick={() => commitAndDismiss("1")}
                  />
                  <RevealButton
                    label="Sehr gut"
                    intervalLabel={formatStageInterval(
                      STAGE_INTERVALS_SECONDS[projectNextStage(currentCard.stage, "2")],
                    )}
                    color="sky"
                    disabled={explanation === null}
                    onClick={() => commitAndDismiss("2")}
                  />
                </div>
                <button
                  onClick={handleDelete}
                  disabled={explanation === null}
                  className="w-full px-4 py-2 rounded-xl bg-neutral-100 text-neutral-500 text-sm hover:bg-neutral-200 hover:text-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Karte entfernen
                </button>
              </div>
            )}

            {stage === "exiting" && (
              <div className="flex gap-2">
                <div className="flex-1 rounded-2xl bg-neutral-200 h-[68px]" />
                <div className="flex-1 rounded-2xl bg-neutral-200 h-[68px]" />
                <div className="flex-1 rounded-2xl bg-neutral-200 h-[68px]" />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

type RevealButtonColor = "rose" | "emerald" | "sky";

interface RevealButtonProps {
  label: string;
  intervalLabel: string;
  color: RevealButtonColor;
  disabled: boolean;
  onClick: () => void;
}

function RevealButton({ label, intervalLabel, color, disabled, onClick }: RevealButtonProps) {
  const colorClass =
    color === "rose"
      ? "bg-rose-700 hover:bg-rose-800"
      : color === "emerald"
      ? "bg-emerald-700 hover:bg-emerald-800"
      : "bg-sky-700 hover:bg-sky-800";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 px-3 py-2 rounded-2xl text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-0.5 ${colorClass}`}
    >
      <span className="text-base font-medium leading-tight">{label}</span>
      <span className="text-xs opacity-75 tabular-nums leading-tight">{intervalLabel}</span>
    </button>
  );
}

interface CardBackProps {
  explanation: Explanation | null;
}

function CardBack({ explanation }: CardBackProps) {
  return (
    <div className="w-full h-full rounded-2xl border border-neutral-200 shadow-sm bg-white flex flex-col items-center justify-center text-center px-6 py-8">
      <p className="text-xs uppercase tracking-wider text-neutral-400">Antwort</p>
      {explanation === null ? (
        <p className="mt-3 text-sm italic text-neutral-400">Antwort wird geladen…</p>
      ) : (
        <>
          <p className="mt-3 text-2xl font-medium text-neutral-900">
            {explanation.translation}
          </p>
          {explanation.hint && (
            <p className="mt-2 text-sm text-neutral-600">{explanation.hint}</p>
          )}
        </>
      )}
    </div>
  );
}
