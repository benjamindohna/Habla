"use client";

// Production-mode vocab practice. The learner sees the word and must
// PRODUCE a sentence using it that demonstrates real understanding.
// Shares queue, commit, explain, and SRS state with /vocab/practice
// (recognition mode) — only the judge endpoint and a few UX strings
// differ. See app/api/vocab/judge-sentence/route.ts for the prompt
// design rationale.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import VocabCardStack, { type VocabCardData } from "@/components/VocabCardStack";

type Stage = "loading" | "ready" | "judging" | "feedback-x" | "revealed" | "exiting" | "empty" | "error";

type RevealReason = "wrong" | "three-x" | "gave-up";

interface QueueResponse {
  cards: Array<{
    id: number;
    target_word_original: string;
    english_description: string;
    stage: number;
    last_seen: number;
  }>;
}

interface ServerCard extends VocabCardData {
  english_description: string;
}

interface Explanation {
  translation: string;
  hint: string;
}

const EXIT_DURATION_MS = 400;
const MAX_X_ATTEMPTS = 3;

export default function VocabSentencePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [cards, setCards] = useState<ServerCard[]>([]);
  const [exitingId, setExitingId] = useState<number | null>(null);
  const [sentence, setSentence] = useState("");
  const [xAttempts, setXAttempts] = useState(0);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [revealReason, setRevealReason] = useState<RevealReason | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (stage === "ready" || stage === "feedback-x") {
      inputRef.current?.focus();
    }
  }, [stage, cards.length]);

  const currentCard = cards[0];

  function dismissCurrentAfterCommit() {
    if (!currentCard) return;
    setExitingId(currentCard.id);
    setStage("exiting");
    setTimeout(() => {
      setCards((cs) => cs.slice(1));
      setExitingId(null);
      setSentence("");
      setXAttempts(0);
      setExplanation(null);
      setRevealReason(null);
      setStage((prev) => (prev === "exiting" ? "ready" : prev));
    }, EXIT_DURATION_MS);
  }

  async function fetchExplanation(rowId: number) {
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

  async function handleSubmit() {
    if (stage !== "ready" && stage !== "feedback-x") return;
    if (!currentCard) return;
    const trimmed = sentence.trim();
    if (!trimmed) return;

    setStage("judging");
    try {
      const res = await fetch("/api/vocab/judge-sentence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId: currentCard.id, userSentence: trimmed }),
      });
      if (!res.ok) throw new Error(`Judge failed (HTTP ${res.status})`);
      const data = (await res.json()) as { result: "1" | "X" | "0"; english_description: string };

      if (data.result === "1") {
        await fetch("/api/vocab/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: currentCard.id, result: "1" }),
        }).catch(() => {});
        dismissCurrentAfterCommit();
      } else if (data.result === "X") {
        const next = xAttempts + 1;
        if (next >= MAX_X_ATTEMPTS) {
          setRevealReason("three-x");
          setStage("revealed");
          setSentence("");
          fetchExplanation(currentCard.id);
        } else {
          setXAttempts(next);
          setStage("feedback-x");
          setSentence("");
        }
      } else {
        setRevealReason("wrong");
        setStage("revealed");
        setSentence("");
        fetchExplanation(currentCard.id);
      }
    } catch (err) {
      console.error("[vocab/judge-sentence]", err);
      setErrorMessage((err as Error).message);
      setStage("error");
    }
  }

  async function handleDontKnow() {
    if (stage !== "ready" && stage !== "feedback-x") return;
    if (!currentCard) return;
    setRevealReason("gave-up");
    setStage("revealed");
    setSentence("");
    fetchExplanation(currentCard.id);
  }

  async function handleNextAfterReveal() {
    if (!currentCard) return;
    await fetch("/api/vocab/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId: currentCard.id, result: "0" }),
    }).catch(() => {});
    dismissCurrentAfterCommit();
  }

  useEffect(() => {
    if (cards.length === 0 && stage !== "loading" && stage !== "exiting" && stage !== "empty" && stage !== "error") {
      setStage("empty");
    }
  }, [cards.length, stage]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSubmit();
  }

  // Sentence-mode-specific X escalation messages.
  function feedbackXMessage(): React.ReactNode {
    if (!currentCard) return null;
    if (xAttempts === 1) {
      return (
        <>
          Dein Satz benutzt <strong>{currentCard.target_word_original}</strong> in einer{" "}
          <strong>anderen Bedeutung</strong>. Versuch's nochmal mit dem getesteten Sinn.
        </>
      );
    }
    return (
      <>
        Kannst du einen Satz bilden, in dem{" "}
        <strong>{currentCard.target_word_original}</strong> in der getesteten Bedeutung
        verwendet wird?
      </>
    );
  }

  function revealHeading(): string {
    if (revealReason === "three-x") {
      return "Du hast die gesuchte Bedeutung nicht getroffen.";
    }
    if (revealReason === "gave-up") {
      return "Antwort:";
    }
    return "Falsch — die gesuchte Bedeutung war:";
  }

  const inputDisabled = stage === "judging" || stage === "exiting";

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
          <h1 className="text-sm font-medium text-neutral-700">Vocab Anwenden</h1>
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
          stage === "revealed" ||
          stage === "exiting") &&
          currentCard && (
            <div className="space-y-6">
              <VocabCardStack cards={cards} exitingId={exitingId} />

              {stage === "revealed" && (
                <div
                  className={`rounded-2xl border p-4 ${
                    revealReason === "three-x"
                      ? "border-amber-200 bg-amber-50"
                      : revealReason === "gave-up"
                      ? "border-neutral-200 bg-white"
                      : "border-rose-200 bg-rose-50"
                  }`}
                >
                  <p
                    className={`text-xs uppercase tracking-wider ${
                      revealReason === "three-x"
                        ? "text-amber-700"
                        : revealReason === "gave-up"
                        ? "text-neutral-500"
                        : "text-rose-700"
                    }`}
                  >
                    {revealHeading()}
                  </p>

                  {explanation === null ? (
                    <p className="mt-2 text-sm italic text-neutral-400">Antwort wird geladen…</p>
                  ) : (
                    <>
                      <p
                        className={`mt-2 text-xl font-medium ${
                          revealReason === "three-x"
                            ? "text-amber-900"
                            : revealReason === "gave-up"
                            ? "text-neutral-900"
                            : "text-rose-900"
                        }`}
                      >
                        {explanation.translation}
                      </p>
                      {explanation.hint && (
                        <p
                          className={`mt-0.5 text-sm ${
                            revealReason === "three-x"
                              ? "text-amber-800"
                              : revealReason === "gave-up"
                              ? "text-neutral-600"
                              : "text-rose-800"
                          }`}
                        >
                          {explanation.hint}
                        </p>
                      )}
                    </>
                  )}

                  <button
                    onClick={handleNextAfterReveal}
                    disabled={explanation === null}
                    className={`mt-5 px-4 py-1.5 rounded-lg text-white text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      revealReason === "three-x"
                        ? "bg-amber-900 hover:bg-amber-800"
                        : revealReason === "gave-up"
                        ? "bg-neutral-800 hover:bg-neutral-700"
                        : "bg-rose-900 hover:bg-rose-800"
                    }`}
                  >
                    Weiter →
                  </button>
                </div>
              )}

              {stage !== "revealed" && (
                <div className="space-y-3">
                  <p className="text-sm text-neutral-600 leading-snug">
                    Bilde einen Satz mit{" "}
                    <strong className="text-neutral-900">
                      {currentCard.target_word_original}
                    </strong>
                    . Das Wort muss exakt so vorkommen, und dein Satz muss zeigen, dass du die
                    Bedeutung verstehst — nicht einfach „er hat sich X". Grammatikfehler im Rest
                    sind OK.
                  </p>

                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={sentence}
                      onChange={(e) => setSentence(e.target.value)}
                      onKeyDown={onKeyDown}
                      disabled={inputDisabled}
                      placeholder={`Beispielsatz mit „${currentCard.target_word_original}"…`}
                      className="flex-1 min-w-0 h-11 px-4 rounded-lg border border-neutral-300 bg-white text-base text-neutral-900 focus:border-neutral-600 focus:outline-none disabled:opacity-50"
                    />
                    <button
                      onClick={handleSubmit}
                      disabled={inputDisabled || !sentence.trim()}
                      className="shrink-0 h-11 px-5 rounded-lg bg-neutral-900 text-white text-sm hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {stage === "judging" ? "…" : "Antworten"}
                    </button>
                    <button
                      onClick={handleDontKnow}
                      disabled={inputDisabled}
                      aria-label="Ich weiß die Vokabel nicht"
                      title="Ich weiß die Vokabel nicht"
                      className="shrink-0 h-11 w-11 rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>

                  {stage === "feedback-x" && (
                    <p className="text-sm text-amber-700">{feedbackXMessage()}</p>
                  )}
                </div>
              )}
            </div>
          )}
      </div>
    </main>
  );
}
