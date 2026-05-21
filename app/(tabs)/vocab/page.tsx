"use client";

// Vocab tab — menu to pick between recognition (Übersetzen) and
// production (Anwenden) practice modes. Pure client-side render now:
// user data comes from MeProvider in the tabs layout, so switching to
// this tab is instant (no server roundtrip for the language labels).
// The two cards are static markup — no DB lookups, no LLM calls.

import Link from "next/link";
import { useMe } from "@/components/MeProvider";
import { languageLabel } from "@/lib/languageLabels";

export default function VocabMenuPage() {
  const me = useMe();
  const targetLabel = languageLabel(me.targetLanguage.language, me.nativeLanguage);
  const nativeLabel = languageLabel(me.nativeLanguage, me.nativeLanguage);

  return (
    <div className="flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md flex flex-col items-stretch gap-3 mt-8">
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-4">
          Vokabeln lernen
        </h1>
        <Link
          href="/vocab/practice"
          className="w-full px-6 py-5 rounded-2xl border border-neutral-200 bg-white text-neutral-900 text-base font-medium hover:border-neutral-400 transition-colors text-left block"
        >
          <span className="block">Übersetzen</span>
          <span className="block mt-1 text-xs text-neutral-500 font-normal">
            {targetLabel} → {nativeLabel} erkennen
          </span>
        </Link>
        <Link
          href="/vocab/sentence"
          className="w-full px-6 py-5 rounded-2xl border border-neutral-200 bg-white text-neutral-900 text-base font-medium hover:border-neutral-400 transition-colors text-left block"
        >
          <span className="block">Anwenden</span>
          <span className="block mt-1 text-xs text-neutral-500 font-normal">
            Vokabel im eigenen Satz benutzen
          </span>
        </Link>
      </div>
    </div>
  );
}
