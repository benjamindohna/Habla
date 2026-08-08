import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { BENCH_MODELS, benchModelAvailable, chatText } from "@/lib/llm";
import { interpret, localize, segment } from "@/lib/correctionPipeline";
import { describeTargetLanguage } from "@/lib/targetLanguage";
import { describeLevelForPrompt } from "@/lib/levels";
import type { Pair } from "@/types/correction";

/**
 * Model bench: run the full chat-turn pipeline (interpret → localize →
 * segment → AI reply) against one candidate model and report per-step
 * latency + outputs. The client fires one POST per selected model so
 * candidates run concurrently and results stream in as they finish.
 *
 * modelId "production" runs the current task→model mapping (interpret
 * mini, localize 4o, segment mini, reply 4o) as the baseline column.
 */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({
    models: BENCH_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      priceLabel: m.priceLabel,
      available: benchModelAvailable(m),
      keyEnv: m.keyEnv,
    })),
  });
}

interface StepResult {
  key: string;
  label: string;
  ms: number;
  ok: boolean;
  output?: unknown;
  error?: string;
}

async function timed<T>(
  key: string,
  label: string,
  fn: () => Promise<T>,
): Promise<{ step: StepResult; value: T | null }> {
  const start = performance.now();
  try {
    const value = await fn();
    return { step: { key, label, ms: Math.round(performance.now() - start), ok: true, output: value }, value };
  } catch (err) {
    return {
      step: {
        key,
        label,
        ms: Math.round(performance.now() - start),
        ok: false,
        error: (err as Error).message,
      },
      value: null,
    };
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/playground/model-bench", session?.userId ?? null, async () => {
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as {
      transcript?: unknown;
      modelId?: unknown;
    };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId : "";
    if (!transcript || !modelId) {
      return NextResponse.json({ error: "transcript and modelId required" }, { status: 400 });
    }

    // "production" → no bench override anywhere; pipeline runs exactly
    // like /api/correct + /api/converse/turn do today.
    const benchModel = modelId === "production" ? undefined : modelId;

    const steps: StepResult[] = [];
    const totalStart = performance.now();

    // 1. interpret
    const interp = await timed("interpret", "Interpret (Intent)", () =>
      interpret(transcript, user.nativeLanguage, user.targetLanguage, benchModel),
    );
    steps.push({ ...interp.step, output: interp.value?.intended_meaning_native });

    // 2. localize (transcript-aware, like production chat)
    let localVersion: string | null = null;
    if (interp.value) {
      const loc = await timed("localize", "Localize (Korrektur)", () =>
        localize({
          intendedMeaning: interp.value!.intended_meaning_native,
          transcript,
          nativeLanguage: user.nativeLanguage,
          targetLanguage: user.targetLanguage,
          style: "transcript_aware",
          benchModel,
        }),
      );
      steps.push(loc.step);
      localVersion = loc.value;
    }

    // 3. segment
    let pairs: Pair[] | null = null;
    if (localVersion) {
      const seg = await timed("segment", "Segment (Alignment)", () =>
        segment({
          transcript,
          localVersionTarget: localVersion!,
          nativeLanguage: user.nativeLanguage,
          targetLanguage: user.targetLanguage,
          benchModel,
        }),
      );
      steps.push(seg.step);
      pairs = seg.value;
    }

    // 4. AI reply — mirrors /api/converse/turn's prompt (topic-less chat).
    if (localVersion) {
      const target = describeTargetLanguage(user.targetLanguage);
      const targetName = user.targetLanguage.language;
      const levelBlock = describeLevelForPrompt(user.level, user.targetLanguage);
      const systemPrompt = `You are a native ${target} speaker having a casual conversation with a language learner whose native language is ${user.nativeLanguage}.

No specific topic was set — engage naturally with whatever the learner brings up.

${levelBlock}

Behave like a real chat partner:
- Engage with what the learner just said. React, agree, disagree, share your own take.
- ALWAYS end your reply with a question.
- Don't comment on the learner's language, grammar, vocabulary, or accent.
- Stay 100% in ${targetName}.

Return ONLY the reply text in ${targetName}. No JSON, no quotes, no preamble, no formatting.`;

      const reply = await timed("reply", "AI-Antwort (Chat-Turn)", () =>
        chatText({
          task: "chat_precise",
          label: `bench/reply/${modelId}`,
          benchModel,
          temperature: 0.7,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: localVersion! },
          ],
        }),
      );
      steps.push(reply.step);
    }

    return NextResponse.json({
      modelId,
      totalMs: Math.round(performance.now() - totalStart),
      localVersion,
      pairs,
      steps,
    });
  });
}
