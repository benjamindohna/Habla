// Server-rendered vocab menu. The user's language labels are filled in
// on the server during the render, so the page arrives at the browser
// with no loading flicker. No client-side hydration / fetching needed.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { languageLabel } from "@/lib/languageLabels";

export default async function VocabMenuPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserById(session.userId);
  if (!user) redirect("/login");

  const targetLabel = languageLabel(user.targetLanguage.language, user.nativeLanguage);
  const nativeLabel = languageLabel(user.nativeLanguage, user.nativeLanguage);

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="w-full max-w-xl flex items-center mb-12">
        <Link
          href="/"
          className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          ← Home
        </Link>
      </div>

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
    </main>
  );
}
