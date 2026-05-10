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

You are testing ONE thing: does the learner know what THIS sense of the word means? Not grammar. Not fluency. Not whether the rest of the sentence is in the right language.

═════ DO NOT FAIL THE LEARNER FOR ANY OF THESE ═════

These are EXPECTED at the learner's level and are NEVER fail signals:
- Grammar errors anywhere except on the target word itself: missing articles, wrong gender, wrong subject-verb agreement, wrong conjugation of OTHER words, missing prepositions, wrong word order.
- ${args.native_language} words mixed in. The learner falls back to their native language for words they don't yet know in ${args.target_language}. This is the norm at every level below near-native. A sentence can be 80% ${args.native_language} and still be valid if the target word is correctly used in context.
- Awkward phrasing, run-on sentences, missing punctuation, weird capitalisation.
- Very short sentences (one clause), as long as the clause anchors the meaning.

Focus only on the target word. Everything else can be ugly.

═════ DECISION TREE ═════

Step 1 — Does "${args.target_word}" appear in the sentence in EXACTLY the same form (case-insensitive, diacritics required)?
  - No, or in a different inflected/lemmatised form → return 0.
  - Yes → go to Step 2.

Step 2 — Look at the sentence around the word. Which sense of the word does it require?
  - The TESTED sense → go to Step 3.
  - A DIFFERENT, well-known sense of the same word (polysemy) → return X. The learner clearly knows the word in SOME sense, just not the tested one; they deserve a retry, not a fail.
  - Sense is unclear / generic / would fit any word in that slot → return 0.

Step 3 — Does the sentence give specific semantic context that requires the tested sense?
  Mental test: replace the target word with a placeholder. If the sentence still parses meaningfully ("Er hat sich X"), the original was generic → 0.
  If replacing makes it nonsensical or much vaguer, the original demonstrated understanding → 1.

═════ VERDICTS ═════
- 1  word verbatim, anchors the TESTED sense
- X  word verbatim, anchors a DIFFERENT well-known sense of the same word
- 0  word missing / wrong form, OR sentence is generic / empty / placeholder

X is for polysemy mismatch only. It rewards "you know the word, just the wrong meaning." Use it whenever the learner's sentence makes coherent sense — just for a different sense of the same word.

═════ WORKED EXAMPLES (illustrative — Spanish target, German native; rules apply to any language pair) ═════

Tested word: "comió" — sense: "ate (3rd person, simple past)"
  "Mi hermana comió pizza ayer."          → 1   (specific food + past time anchor)
  "El perro se comió las galletas."       → 1   (food + agent — bench sense clear; reflexive "se" OK)
  "Mein Hund hat eine pizza comió."       → 1   (mostly German + grammar errors + native word "pizza", but "comió" is verbatim AND the eating-food context is clear)
  "Ayer ich comió zwei Brötchen."         → 1   (German subject + German object, but "comió" verbatim + clear eating context)
  "Él comió."                              → 0   (no anchor — could be any past-tense verb)
  "Comió mucho."                           → 0   (no specific food/context — too generic)
  "Mi hermana come pizza ayer."            → 0   (form wrong: "come" not "comió")
  "Yo comer pizza."                        → 0   (form wrong: bare infinitive, not "comió")
  ""                                        → 0   (empty)

Tested word: "verbessern" — sense: "to improve / make better"
  "Ich möchte mein Spanisch verbessern."   → 1   (specific object — Spanish — anchors meaning)
  "Wir können das System verbessern."       → 1   (clear object of improvement)
  "Ich will mi habilidades verbessern."     → 1   (Spanish/German mix + grammar errors, but "verbessern" verbatim + concrete object "habilidades" anchors improvement sense)
  "Er möchte sich verbessern."              → 0   (generic — could fit any reflexive verb of self-change)
  "Das Team will verbessern."               → 0   (no object, no specific anchor)
  "Verbessern ist gut."                     → 0   (statement about the verb itself, no application)

Tested word: "banco" — sense: "long bench to sit on"
  "Me senté en el banco del parque."       → 1   (location + sitting verb — bench sense clear)
  "Ich saß auf el banco im Park."          → 1   (mostly German, but "banco" verbatim + sitting/park anchors bench-sense)
  "Voy al banco a sacar dinero."           → X   (verbatim, but anchors FINANCIAL-bank sense, not bench)
  "El cajero del banco fue muy amable."    → X   (cashier of the bank — clearly financial sense)
  "El banco es grande."                     → 0   (generic — could be either sense)

Tested word: "banco" — sense: "financial institution / bank where you deposit money"
  "Voy al banco a sacar dinero."           → 1   (financial sense clear)
  "Pagué la hipoteca en el banco."         → 1   (mortgage payment — clear financial context)
  "Me senté en el banco del parque."       → X   (verbatim, but anchors BENCH-sense, not financial)
  "El perro estaba durmiendo en el banco." → X   (dog sleeping ON the bench — bench-sense, not financial)
  "El banco está cerrado."                  → 0   (generic — both senses can be "closed")

Tested word: "haya impresionado" — sense: "has impressed (subjunctive perfect)"
  "Quizás te haya impresionado el partido." → 1   (subjunctive trigger "quizás", meaningful object)
  "Espero que les haya impresionado."        → 1   (subjunctive trigger "espero que", object pronoun)
  "Hoffe que the movie le haya impresionado." → 1  (German + English mix, but "haya impresionado" verbatim + clear "movie impressed him" context)
  "Haya impresionado."                       → 0   (no anchor)

═════ NOW EVALUATE ═════

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
