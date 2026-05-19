// Static, server-rendered privacy page. Plain HTML — no client JS, no
// auth required, no client-side state. Linkable from the homepage
// footer and from the App Store / TestFlight listing.

import Link from "next/link";

export const metadata = {
  title: "Datenschutz · Habla",
  description: "Was Habla mit deinen Daten macht — und was nicht.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link
          href="/"
          className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          ← Zurück
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 mt-8 mb-2">
          Datenschutz
        </h1>
        <p className="text-sm text-neutral-500 mb-8">
          Stand: Mai 2026. Habla ist ein Hobby-Projekt zum Erlernen von Sprachen.
          Diese Seite beschreibt klipp und klar, was die App mit deinen Daten
          macht — und was nicht.
        </p>

        <Section title="Welche Daten wir verarbeiten">
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <strong>Email-Adresse + Passwort-Hash</strong> — für deinen Login.
              Das Passwort wird nicht im Klartext gespeichert, sondern als
              bcrypt-Hash.
            </li>
            <li>
              <strong>Sprach-Aufnahmen</strong> — die Audios, die du beim
              Reden ins Mikrofon sprichst. Diese werden zur Transkription
              an OpenAI gesendet.
            </li>
            <li>
              <strong>Chat-Verläufe</strong> — die Konversationen, die du mit
              dem KI-Sprach-Partner führst, samt der korrigierten Versionen
              deiner Sätze.
            </li>
            <li>
              <strong>Vokabel-Daten</strong> — Wörter, die du im Chat antippst
              oder über die Vokabel-Übung markierst, deren englische
              Sinn-Beschreibung, deutsche Übersetzung und Lernstand
              (SRS-Stage).
            </li>
            <li>
              <strong>Lernfortschritt</strong> — dein aktuelles Sprach-Level
              (1-100), zuletzt 5 von dir gesprochene Sätze (für die adaptive
              Level-Bewertung), Zeitstempel der letzten Aktivität.
            </li>
            <li>
              <strong>Persönliche Einstellungen</strong> — deine
              Muttersprache, deine Lernsprache, dein Korrektur-Stil.
            </li>
          </ul>
        </Section>

        <Section title="Wofür wir die Daten verwenden">
          <p>
            Ausschließlich, um die Sprach-Lern-Funktionalität von Habla
            bereitzustellen — also: korrigierte Übersetzungen anzeigen, KI-
            Antworten generieren, Vokabel-Karten zum Üben anlegen, dein Niveau
            an deinen Fortschritt anpassen. Sonst nichts.
          </p>
        </Section>

        <Section title="Wo deine Daten gespeichert werden">
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <strong>Datenbank (Neon Postgres)</strong> — Region Frankfurt
              (eu-central-1). Alle deine Habla-Daten liegen physisch in
              Deutschland.
            </li>
            <li>
              <strong>OpenAI</strong> — Sprach-Aufnahmen und Konversations-
              Texte werden zur Verarbeitung an OpenAI gesendet
              (Transkription via Whisper, Korrektur und KI-Antworten via
              GPT-Modelle, Audio-Generierung via OpenAI TTS). OpenAI
              speichert API-Daten gemäß ihrer API-Terms nicht zur Modell-
              Training-Nutzung. Audio-Daten haben dort eine maximale
              Speicherzeit von 30 Tagen, danach werden sie automatisch
              gelöscht.
            </li>
            <li>
              <strong>Hosting (Vercel)</strong> — die Web-Anwendung selbst
              läuft auf Vercel-Serverless-Funktionen. Vercel sieht
              Request-Metadaten (IP-Adresse, User-Agent) für die Dauer
              eines Requests; keine Speicherung von Anwendungs-Inhalten.
            </li>
          </ul>
        </Section>

        <Section title="Was wir NICHT tun">
          <ul className="list-disc list-inside space-y-1.5">
            <li>Kein Tracking durch Dritt-Anbieter, kein Google Analytics, kein Facebook-Pixel.</li>
            <li>Kein Verkauf von Daten an Werbe-Plattformen oder Dritte.</li>
            <li>Keine Werbung in der App.</li>
            <li>Keine personalisierten Werbe-Profile.</li>
            <li>Keine Speicherung von Daten anderer Apps oder Tastatur-
              Eingaben außerhalb von Habla.</li>
          </ul>
        </Section>

        <Section title="Deine Rechte">
          <p>
            Gemäß DSGVO hast du jederzeit das Recht auf:
          </p>
          <ul className="list-disc list-inside space-y-1.5 mt-2">
            <li>
              <strong>Auskunft</strong> — eine Kopie aller deiner Daten als
              JSON-Export auf Anfrage
            </li>
            <li>
              <strong>Löschung</strong> — vollständiges Entfernen deines
              Accounts und aller verknüpften Daten
            </li>
            <li>
              <strong>Berichtigung</strong> — Korrektur fehlerhafter Daten
            </li>
            <li>
              <strong>Widerruf</strong> — du kannst jederzeit deine
              Einwilligung zurücknehmen
            </li>
          </ul>
          <p className="mt-3">
            Alles ohne Begründung, jederzeit, durch eine kurze Mail an die
            unten genannte Adresse.
          </p>
        </Section>

        <Section title="Kontakt">
          <p>
            Habla wird von Benjamin Dohna privat entwickelt. Für alle Fragen
            zu Daten, Lösch-Anfragen oder Auskünften:
          </p>
          <p className="mt-2">
            <a
              href="mailto:bennirsk@gmail.com"
              className="text-neutral-900 underline hover:text-neutral-600"
            >
              bennirsk@gmail.com
            </a>
          </p>
        </Section>

        <p className="text-xs text-neutral-400 mt-12 italic">
          Diese Seite wird aktualisiert, wenn sich am Datenfluss etwas ändert.
          Letzte Änderung wird oben mit "Stand" datiert.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-neutral-900 mb-3">{title}</h2>
      <div className="text-sm text-neutral-700 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
