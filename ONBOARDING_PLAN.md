# Onboarding Plan — Level Assessment via Disguised First Conversation

**Status:** Plan, not yet built. Supersedes `FEATURE_IDEAS.md §6` ("Onboarding placement test + tiered seed-vocab import"), which used a card-drill approach. See "What this supersedes" at the bottom.

**Goal:** When a brand-new user signs up, place them on the 0-100 level scale within ~2-3 minutes, while the user experiences the flow as a friendly intro to the app, not a test. The output is a single integer written to `users.level`; no automatic seed-vocab import in v1.

## 1. Why this shape (vs. the old card-drill plan)

The old plan: 5-10 vocab cards from fixed frequency bands; user translates; binary judge grades; bucket into level. Deferred because building the seed-vocab tables, frequency-list curation, and a separate test-feeling UI is heavy — and the result is one signal (verdict per card) on a narrow surface (reception of single words).

This plan: the user enters the actual conversation-mode flow as their first interaction. Every part of the journey doubles as a UX tutorial: a "Tafel" (small info overlay) explains each affordance the first time it appears (tap-for-translation, mic-to-reply, interpretation panel, local version, segment glosses). Level is estimated from **four signal axes** observed in this real interaction, not from an isolated test.

Why this is better:
- **No artificial test feel** → onboarding doesn't drop retention.
- **Tutorial + assessment in one** → no separate onboarding wizard needed.
- **Behavioral data > stated data** → Dunning-Kruger bias cancels when self-report and production disagree.
- **Zero new content infrastructure** → reuses chat opener, judge, vocab pipeline as-is.

## 2. Scope (v1)

- **Triggered for new signups only.** Existing users (`users.level` already set, `last_level_check_at` populated) are not re-onboarded. Re-calibration UI is out-of-scope for v1 — file as Phase-2.
- **Output is the level integer**, written to `users.level` (and `last_level_check_at` set to onboarding completion time).
- **No automatic vocab import.** User lands in the normal organic flow afterward. Auto-import is a separate decision (FEATURE_IDEAS §6 had it tied to placement; we decouple).
- **No skip path.** Every new user goes through the chat — even confident ones — because the chat is the app and the discovery has tutorial value regardless of starting level.
- **No level shown to the user.** The estimate is internal; we trust the estimator and surface only the app behaviour calibrated at that level.
- **Spanish only** for v1, matching the rest of the app. Per-language openers are needed when target-language migration lands.

## 3. Flow overview

The user signs up → lands in onboarding directly (no marketing fluff between, no skip path — even confident users go through the chat because the chat *is* the app and they may as well discover it now).

```
┌─────────────────────────────────────────────┐
│ Phase 1 — Reception calibration (~60 sec)  │
│                                             │
│  AI opener at L5 ("Hola, ¿qué tal?")        │
│  → user clicks one of three options:        │
│    "verstehe alles" / "weitgehend" / "nichts"
│  → next opener at adjusted difficulty       │
│  → repeat up to 4 openers OR until          │
│    convergence ("weitgehend" reached)       │
│                                             │
│ Phase 2 — Production phase (~90 sec)        │
│                                             │
│  Same chat thread continues.                │
│  Tafel explains: "tippe Wörter zum          │
│    Übersetzen, dann klick fertig"           │
│  User taps unknown words → translations show│
│  Tafel: "tippe Mikro, antworte auf Spanisch │
│    so gut du kannst — was du nicht weißt,   │
│    sag auf Deutsch"                         │
│  User speaks → interpretation panel shows   │
│  Tafel: explains interpretation + segments  │
│  AI replies in same calibrated register     │
│  → repeat for 3 user inputs total           │
│                                             │
│ Phase 3 — Silent completion                 │
│                                             │
│  After the AI's reply to the 3rd input:     │
│  /api/onboarding/complete runs the          │
│  estimator, writes users.level silently,    │
│  shows a single "Weiter →" button that      │
│  routes to the dashboard. No level number   │
│  surfaced to the user (a 0-100 estimate is  │
│  not meaningful to them in isolation).      │
└─────────────────────────────────────────────┘
```

