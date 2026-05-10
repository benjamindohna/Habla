# Launch Plan — Remote Test Users (Spanish + Italian)

Plan für die Anbindung von zwei remote-Test-Usern:
- **User 1**: Spanisch lernen, Start-Level 5-7
- **User 2**: Italienisch lernen, Start-Level 0-3

Ziel: Beide User können von ihrem eigenen Gerät über eine deployed URL auf
die App zugreifen, ihren Fortschritt machen, und alle Features nutzen.

Stand: 2026-05-10. Geplanter Start: 2026-05-11.

---

## Übersicht — drei Workstreams

| Workstream | Was | Zeit | Block für… |
|---|---|---|---|
| A — Italian Target Language | Phase C (Per-Language-Prompt-Fragmente) + Phase D (Per-User-TargetSpec) aus `TARGET_LANGUAGE_MIGRATION.md` | 6-10h | User 2 (Italienisch) |
| B — Supabase Migration | SQLite → Postgres, async DB layer, deployment-ready Persistenz | 12-16h | Beide User (Remote-Zugriff) |
| C — Remote-User-Readiness | Sign-Up-Form, Audio-Consent, Onboarding, Vercel-Deployment | 4-6h | Beide User (UX + Compliance) |

Total realistisch: **3-4 Arbeitstage**. Phase-Reihenfolge unten.

---

## Decisions, die VOR dem Bauen zu klären sind

Bevor wir morgen Code schreiben, brauche ich Antworten auf 5 Fragen.
Vorschlag pro Punkt mit Begründung — du kannst übernehmen oder ändern.

### D1. Supabase Auth vs. eigener bcrypt-Login?

**Status quo:** Wir haben eigene bcrypt-Auth in `lib/auth.ts` + Sessions in
DB. Funktioniert.

**Supabase Auth** würde liefern: Password-Reset-Email out of the box,
optional Email-Verification, optional Magic-Link, optional OAuth.

**Vorschlag: Supabase Auth.** Begründung: bei Remote-Usern wird
Password-vergessen-Problem real (`benjamin@…` vergisst sein Passwort, du
musst dann per SQL bcrypt-hashen — ätzend). Supabase Auth löst das.
Trade-off: Auth-Code refactorn (~2-3h) statt einfach pg-driver wechseln.

### D2. Audio-Storage: BYTEA in Postgres oder Supabase Storage?

**Status quo:** TTS-Audio in SQLite als BLOB-Spalte auf user_vocab.

**BYTEA in Postgres**: gleicher Pattern, kleinste Code-Änderung.
**Supabase Storage**: signed URLs, CDN-Delivery, off-DB. Idiomatischer.

**Vorschlag: BYTEA für jetzt.** Begründung: 2 User × ~500 Vokabel-Audios
× ~10KB = ~10MB total. Postgres handled das trivial. Storage-Refactor
wäre 4-6h Mehrarbeit ohne UX-Win bei 2 Usern. Wenn wir später skalieren
(50+ User), umstellen.

### D3. Bestehende Dev-DB-Daten migrieren oder frisch starten?

**Status quo:** Lokale SQLite hat dein Test-Account + 47 Vocab-Rows +
Chat-Verlauf.

**Vorschlag: deinen Account + Vocab migrieren, Chat-Verlauf wegwerfen.**
Begründung: Vocab + Stages sind echter Trainings-Fortschritt, ärgerlich
zu verlieren. Chat-Historie ist Test-Daten, kann weg. Migrations-Skript
liest deine 47 user_vocab-Rows + recent_inputs + Asset-Blobs aus SQLite
und schreibt sie in Postgres. ~1h Arbeit.

### D4. Italienische Variante: Standard-Italienisch oder regional?

**Status quo:** Spanisch ist hardcoded auf Castellano (Spanien).
`lib/targetLanguage.ts` hat eine `location`-Eigenschaft pro Sprache.

