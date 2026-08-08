# Latenz-Optimierung — Stand der Umsetzung (2026-08-08)

Umsetzung der Spezifikation "Latenz-Optimierung der Sprachlern-App".
Dieses Dokument hält fest, was gebaut ist, wo die Spec-Annahmen vom
tatsächlichen Code abwichen und was bewusst offen bleibt.

---

## Umgesetzt

### Änderung 1 — Satzweise Vorab-Annotation (statt Live-Lookup)

- `lib/annotate.ts`: ein Call pro angezeigtem Text (nicht pro Wort).
  Alle Wort-Indizes werden in Spans partitioniert (Einzelwort oder
  Mehrwort-Einheit: Kollokation, zusammengesetzte Zeit, Light-Verb-Idiom,
  feste Wendung, Named Entity), jede Span mit deutscher Glosse.
  Gruppierungs- und Übersetzungsregeln sind 1:1 aus dem bewährten
  Per-Tap-Prompt (`translateWordInContext`) übernommen.
- Zwei Cache-Ebenen wie spezifiziert:
  - Client: Annotation liegt nach dem Prefetch im Bubble-State; Taps
    sind reine lokale Lookups (kein Netzwerk-Roundtrip).
  - Server: globale Tabelle `sentence_annotations` (Migration
    `drizzle/0004_*`), Key = sha256 über normalisierten Text (Trim +
    Whitespace + NFC; Casing/Interpunktion bleiben) + Muttersprache +
    Zielsprache + Prompt-Version + Modell. Modell-/Promptwechsel
    invalidieren logisch über den Key — kein Cleanup nötig.
    Gemessen: Erst-Generierung ~1,0–1,5 s, Cache-Hit ~65 ms.
- In-Flight-Dedup serverseitig (Promise-Map): Client-Fetch und
  Server-Warm-up desselben Satzes teilen sich EINEN LLM-Call.
- Fallback exakt wie spezifiziert: Tap vor Fertigstellung wartet auf
  den laufenden Call (Spinner, kein Zweit-Call). Zusätzlich: Spans, für
  die der Annotator keine Glosse geliefert hat, fallen pro Wort auf den
  alten Live-Endpoint `/api/playground/translate` zurück — Qualität geht
  vor, ein halb kaputter Annotations-Call blockiert nie einen Lookup.
- Vocab-Save-Verhalten unverändert: erster Tap auf eine Span feuert
  `/api/me/vocab` mit der Span als Segment (einmal pro Span pro Bubble).

**Abweichung von der Spec:** Annotiert wird pro *angezeigtem Textblock*
(AI-Bubble = 1–3 Sätze), nicht pro Einzelsatz. Grund: Die Bubble ist die
tatsächliche Lookup-Oberfläche, das Modell sieht so den vollen Kontext,
und Satz-Splitting-Heuristiken entfallen. Cache-Granularität bleibt hoch
genug (Openers/Korrektursätze wiederholen sich als ganze Texte).

### Änderung 2 — Annotation im Korrektur-Flow

Variante A wie empfohlen: Die Korrektur-Generierung ist unverändert;
sobald `localize` fertig ist, wärmt der Server die Annotation der
korrigierten Version fire-and-forget vor (`warmAnnotation` in
`/api/correct/stream`). Auch AI-Reply und Opener wärmen ihre Annotation
direkt nach Generierung (`/api/converse/turn`, `/api/converse/start`).

### Änderung 3 — Streaming der LLM-Antworten

- `lib/llm.ts:chatTextStream` — gleiche Modelle, gleiche Parameter,
  Tokens inkrementell; Usage-Logging via `stream_options.include_usage`.
- `/api/correct/stream` (SSE): `interpretation` → `localize_delta`* →
  `localized` → `result` (mit Pairs). Client zeigt Interpretation nach
  ~1 s, die korrigierte Version wächst tokenweise, Chips erscheinen wenn
  das Alignment fertig ist. Timing pro Schritt wird geloggt (`[timing]`).
- `/api/converse/turn` + `/api/converse/start` unterstützen
  `stream: true` (SSE); alte JSON-Shape bleibt für Playground-Seiten.
- Chat (`ConversationView`) und Frei-Tab nutzen die Streams; AIBubble
  bekommt eine `streaming`-Prop, damit TTS-Preload und Annotation erst
  nach dem letzten Token feuern.
- ASR bleibt Batch — wie in der Spec ausdrücklich verlangt.

**Abweichung von der Spec (geprüft, nicht parallelisiert):** `localize`
braucht die Interpretation als Input — beim Default-Stil "natural" IST
die Interpretation der Input, beim Stil "transcript_aware" steht sie als
INTENT im Prompt. Parallelisieren hieße, dem qualitätskritischen Schritt
Input wegzunehmen → sequenziell belassen, dafür gestreamt.
Time-to-first-text = Interpret-Latenz (chat_light) statt voller Kette.
**Kleine bewusste Änderung:** Der Streaming-`localize` gibt Plaintext
statt JSON zurück (nur der Format-Schwanz des Prompts unterscheidet
sich; Regeln + Modell identisch) — nötig, damit Tokens renderbar sind.