No skip option. No level-confirmation step. Both decisions are deliberate:
- **No skip:** brand-new users want to see how the app works — even a confident C1 user benefits from discovering the Tafel-explained UI affordances before they hit the real app. The 2-3 minute "test" is also the tutorial.
- **No debrief / override:** the 0-100 scale is internally meaningful but not interpretable for a user without context. Asking "is 47 right?" puts cognitive load on a number they have no calibration for. The estimator is trusted; if it's systematically off, that's a calibration bug to fix in the estimator, not a UX feature.

## 4. Phase 1 — Reception calibration (the difficulty ramp)

The AI sends openers at predetermined difficulty levels. Each opener is one short utterance. After each, the user picks one of three buttons.

**Difficulty ladder** (rubric — must be a static set, not LLM-improvised, so behaviour is deterministic):

| Level | Example opener (ES) | Vocab/grammar profile |
|------:|---------------------|------------------------|
| L5  | `"Hola, ¿qué tal?"` | Greeting, present, top-50 words. |
| L20 | `"¿Vives aquí en Madrid? ¿Te gusta la ciudad?"` | Simple present, basic questions, top-200. |
| L40 | `"¿Has tenido tiempo de conocer un poco el barrio este fin de semana?"` | Present perfect, partitive, time clauses. |
| L60 | `"Por lo que cuentas, parece que ya te has acostumbrado bastante al ritmo de aquí."` | Inference clause, reflexive past, register shift. |
| L80 | `"Si tuvieras que recomendarle un rincón poco conocido a alguien que viene por primera vez, ¿cuál sería y por qué?"` | Subjunctive, conditional, idiomatic register. |

**Transition rules** (deterministic, no LLM judgment in this phase):
- Start at L5.
- `"verstehe alles"` → jump up: L5 → L20 → L40 → L60 → L80.
- `"verstehe weitgehend"` → STOP, save this as the user's **convergence level**, advance to Phase 2.
- `"verstehe gar nichts"` at L5 → save convergence = L0, advance to Phase 2 with the L0-Tafel variant (see §6).
- `"verstehe gar nichts"` above L5 → drop back one level, re-prompt with a new opener at that level (LLM-generated, same difficulty bracket).
- Hard cap: max 4 openers in Phase 1. If user keeps clicking "alles" through L80 without saturating, stop and convergence = L80.

Each opener has its content varied between two LLM-generated alternatives per level so a returning user (or curious user clicking refresh) doesn't see the same line twice. The difficulty profile of each variant is fixed.

## 5. Phase 2 — Production phase

The chat thread continues from where Phase 1 left off. The AI continues to send replies at or near the convergence level (no further ramping unless user input signal demands it). Target: **3 user inputs total**.

This phase uses the full existing conversation-mode pipeline — Whisper transcription, LLM interpretation, correction, AI reply — exactly as a real session, with no special branches. Why: we want the user's natural production behaviour, not their performance-under-test behaviour. The Tafel just makes the affordances discoverable.

**Behavioural escalation — the correctness × tap signal.** After each user input the AI evaluates two binary questions:

1. Did the user make any errors in their Spanish? (grammar, word choice, gender, conjugation — anything that a native speaker would mark as wrong)
2. Did the user tap zero words in the AI's preceding message?

If **both** are true — error-free Spanish AND no taps — the AI's next reply is bumped one difficulty level higher. The escalation continues turn by turn until either condition flips: the user makes an error, OR the user starts tapping. At that point the AI holds register.

Critical: **complexity and verbosity are NOT signals.** A C2 speaker can produce a perfect three-word answer to a B2 question — that doesn't mean they're at B2. What we measure is *did they handle this register correctly*. Short clean Spanish counts identically to long clean Spanish. The estimator's only production signals are the error count and the tap count.

