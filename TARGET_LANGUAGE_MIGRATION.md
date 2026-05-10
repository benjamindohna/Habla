# Target-language modularisation

Audit + phased migration of all hardcoded Spanish-isms in the codebase, so the app can support languages other than Spanish without surgery. Phases A and B are **done** (commits in `segments3-conversation`); C, D, E are tracked here for later.

The architectural anchor is `lib/targetLanguage.ts` — a `TargetLanguageSpec` (language + location/regional variant + style) plus `describeTargetLanguage()` which renders e.g. "everyday Castellano Spanish". `DEFAULT_TARGET` is the only concrete spec today; per-user spec is Phase D.

---

## Phase A — Field rename ✅

**Done.** Removed `_es` / `Es` suffixes from field/column names that hold target-language text, since "es" implies Spanish.

What changed:

- DB: `messages.text_es` → `messages.text_target` (migration `0004_messages_text_target.sql`)
- Types: `Segment.es` → `Segment.target`; `CorrectionResult.local_version_es` → `local_version_target`; `Topic.es` → `Topic.target`
- DB layer: `MessageRow.text_es` → `text_target`; `Message.textEs` → `textTarget`; `appendMessage({ textEs })` → `appendMessage({ textTarget })`
- Pipelines: `localize` JSON output schema `{ "local_version_es": ... }` → `{ "local_version_target": ... }`; `segment({ localVersionEs })` → `segment({ localVersionTarget })`
- Routes: `/api/converse/turn` request body `userTextEs` → `userTextTarget`; `/api/explain` body `localVersionEs` → `localVersionTarget`
- Components: `SealedUserBubble` prop `textEs` → `textTarget`; `ConversationView` `Message`/`InitialMessage` field; `CorrectionBlock` `result.local_version_es` accessors

TypeScript caught everything during the rename — no behavioural change, just naming.

---

## Phase B — Prompt strings ✅

**Done.** Replaced "Spanish" / "German" hardcoded inside prompt bodies with parameterised values OR explicit "(illustrative)" labels.

What changed:

- `lib/vocabRanking.ts` (bulkSort + binaryInsert): "Spanish vocabulary" / "any Spanish learner" → `${targetName}` (drawn from `DEFAULT_TARGET`)
- `lib/correctionPipeline.ts` (V1 + V2 segment): worked-example headers now read "illustrative — Spanish target, German native; rules apply to any language pair" so the LLM doesn't think the rules only apply to that pair
- `app/api/explain/route.ts` (V2 explain): same — header marked illustrative
- `lib/vocab.ts` (judge prompt): same — examples header marked illustrative

The example *content* (Spanish/German worked examples) stays in place — the LLM uses it to learn the output shape, and shape generalises across languages. Keeping concrete examples is more effective than abstract rules.

---

## Phase C — Per-language prompt fragments

**Not yet done.** Some Spanish-specific *content* is hardcoded inside prompts and would mis-fire on a different target language.

### Where the leaks are

**1. `app/api/tts/route.ts`** — the entire TTS instruction block is Castellano-Spanish-specific:

> Speak with a clear Castilian (Castellano, peninsular Spanish) accent — use the distinción: pronounce "c" before e or i, and "z", as the /θ/ sound … Barcelona sounds like "Barthelona", cinco like "thinco" …

For Hungarian this would be nonsense.

**2. `lib/aiBubblePipeline.ts` (translateWordInContext prompt)** — the segment-grouping rules are Spanish grammar:

- Article list: `"el", "la", "los", "las", "un", "una", "unos", "unas"`
- Compound tenses: `haber + past participle`, `estar + gerund`, `ir a + infinitive`, modal periphrases like `tener que ir`
- Idiom examples: `tener ganas`, `darse cuenta`, `echar de menos`, `por ejemplo`, `sin embargo`
- Multi-word named entities: `Estados Unidos`, `Real Madrid`, `Gran Vía`

These are concrete enough to bias the LLM if the target language is anything else.

