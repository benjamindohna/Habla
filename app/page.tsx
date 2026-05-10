"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopicGrid, { type Topic } from "@/components/TopicGrid";

interface TopicWithKind extends Topic {
  kind: "match" | "related" | "random";
}

type CorrectionStyle = "natural" | "transcript_aware";

interface Me {
  id: number;
  email: string;
  nativeLanguage: string;
  level: number;
  interests: string[];
  interestsText: string;
  correctionStyle: CorrectionStyle;
}

export default function Page() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  // True while we're starting a new conversation (post tile-tap, awaiting
  // /api/converse/start, before navigation to /chat/[id]).
  const [starting, setStarting] = useState<string | null>(null);

  // Topics for the home grid. null = loading; [] = error fetching first set.
  const [topics, setTopics] = useState<TopicWithKind[] | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [rerolling, setRerolling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load profile"))))
      .then((data: Me) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) router.push("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Fetch the current set on mount. Should be instant if `npm run warm` was
  // run; otherwise the endpoint generates lazily and waits.
  useEffect(() => {
    if (!me || topics !== null) return;
    let cancelled = false;
    fetch("/api/topics/current")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load topics"))))
      .then((data: { topics: TopicWithKind[] }) => {
        if (!cancelled) setTopics(data.topics);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setTopics([]);
          setTopicsError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [me, topics]);

  async function handleReroll() {
    if (rerolling) return;
    setRerolling(true);
    setTopicsError(null);
    try {
      const res = await fetch("/api/topics/reroll", { method: "POST" });
      if (!res.ok) throw new Error("Re-roll failed");
      const data = (await res.json()) as { topics: TopicWithKind[] };
      setTopics(data.topics);
    } catch (err) {
      setTopicsError((err as Error).message);
    } finally {
      setRerolling(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function handleStyleChange(style: CorrectionStyle) {
    if (!me || me.correctionStyle === style) return;
    // Optimistic update — revert if the server rejects.
    const previous = me.correctionStyle;
    setMe({ ...me, correctionStyle: style });
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correctionStyle: style }),
      });
      if (!res.ok) throw new Error("update failed");
    } catch {
      setMe({ ...me, correctionStyle: previous });
    }
  }

  async function enterChat(topic: Topic) {
    if (starting) return;
    setStarting(topic.target);
    // Fire-and-forget: record the tap so future topic generations drift toward
    // what the user actually engages with. Failure is non-blocking.
    fetch("/api/me/interests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interest: topic.target }),
    }).catch(() => {});

    try {
      const res = await fetch("/api/converse/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.target }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { conversationId: number; text: string };
      router.push(`/chat/${data.conversationId}`);
    } catch (err) {
      console.error("[enterChat]", err);
      setStarting(null);
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  // ── Home ────────────────────────────────────────────────────────────────
  const showLoading = topics === null;
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="w-full max-w-xl flex items-center justify-between mb-12">
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          Correction style
          <select
            value={me.correctionStyle}
            onChange={(e) => handleStyleChange(e.target.value as CorrectionStyle)}
            className="text-xs text-neutral-600 bg-transparent border border-neutral-200 rounded px-2 py-1 focus:outline-none focus:border-neutral-400 cursor-pointer"
          >
            <option value="natural">Natural Spanish</option>
            <option value="transcript_aware">Stay close to my words</option>
          </select>
        </label>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/vocab/practice")}
            className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            Übersetzen →
          </button>
          <button
            onClick={() => router.push("/vocab/sentence")}
            className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            Anwenden →
          </button>
          <button
            onClick={handleLogout}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="w-full max-w-xl flex flex-col items-center gap-8 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight text-center">
          Hola, ¿de qué quieres hablar hoy?
        </h1>

        <TopicGrid topics={topics ?? []} onSelect={enterChat} disabled={showLoading || rerolling || starting !== null} />

        {topicsError && <p className="text-xs text-red-500">{topicsError}</p>}
        {starting !== null && (
          <p className="text-xs text-neutral-400">Starting chat about &ldquo;{starting}&rdquo;…</p>
        )}

        <button
          onClick={handleReroll}
          disabled={showLoading || rerolling}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {showLoading ? "Loading topics…" : rerolling ? "Re-rolling…" : "Re-roll topics"}
        </button>
      </div>
    </main>
  );
}
