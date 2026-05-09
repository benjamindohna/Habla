// The three LLM steps that turn a learner's raw transcript into a structured
// CorrectionResult: interpret → localize → segment. Lifted out of the
// individual API routes so they can be composed in /api/correct without an
// extra HTTP hop. Each function is self-contained: same input shape +
// nativeLanguage/style produces the same output.

import { chatJSON, type ChatTask } from "./llm";
import { DEFAULT_TARGET, describeTargetLanguage } from "./targetLanguage";
import type { Pair } from "@/types/correction";

export type CorrectionStyle = "natural" | "transcript_aware";

export interface Interpretation {
  intended_meaning_native: string;
  confidence: "high" | "medium" | "low";
  notes_native: string;
}

// ── interpret ────────────────────────────────────────────────────────────

export async function interpret(
  transcript: string,
  nativeLanguage: string,
): Promise<Interpretation> {
  const targetName = DEFAULT_TARGET.language;
  const systemPrompt = `You are a bilingual interpretation assistant. A language learner is trying to speak ${targetName} but may mix in their native language (${nativeLanguage}) and may have grammar mistakes or unnatural phrasing.

Read the transcript and output what the person most likely intended to say, in ${nativeLanguage}. Do not produce ${targetName} output.

CRITICAL — coverage:
- Capture the COMPLETE intent. Every clause, every idea the learner attempted to express must appear in your output, in the order they said it.
- Do NOT summarise, condense, drop redundant tags, or "clean up" the learner's intent. If they said something at the end (like "I think it's true"), include it. If they said something twice, reflect that.
- Use multiple sentences when the learner spoke in multiple clauses — do NOT force everything into one sentence.

Return ONLY valid JSON:
{
  "intended_meaning_native": "string",
  "confidence": "high | medium | low",
  "notes_native": "string"
}

- intended_meaning_native: a faithful ${nativeLanguage} version of the learner's complete intent. One or more sentences as needed.
- confidence: your confidence in the interpretation.
- notes_native: one short note in ${nativeLanguage} if uncertain; otherwise a brief summary of what the learner was expressing.`;

  return chatJSON<Interpretation>({
    task: "chat_light",
    label: "interpret",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ],
  });
}

// ── localize ─────────────────────────────────────────────────────────────

function naturalPrompt(nativeLanguage: string): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a native ${targetName} speaker. Your job is to express the given meaning in natural, ${target} as it would be spoken in casual conversation.

Rules:
- Match the variety: ${target}. Vocabulary, idioms, named entities, and register must fit this variety. Do not drift to other regions or registers.
- Preserve EVERY clause from the meaning, even short tags or seemingly redundant phrases. Use multiple sentences if needed.
- The output is in ${targetName}. The input meaning is in ${nativeLanguage}.
- Always write numbers as words, never as digits.
- End with appropriate punctuation.

Return ONLY valid JSON:
{ "local_version_es": "string" }`;
}

function transcriptAwarePrompt(nativeLanguage: string): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a ${targetName}-language correction engine for a learner.

You receive two inputs:
- TRANSCRIPT: what the learner actually said. May mix ${targetName} and ${nativeLanguage}, may have grammar errors or unnatural phrasing.
- INTENT: what they meant to say, expressed in ${nativeLanguage}.

Your job: produce one ${target} sentence (or sentences, if the learner spoke in multiple clauses) that captures the INTENT and that the learner can use as a corrected reference.

CRITICAL: Stay as close to the TRANSCRIPT as possible.
- Where the TRANSCRIPT is already correct, natural ${target}, KEEP THE LEARNER'S EXACT WORDS. Do not rewrite correct ${targetName} into synonyms or rearrange word order for stylistic reasons.
- Only change parts that are wrong, unnatural, in ${nativeLanguage}, or in the wrong ${targetName} variety.
- The goal is a corrected version, not a rewritten version. If the learner's phrasing is acceptable for ${target}, leave it alone.

Other rules:
- Match the variety: ${target}. Replace vocabulary or idioms from other regions/registers with their ${target} equivalents.
- Preserve EVERY clause from INTENT. If the learner said multiple clauses (even seemingly redundant ones, like a softener at the end), include all of them.
- Always write numbers as words, never as digits.
- End with appropriate punctuation.

Return ONLY valid JSON:
{ "local_version_es": "string" }`;
}