### Änderung 4 — Modellwahl pro Teilaufgabe

- Neuer Task-Slot `annotate` in `TASK_MODELS` → **gemini-3.1-flash-lite**
  (thinking off via `reasoning_effort: "none"`), Fallback auf
  `chat_light`, wenn `GEMINI_API_KEY` fehlt.
- **Spec-Korrektur:** `gemini-2.5-flash-lite` ist für neue API-Nutzer
  bereits abgeschaltet (404, Sunset 16.10.2026) — direkt gegen den
  Nachfolger 3.1 gebaut, wie von der Spec alternativ vorgesehen.
  Preise in `lib/llmPricing.ts` ergänzt ($0,25/$1,50 pro 1M).
- **Spec-Annahme korrigiert:** Produktion lief nie auf Gemini/Sonnet,
  sondern auf gpt-4o (localize, Replies) + gpt-4o-mini (interpret,
  segment). Diese qualitätskritischen Zuordnungen sind unangetastet.
- Offen (bewusst): der 30–50-Sätze-Eval für die Annotations-Modellwahl
  (Flash-Lite vs. Haiku vs. Groq/Cerebras-Klasse). Das Bench-Playground
  (`/playground/model-bench`) liefert die Infrastruktur dafür.

### Änderung 7 — Prompt-/Infrastruktur-Hygiene (teilweise)

- Alle Provider-Clients sind prozessweite Singletons (Keep-Alive über
  das OpenAI-SDK) — war schon so, bleibt so.
- Annotations-Prompt in statischen System-Teil (implizites Provider-
  Prompt-Caching) + minimalen variablen User-Teil gesplittet.
- `max_tokens`-Caps: localize-Stream 700, Annotation 3000.
- Timing-Logs: `[timing] correct/stream interpret=…ms localize=…ms
  segment=…ms total=…ms`, analog für Annotation und Replies — damit
  LLM- vs. Infra-Anteile sichtbar sind (Baseline-Messung der Spec).

---

## Nicht umgesetzt (bewusst, mit Grund)

- **Änderung 5 (Audio-Upload während der Aufnahme):** Chunked Upload
  braucht serverseitig zustandsbehaftete Upload-Sessions. Auf Serverless
  (Vercel Functions) teilen sich Chunks und Finalize-Request keinen
  Prozess — das Design muss erst geklärt werden (WebSocket-Service,
  Blob-Store-Chunks, oder ein einzelner Streaming-Request mit
  `duplex: half`, den iOS-WebViews nur eingeschränkt können). Erwartete
  Ersparnis 0,5–1 s; lohnt sich, aber als eigener Schritt.
- **Änderung 6 (optimistisches Vorarbeiten / VAD):** Laut Spec explizit
  nach 1–5 einzuordnen; erzeugt verworfene Calls. Noch nicht begonnen.
- **Änderung 4-Eval:** siehe oben — Modellwahl für Annotation ist
  provisorisch auf Flash-Lite, der Mini-Eval steht aus.

## Philosophie auf den Vokabeltrainer angewandt — Befund

Der Trainer erfüllt die Mission bereits weitgehend (frühere Sessions):
Recognition-Judge ist Self-Judge (0 ms), SRS-Commits sind
fire-and-forget mit Instant-Dismiss, TTS wird pro sichtbarer Karte
geprefetcht, Übersetzung + Hinweis kommen gecacht mit dem Queue-Payload.
Verbleibender LLM-blockierender Pfad: der Judge im Satz-Produktionsmodus
(`/api/vocab/judge-sentence`) — qualitätskritisch, daher nicht auf ein
kleineres Modell gedrückt; Kandidat für den Bench, nicht für Blindtausch.

## Bekannte Punkte fürs Testen

- **`OPENAI_API_KEY` in `.env.local` ist ungültig (401).** Alle
  gpt-4o-Pfade (interpret/localize/segment/Replies/Transkription)
  schlagen lokal fehl, bis der Key erneuert ist — unabhängig von diesem
  Umbau. Gemini- und xAI-Keys funktionieren (live getestet).
- Abnahmekriterien, sobald der Key steht: Tap auf annotiertes Wort
  < 100 ms lokal ✓ (Design), Erst-Token Korrektur ≈ Interpret-Latenz
  (~0,8–1,2 s statt 4–5 s Spinner), Cache-Hit ohne API-Call ✓ (65 ms
  gemessen), kontextabhängige Gruppierung ✓ (Stichprobe: "sin embargo",
  "me di cuenta de", "al Real Madrid" korrekt gruppiert).
