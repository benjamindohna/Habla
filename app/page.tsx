"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopicGrid, { type Topic } from "@/components/TopicGrid";
import ConversationView from "@/components/ConversationView";

interface TopicWithKind extends Topic {
  kind: "match" | "related" | "random";
}

interface Me {
  id: number;
  email: string;
  nativeLanguage: string;
  level: number;
  interests: string[];
  interestsText: string;
}

type AppMode = { kind: "home" } | { kind: "chat"; topic: string };

export default function Page() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<AppMode>({ kind: "home" });

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

  function enterChat(topic: Topic) {
    setMode({ kind: "chat", topic: topic.es });
    // Fire-and-forget: record the tap so future topic generations drift toward
    // what the user actually engages with. Failure is non-blocking.
    fetch("/api/me/interests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interest: topic.es }),
    }).catch(() => {});
  }

  function backToHome() {
    setMode({ kind: "home" });
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  // ── Chat mode ───────────────────────────────────────────────────────────
  if (mode.kind === "chat") {
    return (
      <ConversationView
        topic={mode.topic}
        nativeLanguage={me.nativeLanguage}
        onBack={backToHome}
        onLogout={handleLogout}
      />
    );
  }

  // ── Home mode ───────────────────────────────────────────────────────────
  const showLoading = topics === null;
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="w-full max-w-xl flex items-center justify-end mb-12">
        <button
          onClick={handleLogout}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Sign out
        </button>
      </div>

      <div className="w-full max-w-xl flex flex-col items-center gap-8 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight text-center">
          Hola, ¿de qué quieres hablar hoy?
        </h1>

        <TopicGrid topics={topics ?? []} onSelect={enterChat} disabled={showLoading || rerolling} />

        {topicsError && <p className="text-xs text-red-500">{topicsError}</p>}

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