The pedagogical purpose of the escalation is twofold:
- **Refine the estimate** — keep raising the bar until we find the boundary.
- **Force tap-discovery** — we want every user to have tapped at least one word before they finish onboarding, so the affordance is internalised. A user who breezes through L80 without ever needing to tap can still finish onboarding (we cap at 3 inputs), but most users will hit a level where tapping becomes natural.

**Tafel script** (sparse — max 4 interjections total across both phases):

| Trigger | Tafel content |
|---------|--------------|
| First AI message in Phase 1 | "Ich schicke dir kurze Sätze auf Spanisch. Sag mir per Klick, wie viel du verstehst." |
| Phase 1 → Phase 2 transition | "Jetzt unterhalten wir uns kurz. Tippe in der nächsten Nachricht auf jedes Wort, das du nicht kennst — du siehst dann die Übersetzung. Klick auf **Fertig**, wenn du soweit bist." |
| First "Fertig" pressed | "Tippe auf das Mikrofon und antworte auf Spanisch — so gut wie du kannst. Was du nicht weißt, sag einfach auf Deutsch. Es gibt kein 'falsch' hier." |
| First user reply judged | "Oben siehst du, wie die App deinen Satz verstanden hat. Darunter erscheint eine natürliche spanische Version mit Erklärungen — antippen für Details." |

After these four, the Tafel disappears. Two further messages happen without commentary so the user feels they're already in the real app (because they are).

**Cap at 3 user inputs.** After the third reply, Phase 3 (debrief) triggers. Don't keep escalating — the marginal signal per additional input drops fast, and stretching the onboarding kills the "this is fast and friendly" perception.

## 6. L0 branch (absolute beginner)

If the user clicked "verstehe gar nichts" at L5 in Phase 1, the Tafel script for Phase 2 is *adapted* — same flow, gentler framing. The goal is to remove the pressure of "produce Spanish" so a true beginner doesn't bounce:

| Trigger | Tafel content (L0 variant) |
|---------|---------------------------|
| Phase 1 → Phase 2 transition | "Kein Problem — die App ist genau dafür da. Tippe auf jedes Wort in der nächsten Nachricht, du siehst die Übersetzung. Klick auf **Fertig**, wenn du durch bist." |
| First "Fertig" pressed | "Antworte einfach so, wie es dir grad einfällt — auf Deutsch ist völlig okay. Wenn du Lust hast, probier ein Wort auf Spanisch. Es gibt kein 'falsch'." |
| First user reply judged | "So funktioniert das immer: oben sehen wir, was du gesagt hast, darunter wie man es auf Spanisch sagen würde. Tippe auf Wörter für Erklärungen." |

The phase still runs the full pipeline. The user's raw input may be 100% German — that's data too (confirms L0). The system handles a German-only input gracefully (interpretation will say something like "Der Nutzer hat auf Deutsch gesprochen — Niveau Anfänger").

## 7. Signals collected

After Phase 2 completes, the following are aggregated and passed to the level estimator. Deliberately narrow: complexity and volume are not tracked because they don't measure ability (see §5).

```ts
interface OnboardingSignals {
  // From Phase 1
  convergenceLevel: number;              // 0, 5, 20, 40, 60, or 80
  receptionClicks: ("alles" | "weitgehend" | "nichts")[];

  // From Phase 2 (3 user turns)
  taps: {
    aiMessageWordCount: number;          // total words across AI messages in phase 2
    tappedWords: string[];               // unique words user tapped
  };
  userInputs: {
    rawText: string;                     // user's transcribed Spanish (the raw input, not the interpretation)
    aiReplyLevel: number;                // the difficulty level the AI was speaking at when this user turn happened
    errorCount: number;                  // grammar / word-choice / form errors a native would flag (per-turn)
    nativeFallbackCount: number;         // count of native-language words used (signal for "I don't know it in ES")
  }[];

  // Final difficulty the AI reached
  highestSustainedLevel: number;         // the highest AI-reply level at which the user produced an error-free response
}
```

