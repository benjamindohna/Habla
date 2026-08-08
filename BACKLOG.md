# Backlog

Things to do later — out of scope for the current phase but tracked so they don't get lost. Items here should reference the phase or feature that triggered them.

---

## Auto-vocab extractor: capture non-literal CONSTRUCTIONS, not just lexical gaps

**Trigger:** mix-chat session 2026-06-12 — corrected version contained *"A uno de ellos ya lo conozco, pero al otro no lo conozco"*; extractor saved only single words/short phrases (`prepararme`, `en particular`, …) and skipped the construction entirely.
**Status:** design gap in `lib/extractUnknownVocab.ts`, confirmed empirically; user explicitly wants these as vocab entries.

### Problem

The extractor's UNKNOWN-criteria are purely lexical (native-word substitution, wrong word, dropped content word). Structural patterns the learner cannot produce — here: a-personal + clitic doubling + topicalisation ("A uno… ya LO conozco") — slip through twice over:

1. The learner knew every content word (`conocer`, `uno`, `ellos`) — no lexical trigger fires.
2. The information lives in function words (`a`, `lo`) which the prompt explicitly says to skip.

### Acceptance criterion (user's wording, paraphrased)

A phrase qualifies when **a literal word-by-word translation from the native language would never produce it** — i.e. the pattern is non-compositional across the language pair. From the trigger sentence, exactly these two should have been saved:

- `A uno de ellos ya lo conozco`
- `pero al otro no lo conozco`

### Fix sketch

Add ONE new extraction category to the prompt (alongside the existing lexical rules, not replacing them): "STRUCTURAL PATTERN — a clause from the CORRECT VERSION whose grammar diverges so strongly from the ${nativeLanguage} equivalent that a literal translation would never produce it (clitic doubling, a-personal with topicalisation, se-passives, gustar-type inversion…). Save the whole clause as spoken." Plus one worked example (the conocer sentence). Keep the 5-entry cap.

Open question: how these render as cards — clause cards practise differently than word cards (recognition fine, production mode needs thought). Don't block extraction on solving the card UX.

### Why it's deferred

Touches the same prompt the lexical extraction depends on — needs a quick regression check against a handful of past turns (the prompt is doing well on those today). Half a day including testing.

---

## Vocab comparator: detect garbage descriptions before splitting into polysemy

**Trigger:** vocab save flow — `compareVocabDescriptions` in `lib/vocab.ts`
**Status:** known bug, low priority; surfaced during the `te haya impresionado` debugging session

### Problem

The comparator decides synonym vs polysemy by comparing the new description against existing rows' descriptions. It assumes both descriptions are well-formed — but the description-generator can occasionally hallucinate a description that's about the SURROUNDING CLAUSE rather than the target word itself.

Concrete case observed: the row for `te haya impresionado` (context: *un partido que te haya impresionado*) had description `"match that has left an impact"` — that's the meaning of the surrounding noun phrase, not the verb segment. When the same word was tapped again later, the new (correct) description `"impressed (past participle, subjunctive)"` was different enough that the comparator declared polysemy and inserted a second row, instead of recognising the first description as garbage and merging.

Result: two rows for the same word/sense, both with wrong descriptions, and the queue rotation surfaces both at different times.

### Fix sketch

Add a sanity check in the comparator (or in the description-generator output validation):

- Either: a separate "is this description plausibly about THIS target word?" LLM call that runs before the polysemy decision and rejects garbage descriptions outright (regenerate or flag for review).
- Or: extend the comparator's existing prompt to explicitly consider "one of these descriptions doesn't actually describe the target word" as an option, and prefer merge-with-overwrite over polysemy-split in that case.
- Or: a deterministic gate — back-translate the description to the target language via a quick LLM call and check substring overlap with the target word. If the description doesn't reference any content word from the target, it's probably garbage.

The first option is cleanest but adds an LLM call to every save. The third is cheapest but brittle. The second is a single-prompt change with no extra cost.

### Why it's deferred

The fixed description-prompt (post `te haya impresionado` debug — Worked Examples now show clitic preservation + a "describe the target word, not the surrounding clause" rule) should reduce garbage descriptions massively. Worth waiting to see if it still happens in practice before adding comparator complexity.

