"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type CorrectionStyle = "natural" | "transcript_aware";

interface TargetLanguageSpec {
  language: string;
  location: string | null;
  style: "everyday" | "street" | "office";
}

interface Me {
  id: number;
  email: string;
  nativeLanguage: string;
  targetLanguage: TargetLanguageSpec;
  level: number;
  interests: string[];
  interestsText: string;
  correctionStyle: CorrectionStyle;
}

interface RecentConversation {
  id: number;
  topic: string;
  lastActivity: number;
  messageCount: number;
}

const RECENT_LIMIT = 5;

function relativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `vor ${days} Tag${days === 1 ? "" : "en"}`;
  return new Date(unixSeconds * 1000).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
}

export default function Page() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [starting, setStarting] = useState(false);
  const [recents, setRecents] = useState<RecentConversation[] | null>(null);
  const [showLevelInfo, setShowLevelInfo] = useState(false);

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

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    fetch(`/api/conversations/recent?limit=${RECENT_LIMIT}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load recent chats"))))
      .then((data: { conversations: RecentConversation[] }) => {
        if (!cancelled) setRecents(data.conversations);
      })
      .catch(() => {
        if (!cancelled) setRecents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [me]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function handleStyleChange(style: CorrectionStyle) {
    if (!me || me.correctionStyle === style) return;
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

  async function handleStartChat() {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch("/api/converse/create-empty", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { conversationId: number };
      router.push(`/chat/${data.conversationId}`);
    } catch (err) {
      console.error("[handleStartChat]", err);
      setStarting(false);
    }
  }

  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

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
            <option value="natural">Natural</option>
            <option value="transcript_aware">Stay close to my words</option>
          </select>
        </label>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <span className="text-xs text-neutral-500 tabular-nums">Level {me.level}</span>
            <button
              onClick={() => setShowLevelInfo(true)}
              aria-label="Wie funktioniert das Level?"
              className="w-4 h-4 rounded-full border border-neutral-300 text-neutral-400 text-[10px] leading-none flex items-center justify-center hover:border-neutral-500 hover:text-neutral-600 transition-colors"
            >
              ?
            </button>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {showLevelInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
          onClick={() => setShowLevelInfo(false)}
        >
          <div
            className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-neutral-800">Wie funktioniert das Level?</p>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Alle 24 Stunden sieht sich ein vertraulicher Algorithmus deine letzten Chat-Aufnahmen an
              und entscheidet, ob du Fortschritte machst oder ob dein Level lieber einen Schritt
              heruntergesetzt werden soll.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowLevelInfo(false)}
                className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-md flex flex-col items-stretch gap-3 mt-8">
        <button
          onClick={handleStartChat}
          disabled={starting}
          className="w-full px-6 py-5 rounded-2xl bg-neutral-900 text-white text-base font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {starting ? "Starte…" : "Neuen Chat starten"}
        </button>
        <button
          onClick={() => router.push("/vocab")}
          className="w-full px-6 py-5 rounded-2xl border border-neutral-200 bg-white text-neutral-900 text-base font-medium hover:border-neutral-400 transition-colors"
        >
          Vokabeln lernen
        </button>
      </div>

      {recents !== null && recents.length > 0 && (
        <div className="w-full max-w-md mt-12 mb-12">
          <p className="text-xs uppercase tracking-wider text-neutral-400 mb-3">Letzte Chats</p>
          <ul className="space-y-1">
            {recents.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => router.push(`/chat/${c.id}`)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors text-left"
                >
                  <span className="text-sm text-neutral-800 truncate">
                    {c.topic || "Freies Gespräch"}
                  </span>
                  <span className="text-xs text-neutral-400 shrink-0 tabular-nums">
                    {relativeTime(c.lastActivity)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="w-full max-w-md mt-auto pt-8 pb-4 text-center">
        <button
          onClick={() => router.push("/privacy")}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Datenschutz
        </button>
      </footer>
    </main>
  );
}
