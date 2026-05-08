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

  ### Vocabulary canonicalisation (normalisation + casing filter)

  Before any save logic runs, both `target_word` and `native_translation` are run through a canonicalisation pass so the DB never sees superficially different versions of the same string.

  **Standard normalisation** (always applied):
  ```ts
  function normalizeVocab(s: string, caseSensitive = false): string {
    const base = s.normalize("NFC").trim()
      .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")  // edge punctuation
      .replace(/\s+/g, " ");                      // collapse internal whitespace
    return caseSensitive ? base : base.toLowerCase();
  }
  ```
  Steps: Unicode NFC composition (so `é` is one code-point, never `e + ◌́`), trim, strip leading/trailing punctuation (Unicode-aware via `\p{P}` — handles `¿`, `¡`, `«`, `»`), collapse internal whitespace. Casing handled separately via the filter below.

  **Diacritics are NEVER stripped.** `si` (if) and `sí` (yes) are different words; `lodash.deburr` and similar are forbidden.

  **Lemmatisation is NEVER applied.** Surface form is preserved per the storage rule (`comió` stays `comió`, not collapsed to `comer`).

  **Casing filter** (only runs when at least one side starts uppercase — runs async, fire-and-forget):

  ```
  Phase 0 — Fast path
    If both target_word and native_translation start lowercase:
      → skip the filter, save with normal lowercase normalisation. Done.

  Phase A — Per-side "always uppercase" check
    Independently for each side that starts uppercase:
      LLM judgement: is this word ALWAYS uppercase in this language (proper
      noun, German noun, brand, etc.) — or is it just incidentally uppercase
      because of sentence-start position?

      IMPORTANT: the prompt MUST include the other language's translation as
      reference, so the model knows what the word means. Without that context
      "Pan" could be either bread (incidental) or a surname (always).

      Result per side: "always" or "incidental"

    Save accordingly:
      "incidental" → that side stored lowercase
      "always"     → that side stored with original case

  Phase B — Proper-noun filter
    ONLY runs when BOTH sides came back "always uppercase" in Phase A.

    LLM judgement: is this a proper noun (person, place, brand)?
      YES (proper noun):
        Is the form different across the two languages?
          DIFFERENT → save with proper case (e.g. Roma / Rom).
          SAME      → DO NOT save (no learning value, e.g. Madrid / Madrid).
      NO (not a proper noun): save with respective casings from Phase A.
  ```

  **Worked examples:**

  | target | native | Phase A (target) | Phase A (native) | Phase B? | Result |
  |---|---|---|---|---|---|
  | comer | essen | – | – | no | save (comer / essen) |
  | Comer (sentence-start) | essen | "incidental" | – | no | save (comer / essen) |
  | comer | Essen (sentence-start) | – | "incidental" | no | save (comer / essen) |
  | lluvia | Regen | – | "always" (German noun) | no (only one side) | save (lluvia / Regen) |
  | Madrid | Madrid | "always" | "always" | yes → same → **skip** | not saved |
  | Roma | Rom | "always" | "always" | yes → different | save (Roma / Rom) |

  **Cost:** ~$0.00004 per save where the filter triggers (gpt-4o-mini, ~150 input + 30 output tokens per LLM call). The fast path skips the filter entirely for the common all-lowercase case, so most saves are free.

  ### Save logic — synonyms vs. polysemy

  When a user taps a word in an AI bubble, the client sends `(target_word, native_translation, context)` to the backend. The backend then runs:

  ```
  Step 1 — Exact pair already exists?
    Look up: does an entry with the SAME (target_word, native_translation)
    already exist for this user?
      YES → Don't re-save. Treat the lookup as a soft lapse on the existing
            entry: roll its SRS stage back by one step (rationale: if the user
            had to look it up again, they didn't really retain it). Update
            last_seen, looked_up++.
      NO → Step 2.

  Step 2 — Same target word, different translation?
    Look up: any entry exists where target_word matches?
      NO → New entry. Done.
      YES → Step 3 (LLM call).

  Step 3 — LLM classification (one call):
    Inputs: existing entry (target_word, native_translation, context),
            new attempt (target_word, native_translation_new, context_new).
    Question: are the two native translations essentially synonyms (same
              meaning, just different wording, like Regen / Niederschlag), or
              are they genuinely different meanings of the same target word
              (different lexical sense, like 'banco' as bench vs. as bank)?

      SYNONYMS  → Append the new native_translation to the existing entry's
                  translations list, e.g. "Regen / Niederschlag". Keep one row.
                  Stays in the existing entry's SRS stage.
      DIFFERENT → New independent entry. Both rows have the same target_word,
                  different context, different translation. SRS stage starts
                  at 0 for the new entry.
  ```

  **Schema implications:**
  - PK changes from composite `(user_id, target_word)` to a separate `id` (auto-increment), with a non-unique index on `(user_id, target_word)`. Multiple entries per user per word are now possible (polysemy case).
  - `native_translation` becomes a separator-joined string, e.g. `"Regen / Niederschlag"`.
  - LLM call cost: ~$0.00004 per save where Step 3 fires; happens only when the user looks up a word they already have under a different translation. Most lookups never reach Step 3.

  ### Test logic — multiple entries for the same word

  When the SRS scheduler picks an entry to test and shows the target word, the test logic also checks for OTHER entries for the same `target_word` (polysemy case). Behaviour depends on the SRS stage gap between the entry being tested and the other entries:

  ```
  Entry being tested: stage T_now
  Other entries for same target_word: stages [O_1, O_2, ...]

  For each other entry O_i:

    abs(T_now - O_i) ≤ 2:
      Treat both translations as acceptable. The user can answer with the
      tested entry's translation OR with O_i's translation; whichever
      matches gets the +1 progress step.

    O_i is more than 2 stages behind T_now (i.e. T_now - O_i > 2):
      The user already knows the tested entry well; we want to push them
      toward the lesser-known meaning O_i.
      → On the test card, show the tested entry's native_translation
        STRUCK THROUGH with a small "(nicht erlaubt)" header.
      → Beside it, a small "?" icon. Hover/tap reveals: "Du hast bereits
        andere Übersetzungen für dieses Wort gelernt — diesmal suchen wir
        eine andere."
      → User must answer with one of the other-entries' translations.
      → The entry whose translation the user gives is the one that
        advances. The originally-tested entry's stage is unchanged
        (open question — flagged below).
  ```

  **Open question:** when the user answers with another entry's translation, the originally-scheduled entry doesn't move. Default behaviour above is "stays at its stage, gets re-scheduled later". Alternative: also bump the original entry, since the user demonstrated knowledge of the word (just not that specific meaning). Default chosen because it's strict and pedagogically correct — the user did not retrieve the specific meaning that was being tested.

  ### Algorithmic future direction

  If the simple stage system feels rigid after some real usage data, swap in **FSRS** (Free Spaced Repetition Scheduler — currently the best-performing public SRS algorithm, integrated into Anki since 2024). FSRS uses continuous stability/difficulty per card and re-fits to the user's actual recall data. Higher accuracy, more complex to implement. Worth the upgrade if the discrete-stage system shows obvious gaps.

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
- Vocabulary mode reads from `user_unknown_words` (Phase 8). Sort by personalised priority — see the 3-anchor binary search section above. The `freq_rank` column from the original Phase 8 plan can be dropped if the personalised ranking ends up being the only sort key.
- "Quick start" can reuse `getCurrentSet()` and just pick one topic at random server-side; or call the LLM for a single fresh topic.
- Conversation list reads from `conversations` table — already FK'd to user, indexed.

---
