import { NextRequest, NextResponse } from "next/server";
import { chatText, type ChatMessage } from "@/lib/llm";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { describeTargetLanguage, type TargetLanguageSpec } from "@/lib/targetLanguage";

/**
 * Multi-turn follow-up Q&A on a single segment explanation.
 *
 * The user already saw an initial explanation from /api/explain. They
 * have a grammar question that the initial text didn't quite address —
 * this endpoint takes the conversation history and produces the next
 * answer, scoped strictly to THIS segment so the chat doesn't drift
 * into open-ended language Q&A.
 *
 * Model: chat_light (gpt-4o-mini). Grammar follow-ups are well within
 * mini's strength and matching the parent /api/explain's default keeps
 * tone + cost consistent. Bump to chat_precise here if answer quality
 * later proves uneven.
 *
 * History persistence: client-side only. This route is stateless across
 * requests — every call must include the full prior turn list. Closing
 * the segment in the UI loses the history by design.
 */
function buildSystemPrompt(args: {
  localVersionTarget: string;
  localSegment: string;
  userSegment: string;
  initialExplanation: string;
  nativeLanguage: string;
  targetLanguage: TargetLanguageSpec;
}): string {
  const target = describeTargetLanguage(args.targetLanguage);
  const targetName = args.targetLanguage.language;
  return `You are a helpful ${target} grammar tutor. The learner is studying ${targetName} and has asked a follow-up question about ONE specific segment of a sentence they previously recorded. Stay focused on that segment.

Context:
- Full sentence (perfect ${target}): "${args.localVersionTarget}"
- The segment in focus (correct version): "${args.localSegment}"
- What the learner originally said in that spot: "${args.userSegment.trim() || "(nothing — this part was left out)"}"

The initial explanation the learner already read (do not repeat it — build on it):
---
${args.initialExplanation}
---

Behaviour:
- Stay anchored to THIS segment. If the question drifts to unrelated grammar topics (other tenses, other words, general language theory), give a SHORT answer (one sentence) and steer back: "Wenn du tiefer einsteigen willst, frag mich am besten in einem neuen Chat."
- Don't repeat the initial explanation. The learner already has it on screen.
- Use **bold** for ${targetName} words and phrases, and for key grammar terms.
- Use line breaks between distinct points. Be concise: usually 2–4 sentences; up to 6 if the question is dense. Never exceed 6.
- Start directly with the answer. No preamble, no "Great question", no meta-commentary.
- Examples and corrections must use ${target}.

About the learner:
- They intentionally fall back to ${args.nativeLanguage} for words they don't yet know in ${targetName}. When the learner uses a ${args.nativeLanguage} word, treat it as a request to learn the ${targetName} equivalent.
- NEVER point out that a word was ${args.nativeLanguage}. Skip that meta-commentary entirely.

Reply in ${args.nativeLanguage}.`;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/explain/followup", session?.userId ?? null, async () => {
  try {
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = (await req.json()) as {
      localVersionTarget?: string;
      localSegment?: string;
      userSegment?: string;
      initialExplanation?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      question?: string;
      nativeLanguage?: string;
    };

    const {
      localVersionTarget,
      localSegment,
      userSegment = "",
      initialExplanation,
      history = [],
      question,
      nativeLanguage = "German",
    } = body;

    if (!localVersionTarget || !localSegment || !initialExplanation || !question?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields (localVersionTarget, localSegment, initialExplanation, question)" },
        { status: 400 },
      );
    }

    const systemPrompt = buildSystemPrompt({
      localVersionTarget,
      localSegment,
      userSegment,
      initialExplanation,
      nativeLanguage,
      targetLanguage: user.targetLanguage,
    });

    // Defensive: only allow user / assistant roles into history (no
    // system-prompt injection from the client).
    const safeHistory: ChatMessage[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: String(m.content ?? "") }));

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...safeHistory,
      { role: "user", content: question.trim() },
    ];

    const answer = (
      await chatText({
        task: "chat_light",
        label: "explain/followup",
        messages,
        temperature: 0.4,
        maxTokens: 400,
      })
    ).trim();

    if (!answer) {
      return NextResponse.json({ error: "Empty answer" }, { status: 500 });
    }
    return NextResponse.json({ answer });
  } catch (err) {
    console.error("[/api/explain/followup]", err);
    return NextResponse.json({ error: "Follow-up failed" }, { status: 500 });
  }
  });
}
