// 20 proficiency ranges over a 1-100 scale, roughly aligned to CEFR.
//
// Each range has:
//   - cefr:        CEFR anchor — the LLM uses this as a strong prior
//                  from its training data
//   - short:       3-5 word label for compact reference
//   - description: 2-4 sentences describing concrete abilities at this
//                  level — what they can produce, what they understand,
//                  which grammar features are in their grasp
//   - examples:    2-3 short target-language utterances representative
//                  of speech AT this level
//
// Adjacent ranges (5 points apart) are intentionally distinct on at
// least one concrete dimension — added tense, added connector class,
// added vocabulary band, added register — so the prompt-injected
// description carries real signal for the LLM to target.
//
// Used only in chat prompts (generateAIOpener, /api/converse/start,
// /api/converse/turn) to shape AI message complexity. Not used in
// localize, segment, explain, or topic generation — those stay
// level-agnostic for now.

export interface LevelRange {
  /** Inclusive lower bound on the 1-100 scale. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** CEFR anchor. The LLM has strong priors on CEFR descriptors. */
  cefr: string;
  /** 3-5 word handle. */
  short: string;
  /** Description of concrete abilities at this level. */
  description: string;
  /** Representative utterances at this level. */
  examples: string[];
}

export const LEVEL_RANGES: LevelRange[] = [
  {
    min: 1, max: 5,
    cefr: "Pre-A1", short: "absolute beginner",
    description:
      "Knows fewer than 50 target-language words, mostly cognates and survival phrases. Cannot form real sentences; relies on isolated words, gestures, and rote-memorised formulas. Comprehension is limited to slow, clear speech using only the most common words.",
    examples: ["Hola.", "Gracias.", "Me llamo Ben."],
  },
  {
    min: 6, max: 10,
    cefr: "A1 early", short: "very basic A1",
    description:
      "About 100-300 words. Forms simple 3-5 word sentences in the present indicative only, mostly SVO. Can introduce themselves, name common objects, ask for basic items. No past or future tenses yet. Pronoun use is shaky.",
    examples: [
      "Yo soy estudiante.",
      "Hablo un poco de español.",
      "Tengo dos hermanas.",
    ],
  },
  {
    min: 11, max: 15,
    cefr: "A1 late", short: "consolidated A1",
    description:
      "About 500 words. Talks about family, daily routine, basic preferences. Uses pretérito perfecto simple of common verbs (fui, comí, vi) tentatively, often mixing tenses. Self-corrects often. Articles and gender still inconsistent.",
    examples: [
      "Ayer fui al supermercado.",
      "Mi familia es de Alemania, pero ahora vivo aquí.",
    ],
  },
  {
    min: 16, max: 20,
    cefr: "A2 early", short: "early A2",
    description:
      "About 800-1000 words. Comfortable with present and pretérito; starting to use imperfecto though the distinction with pretérito is shaky. Forms 'ir a + infinitivo' for plans. Reflexive verbs (me levanto, se llama) used correctly in routine cases.",
    examples: [
      "Cuando era niño, jugaba al fútbol todos los días.",
      "Mañana voy a visitar a mis abuelos.",
    ],
  },
  {
    min: 21, max: 25,
    cefr: "A2 late", short: "consolidated A2",
    description:
      "About 1500 words. Solid pretérito/imperfecto distinction. Expresses plans, simple opinions, gives directions. Active connectors: porque, pero, también, además. Idioms understood mostly literally. Can describe past events in two or three connected sentences.",
    examples: [
      "Voy a estudiar en la biblioteca esta tarde.",
      "Pienso que el clima es mejor en el sur.",
      "Tienes que girar a la izquierda en la próxima calle.",
    ],
  },
  {
    min: 26, max: 30,
    cefr: "B1 early", short: "early B1",
    description:
      "About 2000-2500 words. Reasons and justifies opinions with mid-level connectors (aunque, sin embargo, por lo tanto). Handles condicional simple for polite requests and basic hypotheticals. Starting to use por/para distinction correctly.",
    examples: [
      "Si tuviera más tiempo, aprendería italiano también.",
      "Aunque el coche es viejo, todavía funciona bien.",
      "Me gustaría reservar una mesa para esta noche.",
    ],
  },
  {
    min: 31, max: 35,
    cefr: "B1 mid", short: "mid B1",
    description:
      "Subjuntivo presente solid in common triggers (quiero que, espero que, no creo que, ojalá). Recounts moderately complex stories with multiple clauses. Beginning to handle reported speech in past contexts. Vocabulary breadth covers everyday + most travel/work topics.",
    examples: [
      "Espero que mi hermana venga a visitarnos pronto.",
      "Me pidió que le ayudara con el proyecto.",
      "No creo que sea una buena idea ir al cine hoy.",
    ],
  },
  {
    min: 36, max: 40,
    cefr: "B1 late", short: "consolidated B1",
    description:
      "About 3500 words. Longer narratives spanning past, present, and future. Beginning to grasp cultural references and idioms (echar de menos, dar igual, llevarse bien). Subjuntivo imperfecto in hypothetical conditionals (si tuviera, si supiera).",
    examples: [
      "Si supiera la respuesta, te la diría.",
      "Cuando era estudiante, soñaba con viajar por toda Sudamérica.",
      "Te echo de menos cuando estoy lejos.",
    ],
  },
  {
    min: 41, max: 45,
    cefr: "B2 early", short: "early B2",
    description:
      "About 5000 words. Argues a position, supports it with examples. Uses indirect speech naturally (me dijo que vendría). Recognises cultural allusions (literature, history, sports) when context helps. Begins using más rich connector inventory (mientras que, en cambio, a pesar de que).",
    examples: [
      "Me dijo que vendría temprano, pero hasta ahora no ha llegado.",
      "Aunque algunos opinan que el cine ha perdido relevancia, creo que es más vital que nunca.",
    ],
  },
  {
    min: 46, max: 50,
    cefr: "B2 mid", short: "mid B2",
    description:
      "Subjuntivo perfecto (haya hecho) integrated. Nuanced register awareness — knows when to use tú vs. usted, formal vs. casual lexicon. Discusses abstract themes (philosophy, politics) with effort but coherently. Can re-phrase a stuck idea on the fly.",
    examples: [
      "Quizás te haya impresionado el discurso, pero a mí me pareció superficial.",
      "La libertad individual y el bien colectivo no son necesariamente opuestos.",
    ],
  },
  {
    min: 51, max: 55,
    cefr: "B2 late", short: "consolidated B2",
    description:
      "About 6500 words. Complex hypotheticals (si hubiera + condicional perfecto). Uses idiomatic expressions actively (echar de menos, darse cuenta, hacer falta). Discusses film, books, politics with most vocabulary at hand. Speech remains a little effortful.",
    examples: [
      "Si hubiera estudiado más, habría aprobado el examen sin problema.",
      "Me echa de menos cada vez que me voy de viaje.",
    ],
  },
  {
    min: 56, max: 60,
    cefr: "C1 early", short: "early C1",
    description:
      "About 8000 words. Nuanced stance-taking (matizar, poner en cuestión, descartar). Subjuntivo pluscuamperfecto in literary register (hubiera dicho, hubiera sido). Grasps wordplay, irony, and most idioms in context.",
    examples: [
      "Matizo lo que dije antes: no es que el sistema sea injusto, sino que está mal diseñado.",
      "Como si lo hubieras hecho a propósito, ¿no?",
    ],
  },
  {
    min: 61, max: 65,
    cefr: "C1 mid", short: "mid C1",
    description:
      "Natural discussion of complex topics — economics, ethics, art criticism. Detects regional variation (Castellano vs. Latinoamericano) consciously. Switches between more formal essay register and casual chat seamlessly.",
    examples: [
      "El debate sobre la renta básica universal cobra fuerza en cuanto las economías occidentales aceptan que el pleno empleo ya no es una meta realista.",
    ],
  },
  {
    min: 66, max: 70,
    cefr: "C1 late", short: "consolidated C1",
    description:
      "Spontaneous speech in almost every situation. Grasps cultural depth (literary references, regional pop culture, political shorthand). Vocabulary gaps rarely interrupt flow — paraphrases gracefully when a specific word eludes them.",
    examples: [
      "Me recuerda a la postura de Vargas Llosa en El pez en el agua — esa tensión entre lo cosmopolita y lo provinciano.",
    ],
  },
  {
    min: 71, max: 75,
    cefr: "C2 early", short: "near-native C2",
    description:
      "Near-native. Precise word choice — distinguishes fine synonyms (precaver vs. prevenir, aludir vs. mencionar). Uses slang and colloquial register actively without feeling foreign. Catches subtle pragmatic implications.",
    examples: [
      "No es que me dé igual, es que prefiero no entrar en ese trapo.",
      "Lo de Pablo es de traca, ¿no te has enterado?",
    ],
  },
  {
    min: 76, max: 80,
    cefr: "C2 mid", short: "mid C2",
    description:
      "About 12000+ words. Reads and discusses literary texts (García Márquez, Cortázar, Borges). Comfortable with rhetorical devices (anáfora, hipérbaton, lítote). Can deliver structured oral arguments and improvise both formal and casual registers.",
    examples: [
      "La obra de Cortázar invierte deliberadamente el orden esperado de los hechos, lo cual fuerza al lector a reconstruir la cronología — pero en ese proceso descubre algo más.",
    ],
  },
  {
    min: 81, max: 85,
    cefr: "C2 late", short: "consolidated C2",
    description:
      "Specialised vocabulary across domains (legal, medical, technical) — recognises and uses with confidence. Switches register effortlessly from boardroom-formal to bar-stool casual. Catches double meanings, irony, sarcasm without prompting.",
    examples: [
      "La cláusula adicional excluye la responsabilidad subsidiaria del avalista en caso de incumplimiento sobrevenido por causa de fuerza mayor.",
    ],
  },
  {
    min: 86, max: 90,
    cefr: "Beyond C2", short: "near-native adult",
    description:
      "Indistinguishable from an educated native adult in casual and most professional contexts. All registers available — vulgar slang to scholarly prose. Refranes (proverbs) flow naturally; idiomatic phrasing is the default, not the exception.",
    examples: [
      "A buenas horas, mangas verdes.",
      "Más sabe el diablo por viejo que por diablo.",
    ],
  },
  {
    min: 91, max: 95,
    cefr: "Educated native", short: "educated native",
    description:
      "Academic precision. Wields technical and professional vocabulary across multiple specialties (jurídico, médico, filosófico, literario). Recognises archaic and literary registers — siglo-de-oro quotations feel natural. Mastery of subordination and stylistic variation.",
    examples: [
      "La causalidad eficiente, en términos aristotélicos, queda subsumida por el principio de razón suficiente leibniziano — al menos en su lectura más estricta.",
    ],
  },
  {
    min: 96, max: 100,
    cefr: "Master / notarial", short: "notary-level master",
    description:
      "Elite professional native — notario, supreme-court justice, literary scholar, classical orator. Every word is the right word. Stylistic mastery across centuries of register, from medieval romance to modern bureaucratese. The kind of Spanish you read in escrituras notariales and sentencias de Tribunal Supremo.",
    examples: [
      "Por la presente escritura, otorgada ante mí, el Notario, comparecen las partes intervinientes, libres y a su instancia, con la capacidad legal necesaria para el otorgamiento del presente acto, y de cuya identidad doy fe.",
    ],
  },
];

