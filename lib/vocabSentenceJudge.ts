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
//
// Sense-handling: the judge accepts ANY well-known sense of the target
// word. This mirrors the explain prompt, which now teaches the word's
// full meaning space (primary + synonyms + other senses). A learner
// who uses "banco" as either bank or bench is credited — both are
// legitimate uses of the word they've been shown. The judge no longer
// returns X for polysemy mismatch; X is reserved for the rare case
// where the word is verbatim but the sentence anchors no recognized
// sense at all (typically collapses into 0 / TOO GENERIC).

import { chatText } from "./llm";
import type { TargetLanguageSpec } from "./targetLanguage";
import type { VocabJudgement } from "./vocab";

export interface SentenceJudgeArgs {
  /** The target-language word as shown on the card (preserved casing
   *  and form — must appear verbatim in the user's sentence). */
  target_word: string;
  /** The full sentence the learner typed. */
  user_sentence: string;
  /** e.g. "Spanish". */
  targetLanguage: TargetLanguageSpec;
  /** e.g. "German". */
  native_language: string;
}

/**
 * Decide whether the learner's sentence demonstrates real understanding
 * of the target word — in ANY of its common senses.
 *
 * Two requirements both must hold for a "1":
 *  - Word verbatim: the target word appears in the sentence in the
 *    exact same form (case-insensitive, diacritics required; article-
 *    tolerant for nouns). Lemmatised / inflected forms do NOT satisfy.
 *  - Semantic anchoring: the surrounding sentence must give context
 *    that requires SOME well-known sense of the word. A generic
 *    sentence that would work with any word in the same slot → 0.
 *
 * Lenient on: grammar errors elsewhere, native-language fillers,
 * awkward phrasing, punctuation, capitalisation. The point of this
 * mode is whether the user can DEPLOY the word, not whether they
 * write a grammatically perfect sentence.
 */
