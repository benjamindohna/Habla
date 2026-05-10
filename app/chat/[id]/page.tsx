"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ConversationView, { type InitialMessage } from "@/components/ConversationView";

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

interface ConversationData {
  conversation: {
    id: number;
    topic: string;
    created_at: number;
    ended_at: number | null;
  };
  messages: Array<{
    id: number;
    role: "ai" | "user";
    textTarget: string;
  }>;
}

type LoadState =
  | { stage: "loading" }
  | { stage: "ok"; me: Me; data: ConversationData }
  | { stage: "error"; message: string };

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conversationId = Number(params.id);

  const [state, setState] = useState<LoadState>({ stage: "loading" });

  useEffect(() => {
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      setState({ stage: "error", message: "Invalid chat id" });
      return;
    }
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
      fetch(`/api/conversations/${conversationId}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load conversation (HTTP ${r.status})`);
        return r.json() as Promise<ConversationData>;
      }),
    ])
      .then(([me, data]) => {
        if (!cancelled) setState({ stage: "ok", me, data });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ stage: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, router]);

  if (state.stage === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-400">Loading chat…</p>
      </main>
    );
  }

  if (state.stage === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-sm text-red-500">{state.message}</p>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-neutral-500 hover:text-neutral-800 transition-colors underline"
          >
            ← back to home
          </button>
        </div>
      </main>
    );
  }

  const initialMessages: InitialMessage[] = state.data.messages.map((m) => ({
    id: m.id,
    role: m.role,
    textTarget: m.textTarget,
  }));

  return (
    <ConversationView
      conversationId={state.data.conversation.id}
      topic={state.data.conversation.topic}
      initialMessages={initialMessages}
      nativeLanguage={state.me.nativeLanguage}
      correctionStyle={state.me.correctionStyle}
      onBack={() => router.push("/")}
      onLogout={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
      }}
    />
  );
}
