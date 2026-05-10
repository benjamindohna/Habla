"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import VocabCardStack, { type VocabCardData } from "@/components/VocabCardStack";

type Stage = "loading" | "ready" | "judging" | "feedback-x" | "feedback-0" | "revealed" | "exiting" | "empty" | "error";

interface QueueResponse {
  cards: Array<{
    id: number;
    target_word_original: string;
    english_description: string;
    stage: number;
    last_seen: number;
    lapses: number;
  }>;
}

interface ServerCard extends VocabCardData {
  english_description: string;
}

const EXIT_DURATION_MS = 400;
const MAX_ATTEMPTS_BEFORE_GIVEUP = 3;

export default function VocabPracticePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [cards, setCards] = useState<ServerCard[]>([]);
  const [exitingId, setExitingId] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [revealedDescription, setRevealedDescription] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Initial queue fetch.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/vocab/queue")
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

  // Auto-focus the input whenever a fresh card becomes interactive.
  useEffect(() => {
    if (stage === "ready" || stage === "feedback-x" || stage === "feedback-0") {
      inputRef.current?.focus();
    }
  }, [stage, cards.length]);

  const currentCard = cards[0];

  function resetForNewCard() {
    setAnswer("");
    setAttempts(0);
    setRevealedDescription(null);
    setStage(cards.length > 1 ? "ready" : "empty");
  }

  async function handleSubmit() {
    if (stage !== "ready" && stage !== "feedback-x" && stage !== "feedback-0") return;
    if (!currentCard) return;
    const trimmed = answer.trim();
    if (!trimmed) return;

    setStage("judging");
    try {
      const res = await fetch("/api/vocab/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId: currentCard.id, userAnswer: trimmed }),
      });
      if (!res.ok) throw new Error(`Judge failed (HTTP ${res.status})`);
      const data = (await res.json()) as { result: "1" | "X" | "0"; english_description: string };

      if (data.result === "1") {
        // Commit + exit animation.
        await fetch("/api/vocab/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: currentCard.id, result: "1" }),
        }).catch(() => {});
        setExitingId(currentCard.id);
        setStage("exiting");
        setTimeout(() => {
          setCards((cs) => cs.slice(1));
          setExitingId(null);
          // After unmount, the next card slides in and we reset.
          setAnswer("");
          setAttempts(0);
          setRevealedDescription(null);
          // stage-update happens via the cards-length effect below, but
          // we set it eagerly so the input re-enables without waiting
          // for re-render.
          setStage((prev) => (prev === "exiting" ? "ready" : prev));
        }, EXIT_DURATION_MS);
      } else if (data.result === "X") {
        setStage("feedback-x");
        setAnswer("");
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setStage("feedback-0");
        setAnswer("");
      }
    } catch (err) {
      console.error("[vocab/judge]", err);
      setErrorMessage((err as Error).message);
      setStage("error");
    }
  }

  async function handleGiveUp() {
    if (!currentCard) return;
    setRevealedDescription(currentCard.english_description);
    setStage("revealed");
  }

  async function handleNextAfterReveal() {
    if (!currentCard) return;
    // Commit the failure now that the user has seen the answer.
    await fetch("/api/vocab/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId: currentCard.id, result: "0" }),
    }).catch(() => {});
    setExitingId(currentCard.id);
    setStage("exiting");
    setTimeout(() => {
      setCards((cs) => cs.slice(1));
      setExitingId(null);
      setAnswer("");
      setAttempts(0);
      setRevealedDescription(null);
      setStage((prev) => (prev === "exiting" ? "ready" : prev));
    }, EXIT_DURATION_MS);
  }

  // When cards array becomes empty (post-exit), surface the empty state.
  useEffect(() => {
    if (cards.length === 0 && stage !== "loading" && stage !== "exiting" && stage !== "empty" && stage !== "error") {
      setStage("empty");
    }
  }, [cards.length, stage]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSubmit();
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

        {(stage === "ready" ||
          stage === "judging" ||
          stage === "feedback-x" ||
          stage === "feedback-0" ||
          stage === "revealed" ||
          stage === "exiting") &&
          currentCard && (
            <div className="space-y-6">
              <VocabCardStack cards={cards} exitingId={exitingId} />

              {/* Reveal panel — shown after give-up. */}
              {stage === "revealed" && revealedDescription && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                  <p className="text-xs uppercase tracking-wider text-amber-700">Antwort</p>
                  <p className="text-sm text-amber-900">{revealedDescription}</p>
                  <button
                    onClick={handleNextAfterReveal}
                    className="mt-2 px-4 py-1.5 rounded-lg bg-amber-900 text-white text-sm hover:bg-amber-800 transition-colors"
                  >
                    Weiter →
                  </button>
                </div>
              )}

              {/* Input + submit + feedback. */}
              {stage !== "revealed" && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={onKeyDown}
                      disabled={stage === "judging" || stage === "exiting"}
                      placeholder="Übersetzung eingeben…"
                      className="flex-1 px-4 py-2.5 rounded-lg border border-neutral-300 bg-white text-base text-neutral-900 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
                    />
                    <button
                      onClick={handleSubmit}
                      disabled={stage === "judging" || stage === "exiting" || !answer.trim()}
                      className="px-5 py-2.5 rounded-lg bg-neutral-900 text-white text-sm hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {stage === "judging" ? "…" : "Antworten"}
                    </button>
                  </div>

                  {stage === "feedback-x" && (
                    <p className="text-sm text-amber-700">
                      Andere Bedeutung von <strong>{currentCard.target_word_original}</strong>. Versuch's
                      nochmal — wir suchen einen anderen Sinn.
                    </p>
                  )}

                  {stage === "feedback-0" && attempts < MAX_ATTEMPTS_BEFORE_GIVEUP && (
                    <p className="text-sm text-rose-600">
                      Nicht richtig. Versuch{attempts > 0 ? ` (${attempts}/${MAX_ATTEMPTS_BEFORE_GIVEUP})` : ""}.
                    </p>
                  )}

                  {stage === "feedback-0" && attempts >= MAX_ATTEMPTS_BEFORE_GIVEUP && (
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <p className="text-rose-600">
                        {attempts}× nicht richtig.
                      </p>
                      <button
                        onClick={handleGiveUp}
                        className="text-neutral-500 hover:text-neutral-800 underline"
                      >
                        Aufgeben & Antwort sehen
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
      </div>
    </main>
  );
}
