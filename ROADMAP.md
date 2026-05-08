# Roadmap

Features planned **after** the conversation-mode work (`CONVERSATION_MODE_PLAN.md`) lands. Tracked here so they're not lost; explicitly out of scope for the current branch.

This file is for the *next chapter* of the product. For smaller deferrals that fall out mid-implementation of the current chapter, see `BACKLOG.md`.

---

## 1. Dashboard with multiple modes

When the user opens the app (post-login), they land on a **dashboard** instead of going straight into conversation. The dashboard surfaces the available modes as primary navigation.

- **Conversation practice** — currently the only mode. Opens what is today `app/page.tsx`'s home (greeting + topic grid).
- **Vocabulary repetition / vocabulary test** — flashcard-style review of the user's `user_unknown_words` list. Schema already supports this — just no UI yet.
  - **Storage form rule:** words must be stored in the **exact form the user encountered**, not normalised to the infinitive or lemma. If the user looks up `comió` (third-person singular preterite of *comer*), store `comió` — not `comer`. Same for past participles (`hecho`, not `hacer`), gerunds (`viviendo`), conjugated forms, plurals, gendered adjectives, etc. Rationale: the form *is* the lesson — the learner needs to recognise and produce it as-seen, and lemma collapsing erases the exact stumbling block they hit. Frequency rank lookup can still happen against the lemma internally for sorting, but the stored row preserves the surface form.
  - Implication for Phase 8 (when populating the table): no lemmatization on insert. Trim, lowercase, store.

  ### Spaced Repetition design

  Standard SRS — uses the science from SM-2 (Anki) and FSRS, simplified to a discrete-stage system. New schema columns on `user_unknown_words` (or a parallel `user_word_progress` table) when the UI lands:

  - `stage INTEGER NOT NULL DEFAULT 0` — 0 (new) → 6 (mastered)
  - `next_due_at INTEGER` — Unix timestamp when this word is next due. NULL until first review.
  - `correct_streak INTEGER NOT NULL DEFAULT 0` — count of consecutive correct answers (informational; the stage is the source of truth)
  - `lapses INTEGER NOT NULL DEFAULT 0` — total times the user got it wrong after the first correct answer (telemetry; useful for "leech" detection later)

  **Stage intervals** (when the word becomes due again after a correct answer):
  | Stage | Next due |
  |---|---|
  | 0 (new) | same day, after a short delay |
  | 1 | +1 day |
  | 2 | +3 days |
  | 3 | +7 days |
  | 4 | +14 days |
  | 5 | +30 days |
  | 6 (mastered) | +60 days (control sweep) |

  Roughly doubling per stage — the well-established SM-2 spacing. Rounded to clean numbers for UX clarity.

  **Lapse handling (wrong answer):**
  - Stage 0–2: reset to stage 0
  - Stage 3–6: drop two stages (e.g. stage 5 → stage 3)

  Reasoning: dropping all the way to 0 after a single slip is demotivating and inefficient. Two-stage drop is the standard compromise — it preserves most of the prior learning while ensuring the word gets re-reinforced soon.

  **Daily new-word soft cap:** default 10 new words/day. Soft cap, not hard — when the user crosses 10, surface a non-blocking prompt: *"You've added 10 new words today. Want to take a break, or review the ones you just learned?"* Three actions: continue, review-just-these, stop. Cognitive-load research supports this kind of nudge over hard limits.

  **Review modes** (selectable in the UI):
  - *Mixed* (default): due reviews + a small share of new words (5–10).
  - *New only*: only words at stage 0.
  - *Lapses only*: only words with `lapses > 0`, ranked by lapse count desc — i.e. the words causing the most trouble.
  - *Mastered control*: an occasional sweep over stage-6 words (one mastered word every 10 reviews, sprinkled through the queue) to catch retention failures early.

  **Mastered ≠ done.** A stage-6 word still appears occasionally (every ~60 days, plus the control-sweep mixed in earlier). If the user fails it, it drops back per the lapse rules — no special "mastered" protection.

  **Sort within a session:** due words ordered by `next_due_at ASC`, with new words inserted at the position determined by the **personalised LLM ranking** below.

  ### Personalised word ranking — LLM-driven 3-anchor binary search

  Instead of ranking by static corpus frequency, each user's word stack is ranked by a personalised priority that weighs **target-language importance** + **the user's own interests**. New words are inserted at their personally-correct position via async background search.

  **Why personalised, not static frequency:**
  - A football fan needs *marcador* and *entrenador* high in their stack even though those are mid-frequency overall.
  - A hard-sci-fi reader benefits from *gravedad*, *tripulación*, *hibernación* much more than the corpus rank suggests.
  - Static frequency is a good universal signal but a weak personal signal.

  **Algorithm: 3-anchor binary search.**

  Each round picks 3 anchor words from the middle of the current search range. The LLM is asked where the new word fits among the 3 anchors. With 3 anchors there are 4 possible buckets, so each round eliminates ~75% of the search space.

  - Stack of N words → roughly **log₄(N) rounds** until convergence
  - 10,000-word stack → **~7 LLM calls** per insertion
  - Each call ~1s + ~$0.0001 → **~7s and ~$0.0007 per word**
  - Runs **async in the background** while the user keeps interacting — no blocking UX

  **Edge cases:**
  - Empty stack: insert at position 0, no LLM call.
  - Stack < 10 words: skip binary search; one LLM call asks for a full ordering of the existing stack + new word.
  - Stack ≥ 10: full 3-anchor search.

  **Prompt template** (passed as `system` content in a `gpt-4o-mini` call with `response_format: json_object`):

  ```
  The user is a persona learning ${TARGET_LANGUAGE}.

  Their interests:
  ${user_interests_list}

  Based on the following two criteria — weighted as shown — rank words by how
  important they are for THIS user to learn:
    - Importance in ${TARGET_LANGUAGE} (general frequency / utility): 60%
    - Importance for the user's interests: 40%

  Compare the new word to the following three anchor words. The new word can
  be before all three, between them, or after all three.

  New word: "${new_word}"

  Anchor words (in order of decreasing importance):
    A: "${anchor_A}"
    B: "${anchor_B}"
    C: "${anchor_C}"

  Return ONLY valid JSON:
  { "position": "before_A" | "between_AB" | "between_BC" | "after_C" }
  ```

  After each call, narrow the search window to the chosen bucket and pick 3 new anchors from its middle. Repeat until the bucket has < 4 items, then insert at the indicated position within it.

  **UX during insertion:**
  - The new word appears immediately at the end of the stack (or wherever the user happens to be looking) with a subtle *"Wird einsortiert…"* spinner badge.
  - When the search converges (~7s later), the word animates to its real position. If the user is in vocabulary practice meanwhile, this is invisible — the word just lands somewhere in the queue and shows up at its right time.
  - Multiple insertions can run in parallel (each word's search is independent).

  **No static frequency list needed.** The LLM has implicit frequency knowledge from training. The static `lib/freq/es.txt` originally planned for Phase 8 is dropped — drop also `freq_rank` from `user_unknown_words` if it ends up unused. Personal rank is the source of truth.

  ### Vocabulary save & test (English-description-anchored)

  See [`DISREGARDED_IDEAS.md`](./DISREGARDED_IDEAS.md) for the previous design (native_translation column + Phase A/B casing pipeline + Step 1/2/3 synonym-merging) and the rationale for replacing it.

  **Core idea.** Don't store the native translation. Store only the target word + a short LLM-generated English description of the SPECIFIC sense the word had in the context where it was tapped. The lowercase target word is the dedup key; the description is what distinguishes polysemous senses. Native translations are computed on-demand at test time — pre-generated for low-progress cards (instant flip), generated lazily for high-progress cards.

  This dissolves the casing problem on the native side (nothing native stored), the synonym-merging problem (synonyms collapse to the same description), and the disambiguator-UI problem (no positive hint shown by default; negative hint generated on-demand only when SRS stages diverge).

  #### Storage shape

  Per row:
  - `id` PK auto-increment
  - `user_id` FK
  - `target_word_original` — surface form as the user encountered it (preserves casing, "comió" stays "comió", do NOT lemmatise)
  - `target_word_lower` — lowercased form, the dedup key
  - `english_description` — 3-7 word phrase pinning this specific sense (e.g. `"to sit on (a bench)"` for `banco` as bench, `"financial institution"` for `banco` as bank)
  - `context_sentence` — the AI-bubble sentence the word was tapped in (kept for audit, possible re-derivation, optional UI hints)
  - SRS columns: `stage`, `next_due_at`, `correct_streak`, `lapses` (per the existing Spaced Repetition design above)
  - `created_at`, `last_seen`, `looked_up`

  Indexes:
  - `(user_id, target_word_lower)` non-unique — dedup lookup at save time
  - `(user_id, next_due_at)` — SRS scheduling

  No `native_translation` column.

  #### Save flow

  1. Receive `(target_word, context_sentence)` from the AI-bubble tap. The context sentence is the full AI message containing the tapped word.
  2. Normalise `target_word`: NFC, trim, strip edge punctuation, collapse whitespace. Compute `target_word_lower = normalised.toLowerCase()`.
  3. Generate English description (gpt-4o-mini, see prompt in `lib/vocab.ts` once implemented). ~80 input + ~10 output tokens, ~$0.000018 per call.
  4. DB lookup: any existing row for this user with `target_word_lower` matching the new lowercase form?
     - **No match** → INSERT new row. Done.
     - **Match exists** → second LLM call (gpt-4o-mini): pass the new description and each matching row's description, ask `"same meaning (synonym) or different meaning (polysemy)?"`.
       - **Same** → don't save. Treat as duplicate. Soft-lapse the existing row (SRS stage − 1) per the existing rule, with the 5-minute cooldown.
       - **Different** → INSERT new row. Polysemy is now natively represented as multiple rows sharing `target_word_lower` but with different `english_description` and independent SRS state.
  5. Conservative tie-breaker: if the comparator returns ambiguous output, prefer to insert a new row. False-positive duplicates are reparable via the manual CRUD UI; lost entries are not.

  **Diacritics are NEVER stripped.** `sí` (yes) and `si` (if) are different words; both `target_word_lower` and `english_description` preserve the diacritic.

  #### Description prompt (gpt-4o-mini)

  Strict, example-driven, with the explicit constraint that synonyms should produce IDENTICAL descriptions while different senses should produce NOTICEABLY different ones. See [Prompt sketch — Description Generator](#prompt-sketch--description-generator) below.

  #### Test / review flow

  Vocab card displays `target_word_original`. The user types or speaks a translation in their native language.

  **LLM-judge per review** (gpt-4o-mini, ~80 input + 1-3 output tokens, ~$0.000018 per call):

  Inputs:
  - target_word_original
  - english_description (the sense being tested)
  - other_descriptions for the same `target_word_lower` (if polysemous)
  - user's answer (in native language)

  Outputs (single character):
  - `1` → correct (user's answer is an acceptable translation of THIS sense)
  - `X` → user's answer matches a DIFFERENT known sense of this word
  - `0` → wrong (doesn't match any known sense)

  The judge is instructed to be lenient on missing/extra articles, minor typos, synonyms, capitalisation. It rejects only on actual meaning mismatch.

  **SRS update by outcome:**
  - `1` → advance the row's SRS stage per the standard rules
  - `X` → SRS stage UNCHANGED on this row, UI shows `"Das ist die andere Bedeutung von '${target_word_original}'."`
  - `0` → lapse the row's SRS stage per the standard lapse rules (drop 2 stages from stage 3+, reset to 0 from stage 0-2)

  #### Polysemy display logic

  When multiple rows share `target_word_lower`:

  - **Stages similar (gap < 2):** the card shows just `target_word_original`. The user can answer with EITHER meaning. The row whose meaning the user produced advances; the other stays put.
  - **Stages diverged (gap ≥ 2):** when the lower-progress row is scheduled for review, the card shows `target_word_original` + a NEGATIVE hint generated on-demand: `"Diese Vokabel ist nicht '[other meaning, fetched via on-demand translation of the other row's description]'. Wir suchen die andere."`. The user must produce the weaker sense. Generated by gpt-4o-mini at test time, rare, cheap.

  This negative-hint approach pushes the user toward the weaker meaning without revealing the answer (replaces the previous "always-on positive disambiguator" idea).

  **Edge case:** if the user's answer comes back `X` and the system needs to know which OTHER row matched, the judge's prompt can be expanded to return `X:row_id`. But for the v1 implementation, just returning `X` is enough — the UI message references "the other meaning" without naming it, so the user is gently nudged.

  #### Native-translation on demand (the "flip card" feature)

  The vocab card has a "show me the answer" affordance. When the user flips the card, they see the native-language translation of THIS specific sense.

  Two modes:
  - **Pre-generated** for cards with stage < 3 (low-progress, where the user is most likely to need to flip). When the SRS scheduler loads the next 5 cards, pre-generate native translations in the background. Zero perceived latency on flip.
  - **On-demand** for stage ≥ 3 (the user mostly knows these). Generate at flip-time. ~400ms latency, acceptable since the user explicitly asked for the answer.

  Translation prompt (gpt-4o-mini, ~50 input + 5-10 output tokens):
  ```
  Translate the ${target_language} word "${target_word_original}" into
  ${native_language}. The specific sense being tested is:
  "${english_description}".

  Reply with ONLY the most natural ${native_language} equivalent in
  vocab-card style: include the article for nouns, include the subject
  pronoun for 1st/2nd person verbs, etc.
  ```

  Cache per row. Invalidated only if `english_description` changes (rare).

  #### Cost analysis at scale

  Heavy user, 10000 reviews + 500 saves per month:
  - Saves: 500 × 1 description call + ~10% × 1 comparator call = ~550 calls × $0.000018 ≈ **$0.01**
  - Reviews: 10000 × 1 judge call = **$0.18**
  - Native-translation generation: ~5000 calls (preloaded for low-progress, on-demand for high-progress) × $0.000018 ≈ **$0.09**
  - Negative-hint generation (rare polysemy-divergence cases): negligible

  Total: **<$0.30/month** for an extreme heavy user. Casual users: pennies.

  #### Schema migration from the existing `user_unknown_words` table

  Today's schema:
  ```sql
  user_unknown_words (
    user_id, word, native_translation, freq_rank, looked_up, last_seen
    PRIMARY KEY (user_id, word)
  )
  ```

  New schema (rough):
  ```sql
  user_unknown_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    target_word_original TEXT NOT NULL,
    target_word_lower TEXT NOT NULL,
    english_description TEXT NOT NULL,
    context_sentence TEXT,
    stage INTEGER NOT NULL DEFAULT 0,
    next_due_at INTEGER,
    correct_streak INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    looked_up INTEGER NOT NULL DEFAULT 1,
    last_seen INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX idx_uuw_user_lower ON user_unknown_words(user_id, target_word_lower);
  CREATE INDEX idx_uuw_user_due ON user_unknown_words(user_id, next_due_at);
  ```

  Migration of existing rows (Phase 8 collected `(user_id, word, native_translation)` pairs without descriptions): backfill with a one-shot script that, for each existing row, generates a description from the word + native_translation as a synthetic context. Or: discard existing data (the Phase 8 collection was pre-SRS scaffolding anyway). Final call when the migration is built.

  Done as a real migration in `lib/migrations/` (the migration runner is in place since `6858027`).

  #### Open question — description language

  English is the v1 anchor. Works for German speakers (almost always read English). Breaks for users whose native language is non-English and who don't read English. When the user base expands beyond German speakers, revisit:
  - Use native language as anchor → gives away the answer at test time.
  - Use target language as anchor → requires target proficiency the learner doesn't have yet.
  - Per-user choice → schema gets a flag, descriptions stored per language.

  Defer until needed.

  #### Prompt sketch — Description Generator

  Inputs: `target_word_original`, `context_sentence`, `target_language` (Spanish), `native_language` (German — used only as a hint to the model about the user's reference frame, not to bias the description).

  ```
  You are generating a sense-key for a vocabulary entry. The learner is
  studying ${target_language}; their native language is ${native_language}.
  They have just tapped a word in a ${target_language} sentence.

  Write a SHORT English description (3-7 words) of the SPECIFIC SENSE the
  tapped word has in this sentence. The description is used as a sense-key:
  it must be precise enough that two genuinely different meanings of the
  same word produce noticeably different descriptions, but generic enough
  that two synonymous translations of the same meaning produce IDENTICAL
  descriptions.

  Rules:
  - 3 to 7 words. No leading article. No trailing period.
  - Describe the meaning, not the form (do not write tense / number).
  - Be neutral about register / dialect.

  Worked examples:
    "banco" in "el banco está cerrado los domingos"        → "financial institution"
    "banco" in "me senté en el banco del parque"           → "long bench to sit on"
    "fuego" in "encendió el fuego en la chimenea"          → "literal fire / flame"
    "fuego" in "siento un fuego dentro al verla"           → "passionate intensity / inner fire"
    "hoja" in "la hoja se cayó del árbol en otoño"         → "leaf of a plant"
    "hoja" in "necesito una hoja de papel"                 → "sheet of paper"
    "hoja" in "la hoja del cuchillo está afilada"          → "blade of a cutting tool"
    "comer" in "vamos a comer pasta"                       → "to eat (food, meal)"
    "Madrid" in "vivo en Madrid desde hace cinco años"     → "Madrid (city, capital of Spain)"
    "Coca-Cola" in "una Coca-Cola fría"                    → "Coca-Cola (the soft drink brand)"

  Word: "${target_word_original}"
  Context: "${context_sentence}"

  Return ONLY the description string. No JSON, no quotes, no explanation.
  ```

  Output validation: trim, ensure non-empty, ensure ≤ 60 characters. If the model returns something obviously wrong (empty, too long, contains the target word verbatim), retry once.

  #### Open question — what is "soft lapse" in the new model

  The old model soft-lapsed on exact-pair re-lookup (`(target, native)` already saved). The new model has no native side. Adapt to: soft-lapse when `target_word_lower` matches AND the comparator says "same meaning". 5-minute cooldown unchanged. The user looking up a word they already have stored under the same sense is the signal of imperfect retention, regardless of whether they typed the exact same German equivalent or a synonym.

  ### Algorithmic future direction

  If the simple stage system feels rigid after some real usage data, swap in **FSRS** (Free Spaced Repetition Scheduler — currently the best-performing public SRS algorithm, integrated into Anki since 2024). FSRS uses continuous stability/difficulty per card and re-fits to the user's actual recall data. Higher accuracy, more complex to implement. Worth the upgrade if the discrete-stage system shows obvious gaps.

  ### Known limitations / future work

  Things that are not blockers for the initial Spanish↔German build but should be addressed before the system is generalised or shipped to more users.

  - **Race condition on rapid double-taps.** Two concurrent saves of the same word can both pass the lowercase-lookup before either has written, then both insert as polysemous-different rows. Mitigation: serialise per-`(user_id, target_word_lower)` in the application, or add a brief debounce on the AI-bubble tap handler so only one save fires per word per N seconds.

  - **Description-comparator misclassifications.** The synonym-vs-different LLM call can wrongly merge two distinct senses (false synonym) or wrongly split two identical ones (false polysemy). Mitigations: (1) conservative tie-breaker on ambiguous output (prefer new row over merge); (2) manual CRUD UI lets the learner repair entries; (3) log every comparator decision so we can audit the false-rate later.

  - **Description generator drift.** The LLM may produce stylistically inconsistent descriptions for similar contexts (e.g. `"a place to sit"` once, `"long bench to sit on"` later for the same bench-sense of `banco`). Strict prompt with worked examples mitigates this. Validation gates after generation (length, non-empty, no verbatim target word) catch obvious failures. If drift remains a problem, consider regenerating descriptions in batch when one looks off.

  - **No offline mode.** Every review fires an LLM-judge call; every flip on a stage-3+ card may fire a translation call. The learner needs internet for vocab review. Acceptable for v1; offline-capable mode is a separate feature.

  - **Description language assumes the learner reads English.** v1 is German speakers learning Spanish — fine. For other native-language learners, see the "Open question — description language" section above.

  - **Reverse-direction lookups are out of scope.** The system is one-way (target language → native). The user can't tap a German word and look up the Spanish equivalent. Probably fine — we're optimising for the "user is reading target-language content" flow.

  - **LLM judge errors are unrecoverable without UI.** The judge accepts/rejects/cross-meanings answers, and is occasionally wrong. Without a "manage my vocabulary" UI, mis-classified entries can't be merged, split, deleted, or have their description corrected. The vocab-mode UI must include basic CRUD.

The dashboard becomes the new `/` route; current home becomes something like `/conversation`.

---

## 2. Conversations page redesign

When the user enters **Conversation practice**, the page should put **previous conversations** at the top — primary, scannable. Below or alongside, a way to **create a new conversation**.

Two options for "new conversation":

1. **Choose a topic** — opens the topic grid (current behaviour). 4-3-2 split, re-roll, etc., as today.
2. **Quick start** — picks one topic automatically (random pick from `current` set, or a fresh single-topic LLM call) and drops you straight into chat. The chat header offers a re-roll button to jump to another topic if the auto-pick doesn't land.

The default flow can be either; let UX testing decide.

---

## 3. Re-roll inside an active chat

While in conversation mode, a small re-roll button in the header lets the user abandon the current topic and start a new one (auto-picked or via the grid). Especially useful for the "quick start" flow when the auto-pick doesn't resonate.

Implementation note: this either opens the topic grid as an overlay, or just spins a new auto-pick.

---

## Implementation notes

- Dashboard is a thin shell over existing routes — minimal new infra.
- Vocabulary mode reads from `user_unknown_words` (rewritten per the Vocabulary save & test section above). Sort by personalised priority — see the 3-anchor binary search section. `freq_rank` is dropped from the new schema. The Phase 8 data collection (legacy `(target_word, native_translation)` rows) is migrated or discarded per the schema-migration plan.
- "Quick start" can reuse `getCurrentSet()` and just pick one topic at random server-side; or call the LLM for a single fresh topic.
- Conversation list reads from `conversations` table — already FK'd to user, indexed.

---