export async function localize(args: {
  intendedMeaning: string;
  transcript?: string;
  nativeLanguage: string;
  style: CorrectionStyle;
  /** Override the model tier. Defaults to chat_precise (gpt-4o) for
   *  production correctness. The /playground/correct-test page passes
   *  chat_light so we can A/B compare quality on the cheaper tier. */
  task?: ChatTask;
}): Promise<string> {
  const useTranscript = args.style === "transcript_aware" && args.transcript?.trim();
  const systemPrompt = useTranscript
    ? transcriptAwarePrompt(args.nativeLanguage)
    : naturalPrompt(args.nativeLanguage);
  const userContent = useTranscript
    ? `TRANSCRIPT: "${args.transcript!.trim()}"\nINTENT: "${args.intendedMeaning}"`
    : args.intendedMeaning;

  const task = args.task ?? "chat_precise";
  const result = await chatJSON<{ local_version_es?: string }>({
    task,
    label: `localize/${task}`,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  return (result.local_version_es ?? "").trim();
}

// ── segment ──────────────────────────────────────────────────────────────

/**
 * V2 prompt — used only on /playground/correct-test for now. Same task
 * as V1 but reorganised: coverage-invariants moved to the top (most
 * critical), 21 rules consolidated to ~10, six worked examples covering
 * compound-tense match / dropped clause / extra content / pure-target
 * grammar error / full native fallback / mixed-language. Compound
 * tenses are explicitly listed in the "must stay unified" rule.
 */
function segmentPromptV2(
  nativeLanguage: string,
  localVersionEs: string,
  transcript: string,
): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a sentence-alignment engine for language learning.

Your job: compare two sentences and produce ordered segment pairs showing the learner exactly which parts they got right and which differ.

The learner's native language: ${nativeLanguage}
The target language: ${target}

LOCAL:   "${localVersionEs}"      (the perfect ${target} sentence)
LEARNER: "${transcript}"          (what the learner actually said — may mix ${targetName} and ${nativeLanguage}, may have grammar errors, may be entirely in ${nativeLanguage})

═════ COVERAGE INVARIANTS (absolute, trump everything else) ═════

A. Concatenating all local_segment fields in order, joined with single spaces, MUST reconstruct LOCAL exactly (modulo whitespace and the punctuation rules below).
B. Same rule for user_segment vs LEARNER.
C. Every word from LOCAL appears in EXACTLY ONE local_segment — no drops, no duplicates.
D. Every word from LEARNER appears in EXACTLY ONE user_segment — same rule.
E. If you cannot satisfy A-D with a multi-pair alignment, return ONE pair containing all of LOCAL and all of LEARNER as a mismatch. This safe fallback is always better than dropping or duplicating words.

═════ HOW TO ALIGN ═════

1. Find pairs that are EXACT MATCHES — same word(s) in both versions, same meaning, same position. Mark with is_match: true.
   - Don't match a word just because the same letters appear elsewhere — semantic position matters.
   - Ignore trailing punctuation when deciding is_match (a comma-only difference is not a real difference).

2. Keep these UNIFIED — never split them across pairs:
   - article + noun ("el libro", "la casa")
   - compound tenses: haber + past participle (he visto, había dicho, haya impresionado), estar + gerund (está hablando), ir a + infinitive (voy a hacer), modal periphrases (tener que ir, hay que hacerlo)
   - clitic pronouns + their verb ("te haya impresionado", "se va", "me lo dijo")
   - fixed expressions / idioms ("por ejemplo", "tener ganas", "darse cuenta", "echar de menos", "sin embargo")
   - multi-word named entities ("Estados Unidos", "Real Madrid", "Gran Vía")

3. For non-matching parts:
   - Output LOCAL's content as local_segment, LEARNER's as user_segment, is_match: false.
   - If the learner DROPPED something, user_segment is "" (empty string). Do NOT merge into the next pair.
   - If the learner ADDED something the LOCAL didn't have, output a dedicated pair with local_segment "". Do NOT merge.

4. Output order = order of LOCAL (left to right).

═════ FORMATTING ═════

- Each segment field must NOT begin or end with whitespace.
- Standalone punctuation (",", ";", ":") is NEVER its own segment — attach to the preceding segment.
- The final segment ends with the sentence's closing punctuation.
- Numbers as words, never digits.
- No markdown, no commentary outside the JSON.

═════ WORKED EXAMPLES (target Spanish, learner native German) ═════

EXAMPLE 1 — mixed native fallback in user input:
LOCAL:   "Voy a un campo de fútbol con mis amigos."
LEARNER: "voy in un Fußballfeld con mi Freunde."
pairs:
  { "local_segment": "Voy a", "user_segment": "voy", "is_match": false }
  { "local_segment": "un", "user_segment": "in un", "is_match": false }
  { "local_segment": "campo de fútbol", "user_segment": "Fußballfeld", "is_match": false }
  { "local_segment": "con", "user_segment": "con", "is_match": true }
  { "local_segment": "mis amigos.", "user_segment": "mi Freunde.", "is_match": false }

EXAMPLE 2 — pure target, wrong verb conjugation:
LOCAL:   "Yo voy a la playa."
LEARNER: "Yo va a la playa."
pairs:
  { "local_segment": "Yo", "user_segment": "Yo", "is_match": true }
  { "local_segment": "voy", "user_segment": "va", "is_match": false }
  { "local_segment": "a la playa.", "user_segment": "a la playa.", "is_match": true }

EXAMPLE 3 — compound tense matched as ONE pair:
LOCAL:   "Ya he visto la película."
LEARNER: "Ya he visto la película."
pairs:
  { "local_segment": "Ya", "user_segment": "Ya", "is_match": true }
  { "local_segment": "he visto", "user_segment": "he visto", "is_match": true }
  { "local_segment": "la película.", "user_segment": "la película.", "is_match": true }

EXAMPLE 4 — learner dropped a whole clause:
LOCAL:   "Quiero ir al cine, pero estoy cansado."
LEARNER: "Quiero ir al cine."
pairs:
  { "local_segment": "Quiero", "user_segment": "Quiero", "is_match": true }
  { "local_segment": "ir al cine", "user_segment": "ir al cine.", "is_match": true }
  { "local_segment": ", pero estoy cansado.", "user_segment": "", "is_match": false }

EXAMPLE 5 — learner added something extra:
LOCAL:   "Me gusta el café."
LEARNER: "Me gusta mucho el café."
pairs:
  { "local_segment": "Me gusta", "user_segment": "Me gusta", "is_match": true }
  { "local_segment": "", "user_segment": "mucho", "is_match": false }
  { "local_segment": "el café.", "user_segment": "el café.", "is_match": true }

EXAMPLE 6 — learner spoke entirely in native language:
LOCAL:   "Me llamo Carlos y soy de Madrid."
LEARNER: "Ich heiße Carlos und komme aus Madrid."
pairs:
  { "local_segment": "Me llamo Carlos y soy de Madrid.", "user_segment": "Ich heiße Carlos und komme aus Madrid.", "is_match": false }

═════ OUTPUT ═════

Return ONLY valid JSON:
{
  "pairs": [
    { "local_segment": "string", "user_segment": "string", "is_match": true }
  ]
}`;
}

function segmentPrompt(nativeLanguage: string, localVersionEs: string, transcript: string): string {
  const target = describeTargetLanguage(DEFAULT_TARGET);
  const targetName = DEFAULT_TARGET.language;
  return `You are a sentence-alignment engine for language learning.

The learner's native language is: ${nativeLanguage}
The target language is: ${target}

You are given two sentences:
- LOCAL: the perfect natural ${target} sentence (the target)
- LEARNER: what the learner actually said (may mix ${targetName} and ${nativeLanguage}, may have grammar errors)

Your job is to compare these two sentences and produce an ordered list of segment pairs that shows the learner exactly which parts they got right and which parts differ.

LOCAL:   "${localVersionEs}"
LEARNER: "${transcript}"

Alignment rules:

1. Compare the LOCAL and LEARNER sentences very carefully.
2. First identify exact matches that are not only lexically identical, but also correspond to the same meaning, function, and position in the sentence.
3. A word or short stretch should be treated as a matched pair only if:
   - it is exactly present in both versions,
   - it refers to the same part of the meaning,
   - it belongs to the same concept or sentence role in both versions,
   - and showing it separately would help the learner.
4. Do NOT match a word just because the same surface form appears somewhere else in the sentence.
5. Before marking any word as a match, check that it belongs to the same semantic slot or sentence region in both versions.
6. Prefer separating small correct learner parts as matched pairs whenever they are truly aligned in meaning and position.
7. Do NOT split apart clearly unified segments such as:
   - article + noun units,
   - fixed expressions,
   - strongly bound collocations,
   - compact grammatical units that are best learned together.
8. If only one word is wrong and the surrounding words are correctly aligned, isolate the correct surrounding words as matched pairs and isolate the wrong word as a mismatch pair.
9. If a larger learner phrase is wrong as one unit, keep it together as one mismatch segment.
10. After identifying true matches, treat them as neutral/correct and exclude them from the mismatch analysis.
11. Then segment the remaining non-matching parts as precisely as possible.
12. Prefer the smallest learner-visible segments that remain semantically honest and pedagogically clear.
13. For each remaining learner mismatch segment, find the corresponding segment in the LOCAL version.
14. Output all segment pairs in the order of the LOCAL sentence, not the learner's original order.
15. In each pair, always put:
    - first: the local target-language segment
    - second: the corresponding learner segment
16. If something was already exactly correct and truly aligned, it may appear as a neutral matched pair.
17. If something is missing in the learner version, use an empty string for user_segment.
18. If the learner said something extra that does not belong in the local version, create a dedicated pair with empty local_segment for that extra fragment. Do NOT attach extras to a neighbouring pair.
19. Prefer pedagogical usefulness over mechanical diffing.
20. Commas and inline punctuation (,  ;  :) must NEVER appear as standalone segments. Always attach them to the segment that immediately precedes them. A segment whose entire content is punctuation is always wrong.
21. When deciding is_match, ignore trailing punctuation entirely. If two segments are identical except that one has a trailing comma and the other does not, they are a match. Punctuation differences alone must never cause a mismatch.

Matching examples (learner language: German):
- Learner: "con mi Freunde" / LOCAL: "con mis amigos" → "con" matched, "mis amigos" vs "mi Freunde" mismatch
- Learner: "in un Fußballfeld" / LOCAL: "en un campo de fútbol" → "en un" matched (if truly aligned), "campo de fútbol" vs "Fußballfeld" mismatch
- Learner: "y el Schiedsrichter fue muy fair" / LOCAL: "y el árbitro fue muy justo" → "y" matched, "el árbitro" vs "el Schiedsrichter" mismatch, "fue muy" matched, "justo" vs "fair" mismatch

Rules for is_match:
- is_match must be true only if the learner segment and the local segment are exactly the same in wording.
- Prefer marking independently correct words or short stretches as is_match true whenever possible.
- Do not mark a tiny subpart as is_match true if doing so would break apart a clearly unified phrase.

Very important — coverage invariants (these are absolute):
- The concatenation of all local_segment fields, in pair order, joined with single spaces, must reconstruct LOCAL exactly (modulo whitespace and the punctuation rules above).
- The concatenation of all user_segment fields, in pair order, joined with single spaces, must reconstruct LEARNER exactly (modulo whitespace).
- Every word from LEARNER appears in exactly ONE user_segment. No word may be duplicated, dropped, or reassigned.
- Every word from LOCAL appears in exactly ONE local_segment. Same rule.
- If you cannot satisfy these invariants with a multi-pair alignment, prefer a single mismatch pair containing all of LOCAL and all of LEARNER over an alignment that drops or duplicates any word.

Other formatting:
- Each segment's local_segment and user_segment must NOT begin with a space and must NOT end with a space.
- The final segment in the pairs list must end with the sentence's closing punctuation.
- Always write numbers as words, never as digits.
- Do not output markdown.
- Do not output explanations outside the JSON.

Return ONLY valid JSON:
{
  "pairs": [
    {
      "local_segment": "string",
      "user_segment": "string",
      "is_match": true
    }
  ]
}`;
}

/**
 * Pass 1 — absorb any standalone-punctuation pair (local_segment is only
 *           commas / colons / semicolons) into the preceding pair.
 * Pass 2 — pairs that differ only by trailing punctuation are re-marked
 *           as matches, because the learner cannot be expected to say
 *           punctuation when speaking.
 */
export function normalizePairs(pairs: Pair[]): Pair[] {
  const isPuncOnly = (s: string) => /^[,;:]+$/.test(s.trim());
  const stripTrailing = (s: string) => s.trim().replace(/[,;:.!?¿¡]+$/, "").trimEnd();

  const merged: Pair[] = [];
  for (const pair of pairs) {
    if (isPuncOnly(pair.local_segment) && merged.length > 0) {
      const prev = merged[merged.length - 1];
      merged[merged.length - 1] = {
        local_segment: prev.local_segment + pair.local_segment,
        user_segment: prev.user_segment + pair.user_segment,
        is_match: prev.is_match,
      };
    } else {
      merged.push({ ...pair });
    }
  }

  return merged.map((pair) => {
    if (pair.is_match) return pair;
    const localCore = stripTrailing(pair.local_segment).toLowerCase();
    const userCore = stripTrailing(pair.user_segment).toLowerCase();
    if (localCore.length > 0 && localCore === userCore) {
      return { ...pair, is_match: true };
    }
    return pair;
  });
}

function warnIfCoverageBroken(pairs: Pair[], transcript: string, localVersionEs: string) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,;:!?¿¡"'()]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const joinedUser = norm(pairs.map((p) => p.user_segment).join(" "));
  const joinedLocal = norm(pairs.map((p) => p.local_segment).join(" "));
  const expectedUser = norm(transcript);
  const expectedLocal = norm(localVersionEs);

  if (joinedUser !== expectedUser) {
    console.warn(
      "[segment] coverage break (user):",
      JSON.stringify({ expected: expectedUser, got: joinedUser }),
    );
  }
  if (joinedLocal !== expectedLocal) {
    console.warn(
      "[segment] coverage break (local):",
      JSON.stringify({ expected: expectedLocal, got: joinedLocal }),
    );
  }
}

export async function segment(args: {
  transcript: string;
  localVersionEs: string;
  nativeLanguage: string;
  /** Override the model tier. Production default is chat_light
   *  (gpt-4o-mini): empirically mini does BETTER segmentation than 4o
   *  on this prompt — 4o tends to over-merge correct user parts into
   *  mismatch segments. The /playground/correct-test page can flip
   *  to chat_precise via the toggle. */
  task?: ChatTask;
  /** Production default is V2 (consolidated rules + 6 worked examples
   *  + explicit compound-tense rule). V1 stays available via the
   *  playground toggle for comparison. */
  improvedPrompt?: boolean;
}): Promise<Pair[]> {
  const task = args.task ?? "chat_light";
  const useV2 = args.improvedPrompt !== false; // default V2; only false explicitly disables
  const buildPrompt = useV2 ? segmentPromptV2 : segmentPrompt;
  const { pairs } = await chatJSON<{ pairs: Pair[] }>({
    task,
    label: `segment/${task}${useV2 ? "/v2" : ""}`,
    userPrompt: buildPrompt(args.nativeLanguage, args.localVersionEs, args.transcript),
  });
  const normalized = normalizePairs(pairs);
  warnIfCoverageBroken(normalized, args.transcript, args.localVersionEs);
  return normalized;
}