If post-fix testing surfaces another garbage-description case, promote this to active.

---

## Per-user target language spec

**Trigger:** Phase 4-7 (target-language threading)
**Status:** deferred until a settings UI exists or a user other than admin needs a different language
**See also:** `TARGET_LANGUAGE_MIGRATION.md` — full audit + phased plan (A/B done, C/D/E pending). This backlog item maps to Phase D there.

`lib/targetLanguage.ts` currently exports a single `DEFAULT_TARGET` (`Spanish` / `castellano` / `everyday`) used by every prompt. When per-user differentiation is needed:

1. Add columns to `users`: `target_language TEXT NOT NULL DEFAULT 'Spanish'`, `target_location TEXT` (nullable), `target_style TEXT NOT NULL DEFAULT 'everyday'`.
2. Add `getUserTargetLanguageSpec(userId)` to `lib/users.ts` that returns the spec for a given user, falling back to `DEFAULT_TARGET` shape for missing fields.
3. Each prompt that currently calls `describeTargetLanguage(DEFAULT_TARGET)` accepts the spec via the API (read from session) and passes it to the helper.
4. Surface dropdowns in a settings UI for the three fields. Location options are language-dependent (Spanish: Castellano / Neutral / Latino; Hungarian: none).

The prompts already read a spec — only the *source* of the spec needs to change.

---

## Per-language prompt cues (style / location / language)

**Trigger:** prompt-quality work on `localize`, `segment`, `explain`, AI-bubble generation
**Status:** designed, not implemented; depends on "Per-user target language spec"
**Related:** "TTS voice / accent — modular per target language" below — same modular shape, both consume the same per-language config

### Problem

The current prompts reference the target language via `describeTargetLanguage(spec)` — that produces a label like *"everyday Castellano Spanish"* and embeds it in the prompt. The label is abstract; the model has to derive concrete patterns (vosotros vs ustedes, distinción in spelling, register cues, regional idioms) from its training on its own. That works for major languages where the model has strong implicit priors, but is inconsistent on edge cases and fails entirely for less-resourced languages.

Concrete improvements I floated during prompt-tuning sessions but couldn't bake into the universal prompt:
- *"For Castellano, prefer 'coger' over 'agarrar' / 'tomar' for 'to grab'"*
- *"Use 'vosotros' for plural informal you, not 'ustedes'"*
- *"Subject pronouns are dropped by default (pro-drop); only include yo / tú / etc. if emphatic"*
- *"Compound tenses keep haber + participle adjacent without auxiliary insertion"*

These are language-specific. They don't fit in a universal prompt without bloating it for users on different language pairs.

### Solution: a per-spec cues database, injected at prompt-build time

A small data structure keyed by `(target_language, location, style)` that stores structured cues. Prompts that care about target-language nuance look up the cues for the active user's spec and inject them as a "Style cues" block.

Shape:
```ts
interface LanguageCues {
  spec: { language: string; location: string | null; style: string };
  // Concrete vocabulary preferences this variety is known for
  vocabulary_hints: string[];        // e.g. ["use coger over agarrar", "prefer móvil over celular"]
  // Register / pronoun system
  register_hints: string[];          // e.g. ["use vosotros for plural informal you (not ustedes)"]
  // Compound-tense / construction examples specific to this language
  construction_examples: string[];   // e.g. ["he visto", "voy a hacer", "tengo que ir"]
  // Idiom seed list (helps segmenter decide what NOT to split)
  idiom_examples: string[];          // e.g. ["tener ganas", "darse cuenta", "echar de menos"]
  // Pronunciation cues — used only by TTS instructions
  tts_hints: string[];               // e.g. ["distinción: 'c' before e/i and 'z' as /θ/"]
  // 2-3 (native-intent → target-output) pairs to anchor localize style
  localize_examples: { intent: string; output: string }[];
}
```

### Storage

**v1: static JSON files.** `lib/languageCues/es-castellano-everyday.json`, `lib/languageCues/es-latino-everyday.json`, etc. One file per spec. Loaded once at boot, cached in memory.

**v2 (when scaled): SQLite table** `language_cues(language TEXT, location TEXT, style TEXT, cues_json TEXT, generated_at INTEGER, PRIMARY KEY (language, location, style))`. Only worth it once cues are user-editable or auto-regenerated.

