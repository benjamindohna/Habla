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

## 4. Exploration Map — gamified language journey

A major new mode (peer to "Conversation practice" and "Vocabulary repetition" on the dashboard, see §1). The user navigates a visual map of the target country — Spain for Castellano, optionally extending into Latin America for other variants. Each location on the map is an NPC encounter the user can play through. Defeating an NPC means completing a conversation cleanly, without misunderstandings derailing it and — crucially — without triggering the **death sentence**: the NPC switching to English ("why don't we switch to English?"). On fail, the NPCs visually go red, become monstrous, scream the death sentence; on win, the level checkmarks, rewards drop, and the user moves to the next location.

The whole point is: *make progress feel like progress*, *make conversations feel like quests*, and *prevent rote memorisation* so the user actually has to learn the language to advance.

### Core loop

For each NPC encounter:
1. **Setup** — a short scene framing why this person is talking to you and what's at stake (e.g. "she has to run and asks you to hold her baby for a moment"). LLM-generated at session start, varied each play.
2. **Conversation gameplay** — voice-based back-and-forth, same correction pipeline as today (interpret → localize → segment → explain). The NPC's voice is TTS, the user records replies.
3. **Success criteria** — implicit. The NPC does NOT switch to English. Misunderstandings either get resolved (good) or compound (bad). When the conversation reaches its natural end with the situation OK, level passed.
4. **Fail criteria** — explicit. NPC says "why don't we switch to English?" → instant level fail. Or: the situation goes wrong (e.g. mother returns and the baby is upset because she got nothing right) → level fail.
5. **Reward / consequence** — XP, coins, badges, map progress on success; a fail screen with the option to retry.

### Concrete level examples (sketches, all variation-friendly)

