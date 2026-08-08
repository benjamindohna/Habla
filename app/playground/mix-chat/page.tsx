"use client";

// Mix-Chat — the REAL chat (voice recording, correction pipeline, AI
// replies), but running on the candidate model mix instead of the
// production task→model mapping. One fixed mix, no knobs: this page
// answers "how does the app FEEL on the new models", not "which model
// wins step X" (that's /playground/model-bench).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConversationView, { type ModelMix } from "@/components/ConversationView";
import type { TargetLanguageSpec } from "@/lib/targetLanguage";

// The candidate mix under test. localize stays on production gpt-4o
// (quality-critical, unchanged on purpose). segment went BACK to
// production mini on 2026-06-12: Gemini 2.5 Flash produced giant
// mismatch chunks (whole half-sentences as one segment instead of
// isolating the 2-3 wrong words) — same failure mode 4o shows. The
// alignment task remains mini's home turf.
const MIX: ModelMix = {
  interpret: "gemini-2.5-flash",
  reply: "claude-haiku-4-5",
};

const MIX_ROWS: Array<{ step: string; model: string; benchId?: string }> = [
  { step: "Interpret (Intent)", model: "Gemini 2.5 Flash (thinking off)", benchId: "gemini-2.5-flash" },
  { step: "Localize (Korrektur)", model: "GPT-4o — wie Production", benchId: undefined },
  { step: "Segment (Alignment)", model: "GPT-4o mini — wie Production (Gemini: zu grobe Chunks)", benchId: undefined },
  { step: "AI-Antwort (Turn + Opener)", model: "Claude Haiku 4.5", benchId: "claude-haiku-4-5" },
];

type CorrectionStyle = "natural" | "transcript_aware";

interface Me {
  nativeLanguage: string;
  targetLanguage: TargetLanguageSpec;
  correctionStyle: CorrectionStyle;
}

interface BenchModelInfo {
  id: string;
  available: boolean;
  keyEnv: string;
}

type PageState =
  | { stage: "loading" }
  | { stage: "intro"; me: Me; missingKeys: string[] }
  | { stage: "starting"; me: Me }
  | { stage: "chat"; me: Me; conversationId: number }
  | { stage: "error"; message: string };

export default function MixChatPage() {
  const router = useRouter();
  const [state, setState] = useState<PageState>({ stage: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/me").then((r) => {
        if (r.status === 401) {
          router.push("/login");
          throw new Error("Not authenticated");
        }
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json() as Promise<Me>;
      }),
      fetch("/api/playground/model-bench").then((r) =>
        r.ok ? (r.json() as Promise<{ models: BenchModelInfo[] }>) : { models: [] },
      ),
    ])
      .then(([me, bench]) => {
        if (cancelled) return;
        const neededIds = new Set(
          MIX_ROWS.map((r) => r.benchId).filter((id): id is string => Boolean(id)),
        );
        const missingKeys = [
          ...new Set(
            bench.models
              .filter((m) => neededIds.has(m.id) && !m.available)
              .map((m) => m.keyEnv),
          ),
        ];
        setState({ stage: "intro", me, missingKeys });
      })
      .catch((err: Error) => {
        if (!cancelled && err.message !== "Not authenticated") {
          setState({ stage: "error", message: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function startChat(me: Me) {
    setState({ stage: "starting", me });
    try {
      const res = await fetch("/api/converse/create-empty", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { conversationId } = (await res.json()) as { conversationId: number };
      setState({ stage: "chat", me, conversationId });
    } catch (err) {
      setState({ stage: "error", message: (err as Error).message });
    }
  }

  if (state.stage === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-400">Lade…</p>
      </main>
    );
  }

  if (state.stage === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-red-500">{state.message}</p>
      </main>
    );
  }

  if (state.stage === "chat") {
    return (
      <ConversationView
        conversationId={state.conversationId}
        topic=""
        initialMessages={[]}
        nativeLanguage={state.me.nativeLanguage}
        targetLanguage={state.me.targetLanguage}
        correctionStyle={state.me.correctionStyle}
        modelMix={MIX}
        onBack={() => router.push("/playground/mix-chat")}
        onLogout={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
        }}
      />
    );
  }

  // intro / starting
  const me = state.me;
  const missingKeys = state.stage === "intro" ? state.missingKeys : [];

  return (
    <main className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6">
        <h1 className="text-xl font-semibold tracking-tight">Mix-Chat</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Der ganz normale Chat — nur dass unter der Haube der Kandidaten-Mix läuft statt des
          Production-Setups. Einfach reden wie immer.
        </p>

        <table className="mt-4 w-full text-sm">
          <tbody>
            {MIX_ROWS.map((row) => (
              <tr key={row.step} className="border-t border-neutral-100">
                <td className="py-2 pr-3 text-neutral-500">{row.step}</td>
                <td
                  className={
                    "py-2 " + (row.benchId ? "text-neutral-900 font-medium" : "text-neutral-400")
                  }
                >
                  {row.model}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {missingKeys.length > 0 && (
          <p className="mt-4 text-xs text-red-500">
            Fehlende Keys in .env.local: {missingKeys.join(", ")} — betroffene Schritte würden
            fehlschlagen. Erst Keys eintragen, dann Dev-Server neu starten.
          </p>
        )}

        <button
          onClick={() => startChat(me)}
          disabled={state.stage === "starting" || missingKeys.length > 0}
          className="mt-5 w-full px-5 py-3 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state.stage === "starting" ? "Starte…" : "Chat starten"}
        </button>
      </div>
    </main>
  );
}
