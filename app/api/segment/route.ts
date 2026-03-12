import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { Pair } from "@/types/correction";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(nativeLanguage: string, localVersionEs: string, transcript: string): string {
  return `You are a sentence-alignment engine for language learning.

The learner's native language is: ${nativeLanguage}

You are given two sentences:
- LOCAL: the perfect natural Spanish sentence (the target)
- LEARNER: what the learner actually said (may mix Spanish and ${nativeLanguage}, may have grammar errors)

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
    - first: the local Spanish segment
    - second: the corresponding learner segment
16. If something was already exactly correct and truly aligned, it may appear as a neutral matched pair.
17. If something is missing in the learner version, use an empty string for user_segment.
18. If the learner said something extra that does not belong in the local version, attach it to the most relevant pair.
19. Prefer pedagogical usefulness over mechanical diffing.

Matching examples (learner language: German):
- Learner: "con mi Freunde" / LOCAL: "con mis amigos" → "con" matched, "mis amigos" vs "mi Freunde" mismatch
- Learner: "in un Fußballfeld" / LOCAL: "en un campo de fútbol" → "en un" matched (if truly aligned), "campo de fútbol" vs "Fußballfeld" mismatch
- Learner: "y el Schiedsrichter fue muy fair" / LOCAL: "y el árbitro fue muy justo" → "y" matched, "el árbitro" vs "el Schiedsrichter" mismatch, "fue muy" matched, "justo" vs "fair" mismatch

Rules for is_match:
- is_match must be true only if the learner segment and the local segment are exactly the same in wording.
- Prefer marking independently correct words or short stretches as is_match true whenever possible.
- Do not mark a tiny subpart as is_match true if doing so would break apart a clearly unified phrase.

Very important:
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

export async function POST(req: NextRequest) {
  try {
    const { transcript, localVersionEs, nativeLanguage = "German" } = (await req.json()) as {
      transcript: string;
      localVersionEs: string;
      nativeLanguage?: string;
    };

    if (!transcript?.trim() || !localVersionEs?.trim()) {
      return NextResponse.json({ error: "Missing transcript or local version" }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "user", content: buildPrompt(nativeLanguage, localVersionEs, transcript) },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const { pairs } = JSON.parse(raw) as { pairs: Pair[] };
    return NextResponse.json({ pairs });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json({ error: "Segmentation failed" }, { status: 500 });
  }
}
