"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { languageLabel } from "@/lib/languageLabels";

interface Me {
  nativeLanguage: string;
  targetLanguage: { language: string; location: string | null; style: string };
}

export default function VocabMenuPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

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

  const targetLabel = me ? languageLabel(me.targetLanguage.language, me.nativeLanguage) : "…";
  const nativeLabel = me ? languageLabel(me.nativeLanguage, me.nativeLanguage) : "…";

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="w-full max-w-xl flex items-center mb-12">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          ← Home
        </button>
      </div>

      <div className="w-full max-w-md flex flex-col items-stretch gap-3 mt-8">
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-4">
          Vokabeln lernen
        </h1>
        <button
          onClick={() => router.push("/vocab/practice")}
          className="w-full px-6 py-5 rounded-2xl border border-neutral-200 bg-white text-neutral-900 text-base font-medium hover:border-neutral-400 transition-colors text-left"
        >
          <span className="block">Übersetzen</span>
          <span className="block mt-1 text-xs text-neutral-500 font-normal">
            {targetLabel} → {nativeLabel} erkennen
          </span>
        </button>
        <button
          onClick={() => router.push("/vocab/sentence")}
          className="w-full px-6 py-5 rounded-2xl border border-neutral-200 bg-white text-neutral-900 text-base font-medium hover:border-neutral-400 transition-colors text-left"
        >
          <span className="block">Anwenden</span>
          <span className="block mt-1 text-xs text-neutral-500 font-normal">
            Vokabel im eigenen Satz benutzen
          </span>
        </button>
      </div>
    </main>
  );
}
