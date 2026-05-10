// Production-mode judge — evaluates a sentence the learner produced.
// Distinct from judgeVocabAnswer (recognition mode) because the input
// shape and pedagogical signal are different:
//   recognition: user types a native-language translation
//   production:  user types a target-language sentence using the word
//
// The verdict shape is identical (1 / X / 0) so commit + state-update
// stay in lockstep with the recognition path. SRS state is shared
// between the two modes — a successful test in either mode advances
// the same stage.

import { chatText } from "./llm";
import type { VocabJudgement } from "./vocab";

export interface SentenceJudgeArgs {
  /** The target-language word as shown on the card (preserved casing
   *  and form — must appear verbatim in the user's sentence). */
  target_word: string;
  /** The English sense-key for the row being tested. */
  tested_description: string;
  /** The full sentence the learner typed. */
  user_sentence: string;
  /** e.g. "Spanish". */
  target_language: string;
  /** e.g. "German". */
  native_language: string;
}

/**
 * Decide whether the learner's sentence demonstrates real understanding
 * of the target word.
 *
 * Two requirements both must hold for a "1":
 *  - Word verbatim: the target word appears in the sentence in the
 *    exact same form (case-insensitive). Lemmatised / inflected forms
 *    do NOT satisfy. If absent or different form → 0.
 *  - Semantic anchoring: the surrounding sentence must give context
 *    that REQUIRES the word's tested sense. A generic sentence that
 *    would work with any other word in the same slot → 0 even if the
 *    word is verbatim.
 *
 * X handles polysemy: word verbatim but used in a different sense than
 * the tested one (e.g. "banco" used as financial-bank when the tested
 * sense is bench). The frontend uses X for the same three-strikes
 * retry pattern as recognition mode.
 *
 * Lenient on: grammar errors elsewhere, native-language fillers,
 * awkward phrasing, punctuation, capitalisation. The point of this
 * mode is whether the user can DEPLOY the word, not whether they
 * write a grammatically perfect sentence.
 */
export async function judgeVocabSentence(args: SentenceJudgeArgs): Promise<VocabJudgement> {
  const prompt = `You are evaluating a vocabulary PRODUCTION exercise. The learner is studying ${args.target_language}; their native language is ${args.native_language}.

The learner was shown the word "${args.target_word}" (sense: "${args.tested_description}") and asked to produce a sentence that uses this word and demonstrates they understand its meaning.

Decide whether the learner has DEMONSTRATED UNDERSTANDING.

Two requirements, BOTH must hold for "1":

REQUIREMENT 1 — Word present verbatim
- "${args.target_word}" must appear in the sentence in the EXACT same form (case-insensitive only — diacritics required).
- Lemmatised or inflected variants do NOT satisfy. If the card is "comió", the user must use "comió"; "come" / "comer" / "comieron" → 0.
- If a word with the same spelling appears but in a clearly different sense than tested → X.

REQUIREMENT 2 — Sentence demonstrates understanding
- The surrounding context must REQUIRE the word's tested sense.
- A sentence so generic that any other word would slot into the same position equally well does NOT demonstrate understanding → 0.
- Heuristic: mentally replace the target word with a placeholder ("X"). If the sentence still parses meaningfully ("Er hat sich X"), the original was generic. If replacement makes the sentence nonsensical or much vaguer, the original demonstrates understanding.

Be LENIENT on:
- Grammar errors anywhere EXCEPT on the target word itself (subject-verb agreement, articles, gender, conjugation of OTHER words, word order, prepositions).
- ${args.native_language} words mixed in for vocabulary the learner doesn't know.
- Awkward phrasing, missing punctuation, missing capitalisation.
- Sentences that are short — one clause is fine, as long as it gives semantic anchor.

Be STRICT on:
- Word missing or in a different form → 0.
- Empty / single-word answer → 0.
- Sentence that just plops the word into a slot without demanding its meaning → 0.

Output exactly ONE character:
- 1  word verbatim, used in the tested sense, sentence demonstrates understanding
- X  word verbatim, but the sentence uses it in a DIFFERENT (sister) sense than tested
- 0  word missing / wrong form / different word, OR sentence is generic / empty / placeholder

Examples (illustrative — Spanish target, German native; rules apply to any language pair):

Tested word: "comió" — sense: "ate (3rd person, simple past)"
  "Mi hermana comió pizza ayer."          → 1   (specific food + past time anchor)
  "El perro se comió las galletas."       → 1   (food + agent — meaning clear; reflexive "se" OK)
  "Él comió."                              → 0   (no anchor — could be any past-tense verb)
  "Mi hermana come pizza ayer."            → 0   (form wrong: "come" not "comió")
  "Comió mucho."                           → 0   (no specific food/context — too generic)
  ""                                        → 0   (empty)
  "Yo comer pizza."                        → 0   (form wrong: bare infinitive, not "comió")

Tested word: "verbessern" — sense: "to improve / make better"
  "Ich möchte mein Spanisch verbessern."   → 1   (specific object — Spanish — anchors the meaning)
  "Wir können das System verbessern."       → 1   (clear object of improvement)
  "Er möchte sich verbessern."              → 0   (generic — could fit any reflexive verb of self-change)
  "Das Team will verbessern."               → 0   (no object, no specific anchor)
  "Verbessern ist gut."                     → 0   (statement about the verb itself, no application)

Tested word: "banco" — sense: "long bench to sit on"
  "Me senté en el banco del parque."       → 1   (location + sitting verb — bench sense clear)
  "Voy al banco a sacar dinero."           → X   (verbatim, but financial-bank sense, not bench)
  "El banco es grande."                     → 0   (generic — could be either sense)

Tested word: "haya impresionado" — sense: "has impressed (subjunctive perfect)"
  "Quizás te haya impresionado el partido." → 1   (subjunctive trigger "quizás", meaningful object)
  "Espero que les haya impresionado."        → 1   (subjunctive trigger "espero que", object pronoun)
  "Haya impresionado."                       → 0   (no anchor)

Now evaluate.

Tested word: "${args.target_word}"
Sense being tested: "${args.tested_description}"
Learner's sentence: "${args.user_sentence}"

Reply with exactly one character: 1, X, or 0. No explanation, no punctuation, no quotes.`;

  const raw = await chatText({
    task: "chat_light",
    label: "vocab/judge-sentence",
    systemPrompt: prompt,
    temperature: 0,
    maxTokens: 5,
  });

  // Same conservative parse as judgeVocabAnswer: extract the first
  // 1, X, or 0 in the output. Default "0" if none found — better to
  // under-credit (user re-encounters the card) than over-credit.
  const match = raw.match(/[1X0]/);
  return (match ? match[0] : "0") as VocabJudgement;
}