**Beginner — *El bebé en el parque*.** A Spanish woman approaches you in a park, clearly stressed, hands you her baby and asks if you can watch her for two minutes — she has to grab something urgent (the LLM picks a plausible reason — wallet at the bench, kid's lost shoe, etc.). The baby starts pointing at things in the park and asks "¿qué es eso?" — *what is that?* You name them. Each correct word is fine; each wrong word is silently noted. When the mother returns, she asks the baby what they learned — the baby parrots back what you said. If most are right, mother smiles, thanks you, level passed. If most are wrong, mother looks worried, takes the baby quickly, level failed (with a soft fail — no red-monster scream, just disappointment).

Vocabulary tested: ~10-15 absolute beginner concrete nouns. Variation: the LLM picks from a pool of ~50 park-visible objects per playthrough; user can't memorise a fixed list.

**Beginner — *El abuelo del banco*.** An old man in the park starts telling you about his life — slow speech, common words, no flowery language. He pauses, looks at you expectantly. You can ask follow-up questions ("¿y luego?", "¿cuántos años tenía?", etc.) to keep the conversation going. He occasionally tests you ("¿entiendes?"). Pass = engage well enough that the conversation winds down naturally with a "fue un gusto hablar contigo, joven". Fail = silence too long, or wrong response to "entiendes?" → he switches to English to help, level failed.

**Intermediate — *La Sagrada Família*.** Cultural location: Barcelona. A tour guide near the basilica asks if you'd like a quick mini-tour. She talks about Gaudí, the construction history, the symbolism. You ask questions, react. Level passes if you stay engaged; fails if you can't follow and she switches.

**Intermediate — *El partido en el Bernabéu*.** A Madrid football fan in a bar wants to discuss the last Real game. Heavy register, fast speech, lots of casual idioms. Level passes if you can hold a 5-minute conversation about the game.

(Many more — markets, train stations, family dinners, regional festivals.)

### Anti-memorisation as a core design principle

This is non-negotiable. A user who knows zero Spanish must NOT be able to pass all levels in a day by memorising sequences. If they can, the gamification is hollow.

**Mechanism**: every level is generated per-session by an LLM, given a **skill rubric** that fixes the difficulty target without fixing the content. The rubric specifies things like:
- Vocabulary tier (~A1, ~A2, ~B1...)
- Required grammatical structures (present tense only / + preterite / + subjunctive...)
- Conversation length target (3 turns / 6 turns / 10+ turns)
- "Failure modes to test" (e.g. "user must distinguish ser vs estar", "user must form a polite request")

The LLM uses the rubric to construct a fresh scene and dialogue path each time. Same skill assessment, different surface. A user who passes "El bebé en el parque" once and tries again gets a different baby with different objects pointed at; the difficulty is identical, the script is not.

**LLM is well-suited for this** — it can reliably generate level-equivalent content from a structured rubric. Risk: rubric drift (the LLM picks easier content than intended). Mitigation: a separate validator LLM call that checks "does this generated level meet the rubric's difficulty target?" before showing it.

### Side bosses — optional encounters with weird mechanics

Off the main path. Not required to progress. Reward: cosmetic (badges visible in profile), XP, coins (currency for some yet-to-design economy), titles. The mechanic is what makes them fun:

- **El espíritu del bosque** — a forest spirit who will only listen to you if your replies are exactly 7 words AND grammatically perfect. Wrong word count → it gets bored and disappears. Grammar error → it gets scared and disappears.
- **El poeta del río** — every reply must rhyme with the last word of his previous turn. The last words are LLM-generated each session, so no memorising the rhymes — you have to actually navigate Spanish phonology on the fly.
- **La pitonisa** — luck-based. She rolls metaphorical dice; you get a difficulty class assigned for the encounter. Fair only on average.
- **El pelele** — extreme difficulty. Conversation runs at 1.5× speed, no pauses, native register. You either keep up or you don't.

Side bosses give the map texture beyond linear progression. Players who hit a tough main level can try a side boss instead, often coming back stronger.

### Major checkpoints / aspirational characters

The map shouldn't feel like a flat sequence. Specific destinations the user *wants* to reach:

- **The cool guy in the bar in Madrid** who only talks to people who can hold their own. He's locked behind 7 levels of progression. Once you get to him, he opens up new map regions, gives you a unique badge, etc. Players grind toward him.
- **The grandmother who tells you the family secret** — only opens up after you complete a "trust" sub-arc. A multi-session story payoff.
- **The cathedral / monument moments** — visiting major cultural sites with rich content tied to them.

### Atmospheric / visual design

The map itself should feel like a journey. Sketch:
- A stylised illustrated map of Spain (and later Latin America regions). Locations as pins.
- NPCs visible at their locations as small character portraits.
- On level-fail (NPC switches to English): the portrait turns red, animates monster-like, screams the death sentence. Brief horror-comedy effect — communicates "you really don't want this to happen" without being punishing.
- On success: subtle celebration — a small animation, the next location pin unlocks, reward pop-up.

Style: closer to Duolingo's playful illustration than to a serious sim. Charming, not corporate.

### Character expression progression — emotional stakes

The NPCs aren't quest-givers, they're *people the player should not want to disappoint*. Their portraits and micro-expressions evolve through the encounter based on the same tension counter that drives the audio:

- **Default** — warm, open, pleased to be talking to the player. The abuelo del banco genuinely smiles; the woman with the baby is grateful; the tour guide is enthusiastic.
- **First mistakes** — micro-expressions only. A brief suspicious glance with narrowed eyes — *„hm, was war das?"* — then back to normal. A raised brow. A slightly delayed reaction. Subtle enough that some players will only feel it subliminally; others will register the shift consciously and snap to attention.
- **Continued mistakes** — the warmth visibly drains. The abuelo stops smiling. The mother holds her baby a little tighter. The tour guide's enthusiasm cools to politeness. The portrait shifts but isn't yet alarming.
- **Critical state** — the character looks *let down*. Not angry yet — disappointed. The abuelo's brow furrows; he looks at you the way an old man looks at a kid who isn't paying attention. The mother starts looking around as if maybe she shouldn't have trusted you. The kind of "you're losing them" feeling that's far more motivating than any score bar.
- **Death sentence** — the character is transformed. Per-personality:
  - The abuelo goes cynical-resigned, says *„weißt du was, vielleicht ist es einfacher auf Englisch"* with a tired half-smile that contains all the disappointment in the world. No anger, just a quiet "I gave up on you".
  - The mother gets sharply protective — sudden distrust, takes the baby back fast, *"sabes qué, mejor en inglés"* with edge.
  - The football fan in the Madrid bar gets annoyed-bordering-on-angry — *"tío, vamos a inglés y ya está"*.
  - Each character's failure mode reflects who they are. Same mechanic, different emotional flavour.

The point isn't to make the player feel bad — the failure animation is still horror-comedy with the red-monster spike from the visual design. The point is the *journey to that point* should feel emotionally real. The micro-expressions in the warning phase are what make the player think *"shit, I don't want to disappoint this guy"* and decide to actually sit down and learn before retrying — not just hammer the level until they brute-force it.

Implementation: per character, a small set of portrait states (5-7 expressions covering default → mild suspicion → cooling → disappointed → death-sentence-transformed). The tension counter selects the active state. Same engine as the audio crossfade. For LLM-driven NPC dialogue, the system prompt can also inject the current emotional state so the character's *spoken* lines match the *visual* state — getting curter, less generous, more terse as tension rises.

This is the difference between a level the player tries again and again because they want to win, and a level the player goes away from and **studies for** because they don't want to disappoint a character they've come to respect. The latter is what actually makes the gamification align with learning instead of fighting it.

### Audio / suspense build

The atmosphere is what makes this funny instead of stressful. Layer ambient music that responds to the encounter's tension state:

- **Default state (calm conversation flowing well)**: warm, mild, almost-not-noticed background. Maybe a subtle Spanish-flavoured guitar / cafe ambience appropriate to the location (park birdsong for the abuelo level, market chatter for the mercado, etc.).
- **First mistakes (user stumbles)**: the music starts adding string-tension elements — the kind of sustained-violin rauschen / drone that horror or thriller scores use to signal "something is wrong". Quiet at first.
- **Continuing mistakes / NPC frustration building**: tension layer gets louder, more dissonant. Maybe sparse high-string stabs. The NPC's portrait subtly shifts — eye narrowed, brow furrowed, slight delay before responding.
- **Critical state (one or two more wrong moves and it's over)**: full suspense. The strings are now prominent, dissonant, building. The NPC is *visibly* about to switch — a long pause before their next line, a worried/disappointed look on the portrait. The user *feels* the imminent doom.
- **Death sentence trigger**: BAM. Music spikes, portrait goes red-monstrous, "why don't we switch to English?" delivered with horror-comedy weight. Brief silence after. Then a fail-screen with the option to retry.
- **On recovery (user pulls it back from the brink)**: the tension layer subsides over a few turns. Earned-back-trust feeling. NPC visibly relaxes. Catharsis.

Implementation thoughts:
- Few looping ambient tracks per location-mood (calm, tense, critical) crossfaded based on a tension counter the game state tracks. Tension counter = function of (recent mistakes, conversation duration without progress, native-language fallbacks per turn). Doesn't need to be smart — a simple weighted score works.
- Tracks could be sourced from royalty-free libraries, or for character: a small commissioned music budget gives the app real personality. Big differentiator vs. Duolingo etc.
- Audio is one of the cheapest UX wins for atmospheric games. A 5-minute composition pack covering calm/tense/critical/fail across 3-4 location moods is a few hundred dollars one-time and elevates the whole product.

Mute toggle in settings is mandatory — many learners study in shared spaces or want their own music. But default-on is fine because it's so much of the atmospheric draw.

### Progression and reward economy

XP system:
- Per level: XP scaled by difficulty
- Per side boss: bonus XP
- Per perfect playthrough (no errors): bonus
- XP unlocks new map regions

Currency (coins):
- Drops from levels and side bosses
- Spendable on... cosmetics? Hint tokens? Re-tries on a failed level without losing progress? TBD.

Badges:
- Visible in profile
- Awarded for side bosses, special accomplishments ("first level passed without a single mistake", "rhymed with el poeta 5 times", "spoke for 10+ turns without a single English fallback")
- Optional sharing if a social layer exists

### Open design questions

- **Engine / rendering**: 2D illustrated map in browser → straightforward (SVG / canvas). Native mobile would be cooler but a much bigger build. Web-first.
- **Voice quality**: TTS for NPC voices needs to feel like *characters*, not narrator. May need different voices per NPC (the old man sounds old, the baby sounds high-pitched). gpt-4o-mini-tts has voice-styling via the `instructions` parameter; could parameterise per character. Or use multiple voice IDs.
- **Story persistence**: once a level is passed, is the next playthrough a new variant of the same level (re-grindable) or locked-as-passed? Probably: passable once, replayable for XP at reduced rate.
- **Progress save**: per-user "map state" (which locations passed, current XP, badges, etc.). New table `user_map_progress`.
- **Cost per level**: each NPC encounter is a multi-turn LLM-generated conversation. Per turn: same as the current chat (correction + reply pipeline). Per level: maybe 5-10 turns × current per-turn cost (~$0.007) = $0.04-0.07 per level played. That's the dominant cost — would need to think about caps for free-tier users if there ever is one.
- **Anti-memorisation validator**: a second LLM call per level-generation step to verify rubric adherence. Probably necessary; not free.
- **Failure UX**: how harsh is the fail screen? Souls-like ("you died") or gentle ("the conversation didn't go well — try again")? Different audiences want different things.
- **Content moderation**: the NPC scenes are LLM-generated. Edge cases where the LLM produces weird / inappropriate content for a learning context — guard prompt + content checks.

### Build phasing

If we ever do this, an order:
1. **Single-level prototype** — one location, one NPC, no map. Just `/explore/level1` that runs the gamified conversation flow. Validates the core loop is fun before any map infrastructure.
2. **Map shell** — 5-10 locations, hardcoded levels, basic XP / progress save.
3. **Anti-memo skill rubric** — LLM-generated levels from rubric.
4. **Side bosses + reward economy**.
5. **Aspirational characters / story arcs**.

Each phase is a substantial build (multi-week). This is months-of-work territory, not days. Worth it only when the conversation mode + vocab mode are stable and proven.

---

## Implementation notes

- Dashboard is a thin shell over existing routes — minimal new infra.
- Vocabulary mode reads from `user_unknown_words` (rewritten per the Vocabulary save & test section above). Sort by personalised priority — see the 3-anchor binary search section. `freq_rank` is dropped from the new schema. The Phase 8 data collection (legacy `(target_word, native_translation)` rows) is migrated or discarded per the schema-migration plan.
- "Quick start" can reuse `getCurrentSet()` and just pick one topic at random server-side; or call the LLM for a single fresh topic.
- Conversation list reads from `conversations` table — already FK'd to user, indexed.

---