**3. `lib/correctionPipeline.ts` (V2 segment prompt)** — same compound-tense + idiom + named-entity examples as above, in the "must stay unified" section.

**4. `app/api/explain/route.ts` (V2 explain prompt)** — the worked example uses Spanish grammar (`Substantiv + de + Substantiv`).

### Proposed structure

A new file `lib/targetLanguagePrompts.ts` with per-language tables:

```ts
export interface TargetLanguagePromptFragments {
  /** Articles to group with the following noun. */
  articles: string[];
  /** Free-text rule for compound-tense / multi-word verbal grouping. */
  compoundTenseRule: string;
  /** Free-text idiom-grouping rule + a handful of concrete examples. */
  idiomRule: string;
  /** Free-text multi-word named-entity rule + examples. */
  namedEntityRule: string;
  /** TTS instruction block — accent, pronunciation guide, intonation cues. */
  ttsInstructions: string;
}

export const PROMPT_FRAGMENTS: Record<string, TargetLanguagePromptFragments> = {
  Spanish: { /* current Spanish content */ },
  Hungarian: { /* TBD when we test Hungarian */ },
  // …
};

export function getPromptFragments(spec: TargetLanguageSpec): TargetLanguagePromptFragments {
  return PROMPT_FRAGMENTS[spec.language] ?? FALLBACK_NEUTRAL_FRAGMENTS;
}
```

Consumers (`aiBubblePipeline`, `correctionPipeline`, TTS route) pull the fragments off the spec and interpolate into their prompts.

### Fallback behaviour

For languages without an explicit entry, the fallback fragments should be deliberately generic:

- Articles: empty list (LLM falls back to "group articles with following noun if your target language has them" rule)
- Compound tenses: short generic rule "group multi-word verbal constructions in your target language"
- Idiom rule: "group fixed expressions and idioms"
- TTS: "speak naturally in the target language"

Quality drops for unsupported languages — but the system doesn't *break*. First production language gets a hand-tuned table; second language reveals which fragments need expanding.

### Cost

No prompt-cost change — fragments replace hardcoded strings of similar size. Tuning + verification time per new language: ~2-4 hours (writing fragments, manual A/B testing on `/playground/correct-test`, tweaking).

### Open questions

- Should fragments live keyed by `language` only, or by `language + location` (so latino-Spanish can have different idioms than castellano-Spanish)? Probably language-only for v1; locations affect register but not grammar.
- Should the prompt fragments themselves be parameterised by `nativeLanguage`? Most current examples are Spanish-only, native-language-agnostic. Keep it that way.
- `chatJSON` doesn't currently expose a way to do per-language temperature tuning. Probably never needed, but worth noting.

---

## Phase D — Per-user TargetSpec

**Not yet done.** Today, every user gets `DEFAULT_TARGET` (Castellano Spanish, everyday register). To support multiple languages on the same instance, the spec needs to live on the user record.

### Schema

Option 1 (simple, JSON):

```sql
ALTER TABLE users ADD COLUMN target_language_json TEXT NOT NULL DEFAULT '{"language":"Spanish","location":"castellano","style":"everyday"}';
```

Option 2 (normalised):

```sql
ALTER TABLE users ADD COLUMN target_language     TEXT NOT NULL DEFAULT 'Spanish';
ALTER TABLE users ADD COLUMN target_location     TEXT;
ALTER TABLE users ADD COLUMN target_style        TEXT NOT NULL DEFAULT 'everyday';
```

Probably Option 2 — easier to query, no JSON-parsing in hot paths.

### Code changes

- `lib/users.ts`: extend `User` type with `targetSpec: TargetLanguageSpec`. `getUserById()` reads + assembles.
- All call sites that currently use `DEFAULT_TARGET`: switch to reading `user.targetSpec` from the session-resolved user.
- `lib/vocabRanking.ts`, `lib/vocabSave.ts`: take `targetName` (or the full spec) as a parameter rather than importing `DEFAULT_TARGET`.
- New API endpoint `/api/me/target-language` (POST) — UI can let the user switch language. Triggers regeneration of `current_set` and `next_set` topics (since they were generated against the old language).

