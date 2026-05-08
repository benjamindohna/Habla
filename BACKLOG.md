# Backlog

Things to do later — out of scope for the current phase but tracked so they don't get lost. Items here should reference the phase or feature that triggered them.

---

## Per-user target language spec

**Trigger:** Phase 4-7 (target-language threading)
**Status:** deferred until a settings UI exists or a user other than admin needs a different language

`lib/targetLanguage.ts` currently exports a single `DEFAULT_TARGET` (`Spanish` / `castellano` / `everyday`) used by every prompt. When per-user differentiation is needed:

1. Add columns to `users`: `target_language TEXT NOT NULL DEFAULT 'Spanish'`, `target_location TEXT` (nullable), `target_style TEXT NOT NULL DEFAULT 'everyday'`.
2. Add `getUserTargetLanguageSpec(userId)` to `lib/users.ts` that returns the spec for a given user, falling back to `DEFAULT_TARGET` shape for missing fields.
3. Each prompt that currently calls `describeTargetLanguage(DEFAULT_TARGET)` accepts the spec via the API (read from session) and passes it to the helper.
4. Surface dropdowns in a settings UI for the three fields. Location options are language-dependent (Spanish: Castellano / Neutral / Latino; Hungarian: none).

The prompts already read a spec — only the *source* of the spec needs to change.

---

## Signup handler should warm topic sets for the new user

**Trigger:** Phase 4 (topic-sets architecture)
**Status:** deferred until signup UI exists (currently no signup flow — users are seeded via `scripts/seed.ts`)

When a sign-up flow is built, the signup handler must, immediately after creating the user row, generate that user's `current` and `next` topic sets in-line. This guarantees the new user's first home-page load is zero-latency, with no need to run a per-user warm script manually.

Implementation note: the same `lib/topicSets.ts` helpers used by the warm script and `/api/topics/reroll` should be reused — there should be one place that knows how to "ensure a user has both `current` and `next` populated." The signup handler calls it after `createUser()`.

For now (no signup), `npm run warm` is run manually. After this backlog item is done, `npm run warm` is only useful as a maintenance / repair tool.

---

## Collapse user-turn correction view on Done; show as sealed bubble

**Trigger:** Phase 6 / 7 (chat shell + turn loop)
**Status:** UX refinement, deferred

When the user clicks **Done** on their correction box, the whole correction UI (interpretation line + segment chips + tap-to-explain panel + Done button) should **collapse / disappear**. In its place, the user's turn should render as a **clean, sealed speech bubble** — Spanish-only, just `local_version_es`, mirroring the visual style of the AI bubble but right-aligned. The conversation should look like a real chat once a turn is "finished".

- No animation needed initially; just swap the rich correction view for the closed bubble on Done.
- The full correction is still in the DB (`messages.segments_json`) — could be re-expandable later via a small "review correction" affordance on the bubble. Out of scope for this initial pass.
- The latest unfinished user turn keeps its full correction view. Earlier user turns are all sealed bubbles.

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
