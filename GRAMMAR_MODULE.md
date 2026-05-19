# Grammar Module — Personalised Rule-Based Learning

A dedicated grammar surface alongside the free-form chat. The system silently catalogues the learner's recurring grammatical mistakes against a fixed taxonomy of language-specific topics, and surfaces individual topics as personalised mini-lessons once the user has repeated the error enough times to justify focused study.

## What it solves

The chat is great for fluency practice but bad for rule-mastery — when the same user mistake recurs across 20 conversations (e.g. always picks `ser` when they need `estar`), there's no mechanism for surfacing it. The user just keeps making the mistake, the corrector keeps correcting it in isolation, and no transfer happens.

This module bridges that gap: errors are classified, counted, and the user is prompted to study the underlying rule once it crosses a frequency threshold.

## Architecture

### Fixed taxonomy — the key design choice

A pre-defined list of ~30-50 core grammar topics per language, each with a stable ID. Examples for Spanish:

```
ser-vs-estar
preterite-vs-imperfect
subjunctive-present-after-que
subjunctive-after-quizá-acaso
por-vs-para
direct-vs-indirect-object-pronoun
gender-agreement-adjective
verb-conjugation-present-3rd-person
…
```

This **must be a fixed list**, not LLM-generated on the fly. If the classifier invents a new category every time, you end up with semantic-duplicates ("subjunctive after que" vs "que + subjunctive" vs "konjunktiv I nach que") that fragment the user's history. With fixed IDs, every occurrence of the same mistake maps to the same row, and the frequency count is meaningful.

CEFR-anchored: A1 has ~5-10 topics, A2 adds another ~8, B1 expands the count, etc. Topics are tagged with the level they typically become relevant for the learner.

### LLM-as-classifier

After each `/api/correct` returns mismatch pairs, a cheap LLM call (gpt-4o-mini) classifies the mistake(s) into one of the fixed topic IDs:

```
Input:
  target_language: French
  local_segment:   "j'ai mangé"
  user_segment:    "je mangé"
  context:         "Hier j'ai mangé une pizza"

Output:
  topic_id: "passe-compose-auxiliary-missing"
  confidence: 0.94
```

The classifier knows the full topic list at prompt time. Multi-error utterances produce multiple classifications. Low-confidence classifications are dropped (not stored) to keep the data clean.

### Storage

New tables:

```sql
-- The taxonomy itself, seeded per language
grammar_topics (
  id          TEXT PRIMARY KEY,    -- e.g. "ser-vs-estar"
  language    TEXT NOT NULL,
  cefr_level  TEXT NOT NULL,       -- A1, A2, B1, B2, C1
  title       TEXT NOT NULL,       -- localised display
  explanation TEXT NOT NULL,       -- short, learner-facing
  examples    TEXT NOT NULL        -- JSON array of {wrong, right, note}
);

-- Per-error log
user_grammar_errors (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  topic_id        TEXT REFERENCES grammar_topics(id),
  conversation_id INTEGER REFERENCES conversations(id),
  user_segment    TEXT NOT NULL,
  correct_segment TEXT NOT NULL,
  context         TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (...)
);

CREATE INDEX idx_user_grammar_errors_user_topic ON user_grammar_errors(user_id, topic_id);
```

### Frequency-gated surfacing

A topic appears on the user's Grammar Page (or as a notification banner) when one of:

- **≥3 errors of that type in the last 50 corrections** (active rule)
- **≥7 errors over all time** (chronic rule)
- **The user's level just crossed into a range where the topic is typically relevant** (e.g. they hit Level 30 and they have ≥1 subjunctive-trigger errors)

Topics that have not triggered in 30 days drop out of the active list — they don't pollute the UI.

## Grammar Page — the UI

Modular, data-driven, three vertical sections per topic:

### Section 1 — Personal context

The user's own sentences where they made this exact mistake. Real, recent, in their own voice. Maybe 3-5 examples with their wrong version on the left, the correct version on the right, the conversation it came from linked.

This is the **hook**. Not abstract — their own production.

### Section 2 — Micro-learning

Short rule explanation in their native language. 2-3 paragraphs max, plus 3-5 paradigmatic example pairs. Not a textbook chapter — closer to a Quora top-answer.