/**
 * Returns the LevelRange covering the given 1-100 level. Clamps to
 * the first / last range for values outside the scale.
 */
export function getLevelRange(level: number): LevelRange {
  for (const r of LEVEL_RANGES) {
    if (level >= r.min && level <= r.max) return r;
  }
  return level < 1 ? LEVEL_RANGES[0] : LEVEL_RANGES[LEVEL_RANGES.length - 1];
}

/**
 * Compact one-line-per-range view of the full 1-100 scale. Used by the
 * adaptive level-tracker prompt so the LLM can place a learner's
 * production samples on the scale.
 */
export function describeLevelScaleCompact(): string {
  return LEVEL_RANGES.map(
    (r) => `${r.min.toString().padStart(2, " ")}-${r.max} (${r.cefr}): ${r.short} — ${r.description.split(".")[0]}.`,
  ).join("\n");
}

/**
 * Style directive for the AI's outgoing message, scaled by learner
 * level. The frame is SIMPLICITY, not raw word count — a beginner can
 * understand a longer reply made of common words faster than a short
 * one packed with rare vocabulary. The directive relaxes as the
 * learner advances. This is the authoritative source for reply style;
 * converse prompts defer to it instead of imposing their own length
 * caps.
 */
function lengthDirectiveForLevel(level: number): string {
  if (level <= 15) {
    return [
      `STYLE GUIDANCE — the learner is in the early stages of learning the language:`,
      `- Keep your reply SIMPLE. Use common, everyday words the learner is likely to already know.`,
      `- Don't overwhelm with vocabulary they probably haven't seen — no rare idioms, no compound tenses, no specialised terms.`,
      `- You don't have to be terse — just simple. Stay relaxed; short or medium length is both fine as long as the words stay easy.`,
      `- Single-clause sentences usually work best. Build complexity slowly across many turns, not in one turn.`,
    ].join("\n");
  }
  if (level <= 30) {
    return [
      `STYLE GUIDANCE — the learner is still consolidating basics:`,
      `- Keep your reply clear and approachable. Common vocabulary, one or two sentences typically.`,
      `- Avoid rare idioms, compound tenses, or specialised vocabulary unless the learner introduced them first.`,
    ].join("\n");
  }
  if (level <= 50) {
    return [
      `STYLE GUIDANCE:`,
      `- Conversational, never a lecture. Usually 1–2 sentences; up to 3 if the moment calls for it.`,
      `- Idioms and richer connectors are fine; the learner can handle them.`,
    ].join("\n");
  }
  return [
    `STYLE GUIDANCE:`,
    `- Conversational. Length as the moment calls for; no artificial brevity but no monologues either.`,
  ].join("\n");
}

/**
 * Renders the learner's level as a compact, prompt-ready block —
 * level number + CEFR anchor + abilities + concrete examples + a
 * length directive + a "aim slightly above this" instruction. Used
 * in chat prompts where the AI message should target the learner's
 * complexity ceiling.
 *
 * targetLanguage is accepted for forward-compat with per-language
 * level ranges (Phase 2). Today the ranges are Spanish-specific;
 * Phase 2 will pick the right table based on this argument.
 */
export function describeLevelForPrompt(
  level: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  targetLanguage: import("./targetLanguage").TargetLanguageSpec,
): string {
  const r = getLevelRange(level);
  const targetCeiling = Math.min(100, r.max + 5);
  return [
    `Learner level: ${level}/100. Range ${r.min}-${r.max} (CEFR ${r.cefr}, "${r.short}").`,
    r.description,
    `Examples at this level: ${r.examples.map((e) => `"${e}"`).join("; ")}.`,
    `Aim slightly above this level — stretch the learner while staying understandable. Stay within ~${targetCeiling} on the 100-point scale.`,
    "",
    lengthDirectiveForLevel(level),
  ].join("\n");
}