### Migration of existing users

Default value `Spanish` keeps existing users on Spanish. UI prompt at next login asks them to confirm: "You're learning Spanish (Castellano). Tap to change."

### UX

Settings page or onboarding flow lets the user pick language + variant + register. Could be a dropdown or a guided onboarding (3 questions). For multi-language users (rare) — defer; let them have multiple accounts for now.

### Cost

LLM calls produce slightly worse output for languages without prompt fragments tuned in Phase C, until those are added.

### Open questions

- One language per user, or multi-language? v1 single. Multi requires a `current_target_language` setting plus per-language vocab/SRS state — much bigger scope.
- What happens to a user's existing `user_vocab` if they switch from Spanish to Hungarian? Two options: (a) hide Spanish vocab, treat as new-learner-of-Hungarian; (b) keep both, filter views by current target. (a) for v1 simplicity.
- Validation: target language must be a key in `PROMPT_FRAGMENTS` (Phase C dependency). Rejecting unknown languages at the API boundary keeps prompt quality predictable.

---

## Phase E — UI branding

**Not yet done.** A handful of literal "Spanish" strings remain in user-facing UI:

| File | String |
|---|---|
| `app/layout.tsx` | App title `"Spanish Correction"`, description `"Speak Spanish — get instant corrections"` |
| `app/page.tsx:156` | `<option value="natural">Natural Spanish</option>` (correction-style dropdown) |
| `app/playground/correct-test/page.tsx:145` | "and Spanish, with errors" (placeholder copy) |
| `app/playground/vocab-live/page.tsx:113` | "most fundamental Spanish words first" (header copy) |

Changes:

- App title: rename to something language-neutral. "Language AI" (matches the project folder), "Hablar AI", or pull dynamically from the user's `targetSpec` ("Castellano Spanish — Language AI"). Decision: language-neutral default + dynamic per-page is overkill — pick one.
- Dropdown: drop "Spanish" — `<option>Natural</option>` is enough since the user already knows what target language they're learning.
- Playground copy: "and the target language, with errors"; "most fundamental words first".

Also update file/folder names if you want to be thorough — the project root is `spanish-correction-app`. Renaming a folder breaks git history less than a column rename, but is still churn. Probably not worth it — the README/MD layer can clarify.

### Cost

Trivial — pure string edits, no behaviour. ~15 min including a deploy.

### Open questions

- Should the dropdown label say "Natural Spanish" but pull `Spanish` from the user's spec? That would read "Natural Hungarian" for Hungarian users. Wording-elegant but pulls user state into a static dropdown — fiddly. v1 just say "Natural" and "Transcript-aware" and trust the user to know what target they're learning.

---

## Migration sequencing (recommended)

1. **C before D.** Per-user spec without per-language fragments means non-Spanish users get bad prompts. Build C tables for any language D will offer.
2. **D before E.** UI labels can read from the spec once D exists.
3. **E whenever** — purely cosmetic, no dependency.

Realistic build order if you want to onboard a second language (e.g. Hungarian for testing):

1. Phase C: hand-tune `Hungarian` entry in `PROMPT_FRAGMENTS`. ~2-4 hours.
2. Phase D: schema migration + `User.targetSpec` reads + UI. ~2-3 hours.
3. Manual end-to-end test: login as a Hungarian user, run correction pipeline, check output quality on `/playground/correct-test`. Tune fragments.
4. Phase E: clean up branding strings. ~15 min.

Total: half a day to a day, mostly Phase C tuning.

---

## What NOT to migrate

- Worked-example *content* (Spanish/German concrete examples) — these are demonstrations of *shape*, not language-specific rules. Keeping them concrete helps the LLM more than abstracting them.
- The `0001_baseline.sql` reference to `text_es` — historical record of the schema at that point in time. The 0004 migration renames it forward.
- JSDoc comments saying `e.g. "Spanish"` next to a parameter type — those are illustrative documentation, not hardcoded behaviour.