export async function judgeVocabSentence(args: SentenceJudgeArgs): Promise<VocabJudgement> {
  const prompt = `You are evaluating a vocabulary PRODUCTION exercise. The learner is studying ${args.targetLanguage.language}; their native language is ${args.native_language}.

The learner was shown the word "${args.target_word}" and asked to produce a sentence that uses this word and demonstrates they understand its meaning. Any well-known sense of the word counts — the learner has been taught the word's full meaning space (primary translation + synonyms + other senses), so don't penalise for using a different recognised sense than the one originally tagged.

You are testing ONE thing: does the learner know what THIS word means, in any of its common senses? Not grammar. Not fluency. Not whether the rest of the sentence is in the right language.

═════ DO NOT FAIL THE LEARNER FOR ANY OF THESE ═════

These are EXPECTED at the learner's level and are NEVER fail signals:
- Grammar errors anywhere except on the target word itself: missing articles, wrong gender, wrong subject-verb agreement, wrong conjugation of OTHER words, missing prepositions, wrong word order.
- ${args.native_language} words mixed in. The learner falls back to their native language for words they don't yet know in ${args.targetLanguage.language}. This is the norm at every level below near-native. A sentence can be 80% ${args.native_language} and still be valid if the target word is correctly used in context.
- Awkward phrasing, run-on sentences, missing punctuation, weird capitalisation.
- Very short sentences (one clause), as long as the clause anchors the meaning.
- Using a DIFFERENT well-known sense than the most common one (polysemy is fine — e.g. "banco" as bench when bank is more common, "vela" as sail when candle is more common).

Focus only on the target word. Everything else can be ugly.

═════ DECISION TREE ═════

Step 1 — Does the target word appear in the sentence with the same LEXICAL CORE?
  - Comparison is case-insensitive but diacritics required.
  - ARTICLE-TOLERANT for nouns: if the target word starts with an article (Spanish el/la/los/las/un/una/unos/unas; equivalent determiners in other languages), that article is OPTIONAL in the learner's sentence — and the learner may use any article (different gender, indefinite vs definite) without penalty. The lexical core is the noun itself; article mismatches do NOT make the form wrong. Likewise, if the target word has NO article, the learner may freely add one. What matters is the noun stem.
  - For non-noun targets (verbs, adjectives, fixed phrases, multi-word segments), require the exact form (case-insensitive, diacritics required). Verb / adjective inflections that differ from the target → return 0.
  - If the word is absent entirely, or appears only in a different inflected/lemmatised form (e.g. infinitive when conjugated form was asked) → return 0.
  - Otherwise → go to Step 2.

Step 2 — Look at the sentence around the word. Does it anchor a recognised sense of the word?
  - The sentence makes the word's meaning clear in SOME well-known sense → return 1.
  - Sense is unclear / generic / would fit any word in that slot → return 0.

═════ VERDICTS ═════
- 1  word verbatim AND sentence anchors any recognised sense
- 0  word missing / wrong form, OR sentence is generic / empty / placeholder

(X is reserved and rarely used — see note at top. Default to 0 when in doubt; the learner can retry.)

═════ WORKED EXAMPLES (illustrative — Spanish target, German native; rules apply to any language pair) ═════

Tested word: "comió"
  "Mi hermana comió pizza ayer."          → 1   (specific food + past time anchor)
  "El perro se comió las galletas."       → 1   (food + agent — eating clear; reflexive "se" OK)
  "Mein Hund hat eine pizza comió."       → 1   (mostly German + grammar errors + native word "pizza", but "comió" is verbatim AND the eating-food context is clear)
  "Ayer ich comió zwei Brötchen."         → 1   (German subject + German object, but "comió" verbatim + clear eating context)
  "Él comió."                              → 0   (no anchor — could be any past-tense verb)
  "Comió mucho."                           → 0   (no specific food/context — too generic)
  "Mi hermana come pizza ayer."            → 0   (form wrong: "come" not "comió")
  "Yo comer pizza."                        → 0   (form wrong: bare infinitive, not "comió")
  ""                                        → 0   (empty)

Tested word: "verbessern"
  "Ich möchte mein Spanisch verbessern."   → 1   (specific object — Spanish — anchors meaning)
  "Wir können das System verbessern."       → 1   (clear object of improvement)
  "Ich will mi habilidades verbessern."     → 1   (Spanish/German mix + grammar errors, but "verbessern" verbatim + concrete object "habilidades" anchors improvement sense)
  "Er möchte sich verbessern."              → 0   (generic — could fit any reflexive verb of self-change)
  "Das Team will verbessern."               → 0   (no object, no specific anchor)
  "Verbessern ist gut."                     → 0   (statement about the verb itself, no application)

Tested word: "banco" (polysemous: bank / bench — both accepted)
  "Me senté en el banco del parque."       → 1   (bench sense anchored by sitting + park)
  "Voy al banco a sacar dinero."           → 1   (bank sense anchored by withdrawing money)
  "El cajero del banco fue muy amable."    → 1   (bank sense via cashier)
  "El perro estaba durmiendo en el banco." → 1   (bench sense via dog sleeping on it)
  "Ich saß auf el banco im Park."          → 1   (mostly German, but bench sense anchored)
  "El banco es grande."                     → 0   (generic — no anchor for either sense)

Tested word: "vela" (polysemous: candle / sail — both accepted)
  "Encendí una vela en la mesa."           → 1   (candle sense — lit + table)
  "La vela del barco se rompió con el viento." → 1   (sail sense — boat + wind)
  "La vela es bonita."                      → 0   (generic — neither sense anchored)

Tested word: "el buceo" (article-tolerant)
  "Quiero practicar el buceo en el agua."   → 1   (verbatim with article)
  "Quiero practicar buceo en el agua."      → 1   (article omitted — accept; article-tolerant)
  "Voy a hacer un buceo profundo en Tailandia." → 1   (different article — accept; "un" instead of "el")
  "Yo bucear en el mar."                     → 0   (verb form "bucear", not the noun "buceo")
  "Me gusta el deporte."                     → 0   (word absent)

Tested word: "paz"
  "Después del yoga siento mucha paz."      → 1   (anchor: yoga → inner peace)
  "Me gusta la paz interior."                → 1   (article added — accept; target had no article)
  "Después de la guerra hubo paz."           → 1   (war-vs-peace anchor — equally valid sense)
  "Me gusta el paz, no me gusta Krieg."      → 1   (wrong-gender article "el" — accept; lexical core "paz" present, peace-vs-war anchor)
  "No me gusta la guerra."                   → 0   (paz absent)

Tested word: "haya impresionado"
  "Quizás te haya impresionado el partido." → 1   (subjunctive trigger "quizás", meaningful object)
  "Espero que les haya impresionado."        → 1   (subjunctive trigger "espero que", object pronoun)
  "Hoffe que the movie le haya impresionado." → 1  (German + English mix, but "haya impresionado" verbatim + clear "movie impressed him" context)
  "Haya impresionado."                       → 0   (no anchor)

═════ NOW EVALUATE ═════

Tested word: "${args.target_word}"
Learner's sentence: "${args.user_sentence}"

Reply with exactly one character: 1 or 0. No explanation, no punctuation, no quotes.`;

  const raw = await chatText({
    task: "chat_light",
    label: "vocab/judge-sentence",
    systemPrompt: prompt,
    temperature: 0,
    maxTokens: 5,
  });

  // Same conservative parse as judgeVocabAnswer: extract the first
  // 1, X, or 0 in the output. Default "0" if none found — better to
  // under-credit (user re-encounters the card) than over-credit. X
  // is preserved in the type for symmetry with recognition mode but
  // the new sentence-judge prompt only ever returns 1 or 0.
  const match = raw.match(/[1X0]/);
  return (match ? match[0] : "0") as VocabJudgement;
}

