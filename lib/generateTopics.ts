import OpenAI from "openai";
import { getDb } from "./db";
import { getUserById } from "./users";

export interface Topic {
  es: string;
  native: string;
  kind: "match" | "related" | "random";
}

interface InterestRow {
  interest: string;
  is_recent: number;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(args: {
  nativeLanguage: string;
  interestsText: string;
  interests: InterestRow[];
  exclude: string[];
}): string {
  const { nativeLanguage, interestsText, interests, exclude } = args;

  const tagLines = interests.length
    ? interests.map((r) => `  - ${r.interest}${r.is_recent ? " [recent]" : ""}`).join("\n")
    : "  (none yet — pick widely)";

  const excludeLines = exclude.length
    ? exclude.map((t) => `  - ${t}`).join("\n")
    : "  (none)";

  return `You generate conversation-starter topics for a Spanish learner whose native language is ${nativeLanguage}.

USER PROFILE
Narrative: ${interestsText.trim() || "(none yet)"}
Interest tags:
${tagLines}

ALREADY SHOWN PREVIOUSLY (must not repeat or near-duplicate)
${excludeLines}

Produce exactly 9 topics in this 5–3–1 split:
- 5 "match": directly tied to one of the interest tags. Prefer tags marked [recent] when present.
- 3 "related": a clear stretch from the interests — adjacent but plausible.
- 1 "random": a genuine curveball, unrelated to the tags.

Topic phrasing rules:
- Each topic is a short conversation prompt: 2–8 words.
- Mix vague ("Champions League") and specific ("Johan Cruijff's playing philosophy"). Variety helps.
- Avoid generic single-word nouns when a more inviting phrasing is possible.
- Do not produce duplicates within this set, and do not near-duplicate any item in the exclusion list.

Return ONLY valid JSON in this shape:
{
  "topics": [
    { "es": "<Spanish phrasing>", "native": "<${nativeLanguage} phrasing>", "kind": "match" | "related" | "random" }
  ]
}
The "topics" array must have exactly 9 items.`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generates one set of 9 topics for a user, given an exclusion list of
 * already-seen topic strings. Throws on LLM/parse error.
 */
export async function generateTopicsForUser(
  userId: number,
  exclude: string[],
): Promise<Topic[]> {
  const user = getUserById(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const interests = getDb()
    .prepare(
      "SELECT interest, is_recent FROM user_interests WHERE user_id = ? ORDER BY is_recent DESC, added_at",
    )
    .all(userId) as InterestRow[];

  const prompt = buildPrompt({
    nativeLanguage: user.nativeLanguage,
    interestsText: user.interestsText,
    interests: interests.slice(0, 12),
    exclude,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: prompt }],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty response from model");

  const parsed = JSON.parse(raw) as { topics?: unknown };
  const topics = Array.isArray(parsed.topics) ? (parsed.topics as Topic[]) : [];

  const valid = topics.filter(
    (t) =>
      t &&
      typeof t.es === "string" &&
      typeof t.native === "string" &&
      (t.kind === "match" || t.kind === "related" || t.kind === "random"),
  );

  if (valid.length === 0) throw new Error("Model returned no usable topics");

  return shuffle(valid).slice(0, 9);
}