**Vorschlag: Standard-Italienisch („italiano standard"), kein regionaler
Akzent.** Begründung: User 2 ist Anfänger (Level 0-3). Wird vermutlich
keine regionalen Präferenzen haben. Standard-Italienisch ist neutralste
Wahl. Italienisch hat ohnehin weniger ausgeprägte regionale Schrift-
Unterschiede als Spanisch (Castellano vs. Latam).

### D5. Hosting-Target?

**Vorschlag: Vercel.** Begründung:
- Next.js-Native, Zero-Config-Deployment
- Free-Tier reicht für 2 Test-User
- Environment-Variablen für Supabase-Connection trivial
- Auto-Deploy bei `git push` auf branch (wir machen einen `production`-branch)

Alternativen: Railway (Container-basiert, persistent volume möglich aber
nicht nötig wenn DB extern), Render (ähnlich).

**Vercel + Supabase = Standard-Stack** für Next.js-Apps mit Postgres.
Alles andere wäre Sonderwunsch.

---

## Workstream A — Italian Target Language

Maps auf Phase C + D aus `TARGET_LANGUAGE_MIGRATION.md`. Inhaltlich:

### A.1 — Phase C: Per-Language-Prompt-Fragmente

Neue Datei `lib/targetLanguagePrompts.ts` mit pro-Sprache-Tabellen:

```ts
export interface TargetLanguagePromptFragments {
  articles: string[];               // Artikel für Grouping-Regel
  compoundTenseRule: string;         // Multi-Wort-Verbal-Gruppierungs-Regel
  idiomRule: string;                 // Idiom-Gruppierungs-Regel + Beispiele
  namedEntityRule: string;           // Multi-Wort-Eigennamen-Regel
  ttsInstructions: string;           // TTS-Akzent/Aussprache
}

export const PROMPT_FRAGMENTS: Record<string, TargetLanguagePromptFragments> = {
  Spanish: { /* aktueller Spanisch-Inhalt aus aiBubblePipeline + correctionPipeline */ },
  Italian: { /* neuer Italienisch-Inhalt */ },
};
```

**Italienische Inhalte zu schreiben:**

| Fragment | Inhalt für Italienisch |
|---|---|
| `articles` | `["il", "la", "lo", "l'", "i", "gli", "le", "un", "uno", "una", "un'"]` |
| `compoundTenseRule` | „avere/essere + past participle (ho mangiato, sono andato/a, mi sono lavato/a), stare + gerundio (sto mangiando), andare a + infinitive (vado a fare)" + Erklärung essere/avere-Wahl + Adjektiv-Übereinstimmung beim essere-Hilfsverb |
| `idiomRule` | Italienische Idiome: avere voglia di (Lust haben), rendersi conto (merken), mancare a (vermissen — beachte: subject-object-flip „mi manca"), per esempio, in ogni caso, ad ogni modo |
| `namedEntityRule` | Roma, Milano, Italia, Stati Uniti, Real Madrid (auch in Italienisch so), Coca-Cola, Pizza Margherita |
| `ttsInstructions` | Standard-Italienisch klar aussprechen, Vokal-Endungen deutlich, geschlossene/offene Vokale unterscheiden, doppelte Konsonanten (geminate) hörbar machen — z.B. „casa" vs „cassa" |

**Consumer umstellen:**
- `lib/aiBubblePipeline.ts` (translateWordInContext) — Articles + CompoundTense + Idiom + NamedEntity aus Fragments lesen statt hardcoded
- `lib/correctionPipeline.ts` (segmentPromptV2) — gleiche Stellen
- `lib/vocabTts.ts` — `instructions` aus `ttsInstructions` ziehen
- `app/api/tts/route.ts` — auch (das ist die Chat-TTS-Route)

**Aufwand: ~3-4h.** Davon ~2h fürs Italienisch-Schreiben (hand-curated, mit
Selbst-Test), ~1-2h fürs Umstellen der Consumer.

### A.2 — Phase D: Per-User-TargetSpec

Migration `0009_per_user_target_language.sql`:

```sql
ALTER TABLE users ADD COLUMN target_language TEXT NOT NULL DEFAULT 'Spanish';
ALTER TABLE users ADD COLUMN target_location TEXT;
ALTER TABLE users ADD COLUMN target_style TEXT NOT NULL DEFAULT 'everyday';
```

**Code-Änderungen:**
- `lib/users.ts`: User-Type um `targetSpec: TargetLanguageSpec` erweitern,
  `rowToUser` baut aus den 3 Spalten den Spec
- Alle Stellen die `DEFAULT_TARGET` verwenden umstellen auf
  `user.targetSpec` aus der Session:
  - `aiBubblePipeline.ts` — bekommt targetSpec als Parameter
  - `correctionPipeline.ts` (interpret, localize, segment) — selber
  - `app/api/converse/start/route.ts`, `app/api/converse/turn/route.ts`
  - `app/api/correct/route.ts`
  - `lib/vocab.ts` — generateVocabDescription, judgeVocabAnswer, etc.
  - `lib/vocabExplain.ts`, `lib/vocabTts.ts`
  - `lib/levels.ts` describeLevelForPrompt (eigentlich language-agnostic
    aber wir wollen die CEFR-Anker konsistent halten)
- Default für existierende User (= du): `target_language='Spanish'`,
  `target_location='castellano'`, `target_style='everyday'` — kein Change.

**Aufwand: ~2-3h.** Hauptarbeit ist die ~15 Call-Sites umzustellen.

### A.3 — Test-Pass für Italienisch

End-to-End-Test gegen einen Italienisch-User-Account:
1. Account anlegen mit `target_language='Italian'`, Level 0-5
2. Chat starten zu einem Topic
3. AI-Bubble auf Italienisch? Komplexität level-passend?
4. Wort-Tap: Italienische Artikel/Compound-Tenses korrekt gegruppiert?
5. Korrektur: User sagt was Italienisches + deutsche Wörter → wird's
   korrekt italianisiert?
6. TTS: klingt italienisch (nicht spanisch)?
7. Vokabel-Modus: Italienisches Wort speichern → Explain liefert deutsche
   Übersetzung + Hint?

Wenn was nicht passt, Prompt-Fragments tunen. ~1h Test + Tuning.

---

## Workstream B — Supabase Migration

### B.1 — Supabase-Projekt anlegen

In Supabase Studio:
1. Neues Projekt mit Region `eu-central-1` (Frankfurt — DSGVO + Latenz)
2. Database-Password speichern (in 1Password o.ä.)
3. Connection-Strings notieren:
   - Project URL
   - anon key (frontend-safe)
   - service_role key (backend-only, MAX-Privilegien)
   - direct DB connection string (für Migrations)

**Aufwand: 15 Min.**

### B.2 — DB-Driver-Wechsel

`better-sqlite3` → `pg` (node-postgres):

```bash
npm uninstall better-sqlite3
npm install pg
npm install -D @types/pg
```

`lib/db.ts` refactorn:
- `Database` → `pg.Pool` mit Connection-String aus env
- `db.prepare(sql).run/get/all` → `pool.query(sql, params)` (async)
- Migration-Runner: liest weiter `lib/migrations/*.sql`, führt aber gegen
  Postgres aus (über `pool.query`)

**Schema-Übersetzung pro Migration-File:**
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`
- `BLOB` → `BYTEA`
- `INTEGER` (ms-Timestamps) bleibt INTEGER (Postgres BIGINT)
- `DEFAULT (strftime('%s','now'))` → `DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT`
- `?` Parameter-Placeholder → `$1, $2, ...` Postgres-Style
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`
- `INSERT OR REPLACE` → `INSERT ... ON CONFLICT ... DO UPDATE`

Alternativ: bestehende SQL-Files leicht editieren oder einen kompatiblen
Wrapper bauen, der SQLite-Syntax → Postgres-Syntax übersetzt. Erfahrung:
Wrapper-Approach ist Quelle für subtile Bugs. **Empfehlung: Migrationen
sauber für Postgres umschreiben.**

**Aufwand: ~3-4h.** Die meiste Zeit geht in das Umstellen aller ~50+
`db.prepare` Stellen zu `await pool.query` mit Result-Mapping.

### B.3 — Auth-System: Supabase Auth integrieren (per D1)

Wenn D1 = "Supabase Auth":
- `npm install @supabase/supabase-js`
- `lib/auth.ts` refactorn: `getSession` liest Supabase-Token aus Cookie
  statt eigener Session-Tabelle
- Sign-Up + Login-Forms im Frontend nutzen Supabase Auth SDK
- Email-Confirmation: per Default an, oder optional
- Password-Reset-Flow: Supabase-built-in, Email-Template-customizable

Wenn D1 = "bcrypt behalten":
- `users.password_hash` bleibt, `sessions`-Tabelle bleibt, nur pg-async-Refactor

**Aufwand: ~3-4h** (bei Supabase Auth) oder ~1h (bei bcrypt-Behalt).

### B.4 — Audio-Storage (per D2)

Wenn D2 = "BYTEA":
- Migration: `tts_audio BLOB` → `tts_audio BYTEA`
- Endpoint `/api/vocab/tts` schreibt/liest BYTEA-Buffer, gleiche Semantik
- Kein zusätzlicher Refactor

Wenn D2 = "Supabase Storage":
- Neuer Endpoint: `lib/vocabTts.ts` lädt Audio direkt zu Supabase Storage
  hoch, speichert URL auf user_vocab statt BLOB
- `/api/vocab/tts` redirected zur signed URL
- Bestehende Audio-Blobs migrieren: alle 47 Rows hochladen, URL setzen

**Empfehlung: BYTEA.** Aufwand: nur 30 Min (Spaltentyp-Anpassung).

### B.5 — Daten-Migration vom Dev-SQLite zu Supabase

Wenn D3 = "deinen Account + Vocab migrieren":
- Skript `scripts/migrateToSupabase.ts`:
  - Liest aus lokaler `data/habla.db`
  - Schreibt User-Row → `users` in Supabase
  - Schreibt alle `user_vocab`-Rows (inkl. Assets-Blobs) → Postgres
  - Schreibt `recent_inputs_json`, `last_level_check_at`, `level`
  - Optional auch `conversations` + `messages` wenn du den Verlauf
    behalten willst
- Idempotent: re-runnable

**Aufwand: ~1h.**

---

## Workstream C — Remote-User-Readiness

### C.1 — Sign-Up-Form

Neue Route `/signup`:

Felder:
- Email
- Password (bestätigen)
- Native Language (Dropdown: German, English, …)
- Target Language (Dropdown: Spanish, Italian, …)
- Optional: Initial Level (Slider 0-50, default 30)
- Optional: Interests-Text (Freitext)
- Audio-Consent-Checkbox (Pflicht)

Bei Submit: Supabase Auth signUp + Insert in `users`-Tabelle mit
Profil-Daten. Email-Confirmation an oder aus.

**Aufwand: ~2h.**

### C.2 — Audio-Consent-Modal

Modal beim ersten Chat-Start (oder direkt nach Sign-Up):

> **Audio-Aufnahmen**
>
> Diese App nimmt deine Sprach-Aufnahmen auf, um sie zu transkribieren
> und zu korrigieren. Die Aufnahmen werden für 30 Tage gespeichert und
> danach automatisch gelöscht. Transkripte und Korrekturen bleiben
> erhalten.
>
> Du kannst deine Aufnahmen jederzeit löschen lassen (Settings →
> Daten löschen).
>
> [ ] Ich willige in die Audio-Aufnahme ein
>
> [ Bestätigen ]

Persistiert in `users.audio_consent_at` (Timestamp). Ohne Consent: kein
Mic-Zugriff.

**Aufwand: ~1.5h** (Modal + Schema + Gate-Logik).

### C.3 — Onboarding (optional, aber nice)

Direkt nach Sign-Up: 3-Schritte-Wizard
1. „Hi, willkommen. Du lernst {Target}, deine Muttersprache ist {Native}."
2. „Wie schätzt du dein Niveau ein?" — Slider mit aktueller
   `describeLevelForPrompt`-Beschreibung
3. „Welche Themen interessieren dich? (Freitext)"

Sets `level` + `interests_text` auf den User.

**Aufwand: ~1h.** Optional — kann auch in den Sign-Up-Form integriert werden.

### C.4 — Vercel-Deployment

- Projekt in Vercel verknüpfen mit GitHub-Repo
- Environment-Variables setzen:
  - `OPENAI_API_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DATABASE_URL` (direct pg connection)
  - `SESSION_SECRET` (falls Custom-Auth)
- Build-Command: `npm run build`
- Output: Next.js standalone, automatisch
- Branch-Strategie: `main` = production, Feature-Branches = preview-Deploys

**Aufwand: ~30 Min** wenn alles richtig in env-vars liegt.

---

## Timeline — drei Arbeitstage

### Tag 1 (morgen): Supabase Foundation + Italian Phase C

Vormittag (~3-4h):
- D1-D5 final entschieden
- Supabase-Projekt anlegen (B.1)
- pg-Driver-Wechsel (B.2) — Migrationen sauber für Postgres umschreiben
- Test lokal: `npm run dev` mit Supabase als Backend, alles arbeitet noch

Nachmittag (~3-4h):
- Phase C — `lib/targetLanguagePrompts.ts` schreiben (A.1)
- Italienische Inhalte hand-curieren
- Consumer umstellen

End of Day 1: App läuft lokal gegen Supabase, Spanisch funktioniert wie
vorher. Italian-Content existiert in Code aber noch nicht aktiviert
(Phase D fehlt).

### Tag 2: Italian Phase D + Auth-Refactor

Vormittag (~3-4h):
- Phase D — per-User-TargetSpec (A.2)
- Italian-Test-Pass: Account anlegen mit `target_language='Italian'`,
  End-to-End testen (A.3). Tunen falls nötig.

Nachmittag (~3-4h):
- Auth-Refactor: Supabase Auth oder pg-async-bcrypt (B.3 je nach D1)
- Sign-Up-Form (C.1)

End of Day 2: Beide Sprachen funktionieren, neue User können sich selbst
anmelden, Auth läuft sauber.

### Tag 3: Storage + Compliance + Deploy

Vormittag (~2-3h):
- Audio-Storage-Anpassung (B.4 — BYTEA-Migration)
- Optional: Daten-Migration aus Dev-DB (B.5)
- Audio-Consent-Modal (C.2)

Nachmittag (~2-3h):
- Onboarding-Wizard (C.3, optional)
- Vercel-Deployment (C.4)
- End-to-End-Test in production: Account anlegen, Chat, Vokabel,
  Level-Check funktioniert
- Test-User-Accounts vorbereiten und Links rausschicken

End of Day 3: 🚀 Test-User können los.

---

## Risiken / wo's hakelig werden kann

1. **pg-async-Refactor ist die größte Stolperstelle.** Es gibt ~50+
   Stellen mit `db.prepare(...).run/get/all`. Jede muss `await pool.query(...)`
   werden, inklusive aller Aufrufer. Refactor-Pyramide: Eine
   geänderte Function macht alle Aufrufer async. Zeit-Risiko: 1-2h zusätzlich.

2. **Italienisch-Prompts sind ungetestet.** Erste Test-Versionen werden
   Edge-Cases haben (z.B. essere vs. avere falsch zugeordnet). Plane einen
   Tuning-Tag ein wenn der Test-User früh schräges Verhalten meldet.

3. **Supabase EU-Region**: hat manchmal etwas höhere Latenz als US. Bei
   Chat-Korrekturen sollten 200-400ms statt 50ms akzeptabel sein, aber
   prüfen.

4. **DSGVO bei Audio-Storage in EU-Region**: Supabase ist DSGVO-konform
   wenn EU-Region. Reicht für Test-Phase, für Produktiv-Launch trotzdem
   Datenschutz-Hinweis dokumentieren.

5. **Vercel-Free-Tier-Limits**: Function-Timeout 10s default, kann zu kurz
   sein für Korrektur-Pipeline (interpret + localize + segment dauert
   2-5s). Wenn's eng wird: Vercel Pro ($20/mo) gibt 60s Function-Timeout.

---

## Was NICHT im Plan ist (bewusst)

- **Vokabel-Seeding** für neue User → laut Entscheidung bleiben wir bei
  organic-only. Italiener wird mit 0 Vokabeln starten und durch Tappen im
  Chat aufbauen.
- **Backup-Skript** → Supabase macht automatische Daily-Backups. Damit
  abgedeckt.
- **GDPR-Vollanleitung** (Lösch-Workflow, Data-Export-Endpoint, Privacy-
  Policy-Seite) → für 2 Test-User mit deren persönlicher Zustimmung OK
  ohne. Für Produktiv-Launch mit unbekannten Nutzern aufholen.
- **Admin-Dashboard** → Du kannst per Supabase Studio direkt in der DB
  schauen. Reicht für jetzt.

---

## Nächster konkreter Schritt

**Heute Abend** noch von dir: Antworten auf D1-D5 (oder zumindest auf
„geht alle 5 mit deinen Vorschlägen klar"). Morgen früh starte ich mit B.1
(Supabase anlegen) und gehe den Plan oben durch.