`errorCount` is determined by a per-turn LLM check, **not** by `judgeVocabAnswer`/`judgeVocabSentence` (those are for SRS verdicts on specific target words; this is a global "is this Spanish correct" pass).

`nativeFallbackCount` is informational only — a user who answers "the perro is grande" mixes native fallback in but their Spanish is still error-free. It doesn't trigger or suppress escalation; it just gives the calibration LLM a hint when the input was sparse on Spanish content.

## 8. Level estimation method

Hybrid: heuristic signal-collection (deterministic) + LLM judge (final estimate with CEFR rubric).

**Step 1 — heuristic features** (deterministic computation from signals):
- `receptionConvergenceScore`: from `convergenceLevel`, 0-80.
- `comprehensionGapScore`: `1 - (tappedWords.length / aiMessageWordCount)`, scaled 0-100.
- `productionCorrectnessScore`: per-turn `errorCount` aggregated. Zero errors at higher AI-reply levels weight up; errors weight down.
- `highestSustainedLevel`: the highest AI-reply level at which the user replied error-free.

Note what's NOT in here: sentence length, vocabulary richness, grammar-marker counts, "fluency" verdicts. These are explicit non-signals (see §5).

**Step 2 — LLM calibration call** (`chat_precise`, one call):

```
SYSTEM: You estimate Spanish proficiency on a 0-100 scale.
  0  = absolute beginner, no productive ability
  20 = A1, can recognise greetings and basic phrases
  40 = A2/B1, can hold a simple conversation with effort
  60 = B1/B2, conversational fluency, occasional grammar errors
  80 = C1, fluent and idiomatic, can discuss abstract topics
  100 = near-native

CRITICAL — what counts and what does not:
  - Production correctness × AI-reply-level is the main signal. A user
    who answered cleanly at L60 is at L60 minimum, regardless of how
    short or simple their answer was.
  - Tap rate matters as a comprehension gap proxy: low taps at high
    AI-reply levels supports a high estimate; many taps at low levels
    supports a low estimate.
  - Production VERBOSITY and COMPLEXITY are NOT signals. A native
    speaker can answer a B2 question with three perfect words. Do
    not penalise a clean, short answer.
  - Reception self-reports (alles/weitgehend/nichts) are weak prior.
    If production correctness disagrees with self-report, trust
    production.
  - Native-language fallback in answers is neutral — it tells you the
    user didn't know a Spanish word, not that they got something wrong.

You are given (a) the difficulty level at which the user converged in
reception, (b) which words they tapped from the AI's messages, (c)
their raw productions and the per-turn error counts, (d) the highest
AI-reply level at which they produced error-free Spanish.

USER: {structured JSON of all signals + feature scores}

Return JSON only:
{
  "level": <integer 0-100>,
  "confidence": "low" | "medium" | "high",
  "reasoning": "<one sentence, German — stored only, not shown to user>"
}
```

The reasoning sentence is stored for later calibration analysis but is **not** shown to the user (no debrief screen — see §3).

## 9. Phase 3 — Silent completion

After the AI's reply to the user's third input, the onboarding ends. There is no debrief card and no level override flow.

Flow:
1. AI's third reply lands in the chat.
2. A single "Weiter →" button appears below the conversation.
3. On click: `/api/onboarding/complete` runs the estimator, writes `users.level` and `last_level_check_at`, returns 200.
4. Frontend routes to the dashboard.

The user sees: a normal chat that wrapped up, then they continue into the real app. No "we calibrated you to 47" moment. The estimate exists only inside the system and inside the `onboarding_runs` table.

Why no debrief: a 0-100 level number has no calibration value for the user without context. A CEFR-style label ("A2-B1, Anfänger mit ersten Grundlagen") would be more interpretable, but exposing it invites either flattering self-image bias or discouragement — neither helps placement, both add UX cost. Trust the estimator. If the estimator is systematically off, fix the estimator (the `onboarding_runs` data supports that analysis).

## 10. Storage

The full onboarding session is preserved for later re-evaluation:

```sql
CREATE TABLE onboarding_runs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  signals_json  TEXT,                -- the full OnboardingSignals object
  llm_estimate  INTEGER NOT NULL,    -- what the calibration LLM said == final_level (no override path)
  llm_reasoning TEXT,
  llm_confidence TEXT
);
```

(No `user_override` / `final_level` distinction — without a debrief screen there is no second value. `users.level` is set to `llm_estimate` directly.)

Useful for:
- Later analysis: are LLM estimates systematically off in one direction? Compare per-cohort against subsequent SRS-stage progression or user-reported satisfaction.
- If a user feels miscalibrated 2 weeks later: we have the raw signal data to revisit and rerun the estimator with a tweaked prompt.
- Eventual recalibration feature: same table, repeat run with a new `started_at`.

## 11. Cost per signup

- Phase 1: max 4 AI openers, but 1-2 typical. `chat_precise` for natural-sounding openers → ~$0.001 each.
- Phase 2: 3 user turns through full pipeline (Whisper + interpret + correct + AI reply each). Roughly $0.015 per turn → ~$0.045.
- Final calibration LLM: 1 call → ~$0.001.
- TTS: optional in v1 (only if we want to play the AI openers; the visual text is enough for placement purposes — defer).

**Total per signup: ~$0.05.** Trivial.

## 12. Files to touch (sketch)

- `app/onboarding/page.tsx` (new) — the onboarding flow as its own route. Reuses ConversationView component.
- `app/api/onboarding/opener/route.ts` (new) — returns the next opener given current state.
- `app/api/onboarding/complete/route.ts` (new) — runs the calibration LLM, writes `users.level`, returns the estimate for debrief.
- `lib/onboardingDifficulty.ts` (new) — static difficulty ladder + opener variants + transition rules (pure functions).
- `lib/onboardingEstimate.ts` (new) — heuristic feature computation + LLM calibration call.
- `lib/schema.ts` — add `onboarding_runs` table.
- `lib/migrations/` — new migration adding the table.
- `app/(auth)/signup/route.ts` (when sign-up UI is built — see LAUNCH_PLAN) — redirect new users to `/onboarding` instead of dashboard.

## 13. Open questions / explicit non-goals

- **Re-calibration as a feature.** User-triggered "my level feels wrong" route. Out-of-scope v1. The data needed for it (`onboarding_runs` table) is being built so it's easy later.
- **Auto seed-vocab import.** Decoupled from placement. Separate decision tracked under `FEATURE_IDEAS §6` — that doc should now be updated to say "placement is now covered by ONBOARDING_PLAN.md, this remaining section only covers the import question."
- **L0 lesson mode.** A true-beginner who genuinely cannot engage even with the Tafel-eased Phase 2 would benefit from a structured first lesson rather than the conversation flow. Phase-2 idea, not v1.
- **Per-target-language difficulty ladders.** When the app supports Italian / French / etc., each needs its own opener ladder. Not a v1 concern (target language is Spanish-only at signup time).
- **Tracking onboarding abandonment.** If users drop out mid-Phase-1, that's data. Add an `abandoned_at_phase` column once we have telemetry.

## 14. What this supersedes

`FEATURE_IDEAS.md §6` ("Onboarding placement test + tiered seed-vocab import") proposed a card-drill placement test. That approach:
- requires a curated `seed_vocab` table per language (frequency-list curation work);
- presents a school-test surface which hurts first-impression retention;
- collects one signal (binary card verdicts) on one axis (reception of isolated words).

This plan replaces the placement-test part of §6. The seed-vocab IMPORT question (what, if anything, to seed into a new user's `user_vocab` based on their level) is preserved as a separate, decoupled question — to be answered when (and if) we want a seed-vocab feature, independent of how level is determined.

`FEATURE_IDEAS §6` should be marked: *"Placement-test portion superseded by `ONBOARDING_PLAN.md`. Remaining open question: should we auto-import a slice of seed-vocab into new users' decks at all, regardless of how their level was determined?"*
