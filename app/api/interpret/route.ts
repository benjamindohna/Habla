import { NextRequest, NextResponse } from "next/server";
import { chatJSON } from "@/lib/llm";
import { DEFAULT_TARGET } from "@/lib/targetLanguage";

export async function POST(req: NextRequest) {
  try {
    const { transcript, nativeLanguage = "German" } = (await req.json()) as {
      transcript: string;
      nativeLanguage?: string;
    };

    if (!transcript?.trim()) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }

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

    const result = await chatJSON({
      task: "chat_light",
      label: "interpret",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript },
      ],
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/interpret]", err);
    return NextResponse.json({ error: "Interpretation failed" }, { status: 500 });
  }
}