export interface SentenceMistakeArgs {
  target_word: string;
  /** Native-language translation of the target word (from explain cache).
   *  May be empty when the cache hasn't been populated yet. */
  native_translation: string;
  user_sentence: string;
  targetLanguage: TargetLanguageSpec;
  native_language: string;
}

/**
 * After judgeVocabSentence returns 0, produce a short native-language
 * explanation of what went wrong WITH RESPECT TO THE TARGET WORD ONLY.
 * The explainer is briefed on the same rubric the judge used so its
 * diagnosis stays consistent: word missing / wrong form / generic
 * sentence. Grammar errors elsewhere are off-limits as topics — those
 * are not failure reasons per the judge prompt.
 */
export async function explainSentenceMistake(args: SentenceMistakeArgs): Promise<string> {
  const prompt = `You are a ${args.targetLanguage.language} vocabulary tutor giving feedback to a ${args.native_language}-native learner.

A judge has marked their sentence as INCORRECT for one specific word. Your job: explain in 1–2 short ${args.native_language} sentences what they did wrong WITH RESPECT TO THE TARGET WORD ONLY.

═════ THE RUBRIC THE JUDGE USED ═════

A sentence fails (verdict 0) for exactly one of these reasons:
1. WORD MISSING: the target word doesn't appear in the sentence at all.
2. WRONG FORM: the target word appears in a different inflected / lemmatised form (e.g. "comer" when "comió" was asked; "el paz" when "paz" was asked — i.e. wrong gender attached as article on a non-article-tolerant target).
3. TOO GENERIC: the word appears verbatim, but the sentence around it is so generic that no recognised meaning is anchored — replacing the word with a placeholder would still parse meaningfully ("Er hat sich X"), or the sentence neither points to any well-known sense of the word.

NOT failure reasons (do NOT mention these as the problem):
- Grammar errors anywhere else in the sentence.
- ${args.native_language} words mixed in.
- Awkward phrasing, missing punctuation, capitalisation.
- Using a different well-known sense than the most common one (polysemy is fine).

═════ INSTRUCTIONS ═════

Pick whichever failure mode best fits the learner's sentence and give a 1–2 sentence ${args.native_language} explanation. Be concrete and specific to THIS sentence — quote the actual word form they used if relevant. Stay friendly and brief. No preamble like "Du hast...". Reply in ${args.native_language} only.

═════ EXAMPLES (Spanish target, German native — same logic applies to any pair) ═════

Target: "comió" · Translation: "(er/sie) aß"
Sentence: "yo comer pizza."
→ Du hast die Form "comer" benutzt — das ist der Infinitiv. Gefragt war "comió", die Vergangenheit für er/sie.

Target: "verbessern" · Translation: "verbessern; Synonyme: besser machen"
Sentence: "Er möchte sich verbessern."
→ Dein Satz ist zu allgemein — "sich verbessern" passt zu fast jeder Selbstverbesserung. Zeig konkret, WAS verbessert wird (Sprache, System, Note…).

Target: "el buceo" · Translation: "das Tauchen"
Sentence: "me gusta el deporte."
→ Du hast das Wort "el buceo" gar nicht in deinem Satz verwendet.

Target: "paz" · Translation: "die Ruhe / der Frieden"
Sentence: "el paz es bueno."
→ Dein Satz ist zu allgemein — "el paz es bueno" sagt nichts darüber, was du mit "paz" meinst. Bring einen Kontext (Yoga, nach dem Krieg, innere Ruhe…).

═════ NOW EVALUATE ═════

Target word: "${args.target_word}"
${args.native_translation ? `${args.native_language} translation: "${args.native_translation}"` : ""}
Learner's sentence: "${args.user_sentence}"

Reply with 1–2 short sentences in ${args.native_language}. No bullet points, no quotes around your reply, no preamble.`;

  const raw = await chatText({
    task: "chat_light",
    label: "vocab/sentence-mistake",
    systemPrompt: prompt,
    temperature: 0.3,
    maxTokens: 120,
  });
  return raw.trim();
}