Rendered from the `grammar_topics.explanation` field (pre-written by humans / generated once and hand-reviewed for the seed taxonomy).

### Section 3 — Sandbox practice

Two complementary modes:

- **Quick gap-fill challenges** — auto-generated from the topic. Classic Lückentext. ~5-10 prompts per session. Gamified score, streak. Fast (~30s per question).
- **Isolated mini-chat** — a constrained AI chat where the bot only engages on situations that exercise this rule. E.g. for `ser-vs-estar`, the bot only asks descriptive questions ("How is your day?", "Where is your house?"). The AI's prompt is tightly scoped — drift is penalised.

The mini-chat is a **protected practice arena**: free conversation is too noisy for rule-mastery; pure drills are too dry. The mini-chat is the bridge.

## Single-error highlight — independent of the grammar page

A related but separately-shippable feature: after each chat turn, instead of letting all mismatch pairs sit equally in the segment view, **promote one** to a prominent "💡 Tipp" callout.

Selection logic:

- Among the current turn's errors, pick the one whose topic ID has the **highest weight** for this user, where weight = `(frequency_in_last_50 × 0.6) + (severity_at_level × 0.4)`
- If no error in this turn matches a high-weight topic, surface the most-fundamental general error (heuristic: word-order > word-choice > inflection > accents)
- Cooldown: same topic isn't promoted twice in 5 consecutive turns even if it recurs — avoids nag

This **doesn't require the full grammar page** to be useful. It works on top of the classifier alone. Could be shipped in ~2-4 hours after the classifier exists.

## Phased rollout

Phase 1 — **Classifier + datastore** (~3-4h)
- Seed the `grammar_topics` table with 30 Spanish + 30 French topics
- Hook the classifier into `/api/correct` after-effect (fire-and-forget)
- Write rows to `user_grammar_errors`
- No UI yet — pure data collection

Phase 1.5 — **Single-error highlight in chat** (~2-3h)
- Use the classifier's output to promote one error per turn in the CorrectionBlock UI
- A/B-able by toggling per user

Phase 2 — **Personal context + micro-learning** (~3-4h)
- New `/grammar` page in the app
- List the user's active topics, click a topic → show personal context + explanation
- No sandbox yet

Phase 3 — **Gap-fill sandbox** (~4-6h)
- Per-topic gap-fill generator (LLM-prompted, fixed format)
- Score + streak UI

Phase 4 — **Isolated mini-chat** (~4-6h)
- Per-topic scoped chat handler — system prompt locks the conversation to scenarios that exercise the rule
- Drift detection: if 3 consecutive turns don't surface the rule, gentle redirect

**Total: ~16-22h for a full feature.** Phase 1 alone is the high-ROI insurance — even without the UI, you have the data that informs everything else.

## Open questions

- **Flat vs hierarchical taxonomy**: 30 topics might be enough for A1-B1; at C1+ you start wanting "subjuntivo perfecto vs subjuntivo imperfecto in if-clauses" granularity. Decision deferred — start flat, add hierarchy only if classification reliability suffers.
- **Classifier reliability**: can gpt-4o-mini stably map similar errors to the same topic ID across thousands of cases? Eval script: take 100 known errors, run them through 5 times each, measure stability. If <90%, upgrade to gpt-4o or refine the prompt.
- **Theory-vs-practice weighting**: how much time does the user spend reading rules vs doing gap-fills vs mini-chatting? Different users prefer different mixes. Probably user-configurable, with a default of 30/40/30.
- **Notification cadence**: when a new topic crosses the threshold, do we badge the Grammar nav, push a notification, or surface it on the homepage? The most learn-effective channel is the one that gets opened — needs experimentation.
- **Topic taxonomies in collaboration with native speakers / linguists** for the seed list — for Spanish, GoCalixto / Hablar y Aprender Spanish have published similar maps. We can adopt + adapt rather than invent.

## Why this is the most important pedagogical feature

The whole rest of the app produces fluency. This is the only mechanism that produces **explicit knowledge transfer** — the user goes from "I keep saying X wrong" (implicit) to "I now know the rule for X" (explicit). For adult learners, this transfer is what turns plateau into progress.

Without this, users hit the natural ceiling of immersion-only learning: they get conversational but stay grammatically frozen on whatever errors they internalised early. With this, the system identifies the freeze and unfreezes it.