### Pre-generation workflow

A one-shot script `scripts/generateLanguageCues.ts` that takes a `(language, location, style)` triple and asks an LLM (gpt-4o, one-shot expensive call):

```
You are configuring a language-learning app for ${language} (${location}, ${style} register).
Produce structured cues that downstream prompts will use to guide style.
Return JSON with these fields: vocabulary_hints (3-6 items), register_hints (2-4),
construction_examples (5-8 typical compound tenses / periphrases), idiom_examples
(8-12 fixed expressions), tts_hints (1-3 phonetic rules with examples), localize_examples
(2-3 native→target sentence pairs in the chosen register).

Be specific to THIS variety — don't write generic "use natural language" filler.
Cite the contrast with sister varieties where helpful (e.g. for Castellano: "vs. Latin
American 'agarrar/tomar'").
```

Run once per (language, location, style) triple. Costs ~$0.01 per generation, 1-time.
Output saved to the JSON file (or DB row).

### Combinatorics

For the realistic v1-launch scope:
- Spanish: Castellano, Neutral, Latino × everyday, street, office = **9 cues**
- Hungarian: no location × 3 styles = **3 cues**
- Polish: no location × 3 styles = **3 cues**

**Total: ~15 cues files.** ~$0.15 one-time generation. Trivial.

When a new language is added (admin task in the future signup-flow), the script auto-runs for all (location × style) combinations of that language. Idempotent.

### Injection at runtime

Each prompt that takes a `nativeLanguage` / target spec also takes the looked-up cues object. Concrete touch-points:

| Prompt | Which cues fields injected |
|---|---|
| `localize` (natural + transcript_aware variants) | vocabulary_hints, register_hints, localize_examples |
| `segment` | idiom_examples (helps the "must not split" rule), construction_examples |
| `explain` | register_hints (so explanations match user's chosen register) |
| `translateWordInContext` (AI bubble tap) | construction_examples + idiom_examples (better grouping decisions) |
| `generateVocabDescription` | (optional — descriptions are in English regardless) |
| TTS instructions | tts_hints |

The injection format is just a section appended to the existing prompt:
```
═════ STYLE CUES (specific to ${target}) ═════
- ${vocabulary_hints joined as bullets}
- ${register_hints joined as bullets}
... etc.
```

### Risks / open questions

- **Cue drift**: cues encode a particular linguistic snapshot. If language usage shifts (slang, register changes), cues need re-generation. Add a `generated_at` timestamp; flag cues older than ~1 year for review.
- **Wrong cues propagate everywhere**: a single bad cue affects all prompts using it. Mitigation: validation step after generation (LLM self-review of its own cues), plus manual spot-check before a new language ships to users.
- **Languages without sufficient training data**: for very low-resource languages the LLM may produce shallow / generic cues. Fallback: smaller cues object, more reliance on universal rules.
- **User-customisable cues?** Probably not for v1. If a user wants a different register than "everyday", they pick it in settings; we don't let them write their own cues.

### Integration with existing prompt work

The V2 prompts now in `/playground/correct-test` (segment + explain) already have structure that would benefit from cues — segment's "must stay unified" list could extend with `idiom_examples` from the cues; explain's worked example could come from `localize_examples` of the user's spec. When this lands, V2 prompts pull cues from the spec instead of having Spanish-specific examples hardcoded.

---

## Signup handler should warm topic sets for the new user

**Trigger:** Phase 4 (topic-sets architecture)
**Status:** deferred until signup UI exists (currently no signup flow — new accounts are inserted manually via `db:studio` or one-off scripts)

When a sign-up flow is built, the signup handler must, immediately after creating the user row, generate that user's `current` and `next` topic sets in-line. This guarantees the new user's first home-page load is zero-latency, with no need to run a per-user warm script manually.

Implementation note: the same `lib/topicSets.ts` helpers used by the warm script and `/api/topics/reroll` should be reused — there should be one place that knows how to "ensure a user has both `current` and `next` populated." The signup handler calls it after `createUser()`.

For now (no signup), `npm run warm` is run manually. After this backlog item is done, `npm run warm` is only useful as a maintenance / repair tool.

---

## Tap-to-translate visual polish

**Trigger:** Phase 8 (tap-to-translate on AI bubbles)
**Status:** UX refinement, deferred

The current tap-state visual on AI-bubble words doesn't feel right. Specifically:

1. **Tap-to-open visual** — the amber background looks rough; needs a more elegant treatment for the active word that draws attention without feeling jarring.
2. **Looked-up marker** — the dotted underline on already-tapped words is too faint to notice. Replace with a real **highlighter marker** treatment: a soft background colour around the word (think yellow/green highlighter pen, but tasteful). Should be unmistakable but not aggressive.
3. **Tooltip styling** — current black tooltip with arrow is fine but worth iterating once the rest of the design language settles.

---

## Multi-word collocation grouping is unreliable

**Trigger:** Phase 8 (segment generation prompt)
**Status:** known bug

The LLM is told to group multi-word idioms and tightly-bound collocations as a single tappable segment. In practice it often fails — splitting *por ejemplo*, *tener ganas*, etc. into individual words that don't translate sensibly on their own. **Compound tenses are a related sub-case**: tapping *haya* in *que te haya impresionado* shows "Habe", which is meaningless in isolation — the segmentation should keep auxiliary + participle as one unit, with the construction translated as a whole. Same for *está hablando*, *voy a hacer*, *tengo que*, etc.

Likely fixes (in order of effort):

1. **Tighten the prompt** with more concrete `${TARGET_LANGUAGE}`-specific examples and stricter language ("MUST keep these together: …"). Cheapest, but the model still drifts. For compound tenses specifically, add an explicit rule: *auxiliary + participle*, *estar + gerund*, *ir a + infinitive*, modal periphrases (*tener que*, *hay que*) MUST be one segment.
2. **Post-process server-side**: after the LLM returns segments, run a small follow-up call asking *"are any adjacent segments here a fixed expression that should be merged? If yes, return the merged version."* Adds a second LLM call, but more reliable.
3. **Maintain a per-language idiom list** (`lib/idioms.es.txt` style) and merge adjacent segments that match it, deterministically. Most reliable, no LLM cost — but list maintenance.

Probably (1) first; if it stays flaky, do (3). The compound-tense subset would actually deterministically detect well — Spanish past participles end in `-ado`/`-ido` (plus a small irregular set: visto, hecho, dicho, puesto, escrito, abierto, vuelto, muerto, roto, cubierto, descubierto, resuelto), so a regex-based merge pass over adjacent (`haber-form`, `participle`) pairs would catch most cases without an LLM.

---

## Conversation context for interpret / localize

**Trigger:** correction quality on dependent / elliptical learner replies
**Status:** designed, not implemented

Today `/api/correct` runs `interpret` → `localize` → `segment` (in `lib/correctionPipeline.ts`) with no conversation history, even though the learner's utterance often refers back to it. Cases where this hurts:

- AI: *¿Has visto la película?* — Learner: *Sí, la he visto.* `localize` doesn't know the antecedent is feminine and could swap to *lo he visto*.
- Learner: *Es uno de los mejores* — should be *una de las mejores* if the topic was a feminine noun. Pipeline has no antecedent.
- Elliptical replies (*ja klar* / *no creo*) interpreted in isolation can come out with the wrong tense / register / person.

The conversation history exists in the DB and `/api/converse/turn` already builds the full message array from it for the AI's reply — so the precedent for "send context" exists. `/api/correct` is the stateless transformation that hasn't caught up.

**Cost.**
- `interpret` (gpt-4o-mini, ~290 prompt tokens today): +~300 tokens for 3 turns of history → ~$0.0001 extra per call. Negligible.
- `localize` (gpt-4o, ~170 prompt tokens today): same +~300 → ~$0.001 extra per call. Small but accumulates over a session.
- `segment` doesn't need context — it compares two strings the pipeline already produced. Skip.

Roughly +$0.001 per user turn, +$0.02 per 20-turn conversation. Dismissable.

**Structure.**
- Server-side, not client-side. `/api/correct` body adds optional `conversationId`. When set, the route fetches `getMessages(conversationId)`, trims to the last N messages, threads them into `interpret()` and `localize()` as a context preamble.
- Window: last 3 user + last 3 AI messages. Most antecedents resolve within 1-2 turns; 3 covers the edge cases. The conversation topic itself is also already known and provides the broader frame.
- Format: a small `RECENT CONVERSATION:` block before the actual interpret/localize task, instructing the model to use it for pronoun antecedents, gender / number agreement, register continuity.

**Risk: false-correction loops.** If the learner's gender disagrees with context and the LLM "corrects" them but the learner had a different antecedent in mind, we're inventing a mistake. Default mitigation: trust the model and watch the false-correction rate in real conversations. Fallback if the rate turns out high: have `interpret` flag conflicts as soft notes in `notes_native` so `localize` decides whether to honour or override.

**Implementation scope** (~1-2h):
- `app/api/correct/route.ts`: accept `conversationId`, fetch + trim history.
- `lib/correctionPipeline.ts`: `interpret()` and `localize()` accept `recentMessages?: Message[]`, render them into the system prompt.
- `components/ConversationView.tsx`: pass `conversationId` in the `/api/correct` body.
- `segment` unchanged.
- No DB schema changes.

---

## TTS voice / accent — modular per target language

**Trigger:** TTS sounds neutral, not Castellano (says *Barselona*, should say *Barthelona*)
**Status:** quick-fix landed (hardcoded Iberian instructions); modularisation deferred

The TTS route (`app/api/tts/route.ts`) calls `gpt-4o-mini-tts` with a fixed voice and a generic instruction. The voice itself is language-agnostic; accent shaping comes from the `instructions` parameter. Pre-fix, nothing biased the model toward Castellano, so it defaulted to a neutral or seseo-leaning pronunciation — wrong for a learner studying Castellano specifically (where *c* before e/i and *z* should be /θ/).

**Quick fix (landed):** explicit Iberian-Spanish instruction with concrete examples (*Barcelona* → "Barthelona", *cinco* → "thinco", *zapato* → "thapato"), Castilian intonation, crisp consonants. Hardcoded to Spanish/Castellano because `DEFAULT_TARGET` is the only target right now.

**Modular plan (later, when the per-user target-language spec lands — see "Per-user target language spec" above):**
- The `TargetLanguageSpec` gains a `tts` block (or a derived `describeTTS(spec)` helper analogous to `describeTargetLanguage()`) carrying `voice` + `instructions`.
- TTS instructions become a function of the spec: Castellano → distinción rules; Latino → seseo + region cues; Hungarian → Hungarian-specific phonetic guidance; etc.
- Voice selection per language is part of the spec — some voices may clash with certain phonetics, so the spec picks from a per-language voice palette.
- Single entry point: `getTTSConfigForUser(userId)` returns `{ voice, instructions }` ready to pass into `audio.speech.create`.

Sits alongside the broader "Per-user target language spec" backlog item — same lever, additional surface (prompt phrasing today, TTS next, eventually transcription prompt).

---

## Latenz: Audio-Chunk-Upload während der Aufnahme + optimistisches Vorarbeiten

**Trigger:** Latenz-Spec 2026-08-08, Änderungen 5 + 6 — bewusst zurückgestellt beim Umbau auf Vorab-Annotation + Streaming (siehe `LATENCY_NOTES.md`).

- **Chunk-Upload (Änderung 5):** MediaRecorder liefert Chunks schon während der Aufnahme; heute wird erst nach Stopp als Ganzes hochgeladen. Offene Designfrage vor dem Bau: serverless-taugliche Session-Haltung (Chunks + Finalize teilen sich auf Vercel keinen Prozess) — Kandidaten: Blob-Store pro Upload-Session, kleiner WebSocket-Service, oder Single-Request-Streaming mit `duplex: "half"` (iOS-WebView-Support prüfen). Erwartet: 0,5–1 s pro Sprach-Input.
- **Optimistisch (Änderung 6):** VAD-Pause (~600–800 ms Stille) → Transkription vorab anstoßen, bei Weitersprechen verwerfen und final IMMER auf dem Gesamt-Audio rechnen. Nach Änderung 5 umsetzen.
- **Annotations-Modell-Eval (Rest von Änderung 4):** 30–50 repräsentative Sätze (inkl. Wortpaare, die mal Einheit sind und mal nicht) gegen Flash-Lite / Haiku / Groq-Klasse; Infrastruktur liegt im model-bench-Playground.
