"use client";

// Single source of truth for the current user across the (tabs) route
// group. Fetched once when the tabs layout first mounts, then served
// from Context to every tab page — switching between Chat / Frei /
// Lernen is instant because no tab does its own /api/me roundtrip.
//
// Lives at the (tabs) layout boundary, so it survives all sibling
// route changes inside the tab bar but unmounts (and refetches) when
// the user navigates away to /chat/[id], /vocab/practice, /login etc.
// That cadence matches how often `me` actually changes in practice.

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TargetLanguageSpec } from "@/lib/targetLanguage";

type CorrectionStyle = "natural" | "transcript_aware";

export interface Me {
  id: number;
  email: string;
  nativeLanguage: string;
  targetLanguage: TargetLanguageSpec;
  level: number;
  interests: string[];
  interestsText: string;
  correctionStyle: CorrectionStyle;
}

const MeContext = createContext<Me | null>(null);

// Module-level cache so even a full unmount + remount of the layout
// (e.g. coming back from /chat/[id] to /) hands the user an instant
// first paint. The cache is refreshed in the background on every
// mount so stale data lives at most one tab-switch long.
let cachedMe: Me | null = null;

export function MeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(cachedMe);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unauth"))))
      .then((data: Me) => {
        if (cancelled) return;
        cachedMe = data;
        setMe(data);
      })
      .catch(() => {
        if (!cancelled) router.push("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!me) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-neutral-600 animate-spin" />
      </div>
    );
  }

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) {
    throw new Error("useMe() called outside MeProvider");
  }
  return me;
}
