import { NextRequest, NextResponse } from "next/server";
import { chatText, chatTextStream, getBenchModel, type ChatMessage } from "@/lib/llm";
import { warmAnnotation } from "@/lib/annotate";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import { describeTargetLanguage } from "@/lib/targetLanguage";
import { describeLevelForPrompt } from "@/lib/levels";
import {
  appendMessage,
  deriveConversationTopic,
  getConversation,
  getMessages,
  updateConversationTopic,
} from "@/lib/conversations";
import type { Pair } from "@/types/correction";

/**
 * AI reply on each user turn. Plain-text only — the client tokenises
 * the reply word-by-word and fires per-tap translation + vocab save
 * on tap. AI side stores no segments.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/converse/turn", session?.userId ?? null, async () => {
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: number;
    userTextTarget?: string;
    userRaw?: string;
    segments?: Pair[];
    /** Experiment-only (mix-chat playground): bench-model override for
     *  the AI reply. Must be a BENCH_MODELS id; invalid ids ignored. */
    replyModel?: string;
    /** SSE mode: stream the reply as {type:"delta"} frames followed by a
     *  {type:"done"} frame. Default false keeps the JSON shape for older
     *  callers (playground pages). */
    stream?: boolean;
  };
  const { conversationId, userTextTarget, userRaw, segments } = body;
  const replyBench =
    body.replyModel && getBenchModel(body.replyModel) ? body.replyModel : undefined;

  if (typeof conversationId !== "number" || !conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }
  if (typeof userTextTarget !== "string" || !userTextTarget.trim()) {
    return NextResponse.json({ error: "userTextTarget required" }, { status: 400 });
  }

  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.user_id !== user.id) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Persist the user turn first — even if AI generation later fails, the
  // user's message is recorded so the conversation can resume.
  await appendMessage({
    conversationId,
    role: "user",
    textTarget: userTextTarget.trim(),
    userRaw: userRaw?.trim() || null,
    segments: segments ?? null,
  });

  // Topic derivation: if the chat was started topic-less (empty-chat
  // path) and this is the first user message, fire a tiny LLM call in
  // parallel with the AI turn so every saved conversation gets a label
  // for the recent-chats list. Doesn't gate the response.
  const needsTopic = !conversation.topic || conversation.topic.trim() === "";
  const topicPromise: Promise<string | null> = needsTopic
    ? deriveConversationTopic({
        firstUserMessage: userTextTarget.trim(),
        targetLanguage: user.targetLanguage.language,
        nativeLanguage: user.nativeLanguage,
      }).catch((err) => {
        console.warn("[converse/turn] topic derivation failed:", err);
        return null;
      })
    : Promise.resolve(null);

  // Rebuild the message history for the model. AI sees the corrected
  // target-language text for user turns (not the raw transcript) so it
  // engages with what the user *meant*, not what they accidentally said.
  const history = await getMessages(conversationId);

  const target = describeTargetLanguage(user.targetLanguage);
  const targetName = user.targetLanguage.language;
  const nativeLanguage = user.nativeLanguage;
  const levelBlock = describeLevelForPrompt(user.level, user.targetLanguage);

  const topicLine = conversation.topic && conversation.topic.trim()
    ? `Topic of the conversation: "${conversation.topic}"`
    : `No specific topic was set — engage naturally with whatever the learner brings up.`;
  const systemPrompt = `You are a native ${target} speaker having a casual conversation with a language learner whose native language is ${nativeLanguage}.

${topicLine}

${levelBlock}

Behave like a real chat partner:
- Engage with what the learner just said. React, agree, disagree, share your own take.
- ALWAYS end your reply with a question. The conversation must keep moving — never leave the learner without a clear hook to respond to. The question should feel natural (a friend's curiosity, not an interview), and should fit the topic.
- Follow the STYLE GUIDANCE in the level block above — that is authoritative on how complex your reply may be.
- Don't quiz the learner or test them. Just talk like a friend would.
- Don't comment on the learner's language, grammar, vocabulary, or accent. They have a separate correction system handling that. Just respond to the content.
- Stay 100% in ${targetName}. Do NOT include ${nativeLanguage} translations, glosses, parentheticals, or word-pairings. The learner sees only your ${targetName} output.
- Use vocabulary, idioms, named entities, and register that fit ${target}. Do not drift to other regions or registers.

Return ONLY the reply text in ${targetName}. No JSON, no quotes, no preamble, no formatting.`;

  // Build message array: system + alternating turns from history.
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const m of history) {
    messages.push({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.textTarget,
    });
  }

  // Shared post-generation side effects: persist the AI turn, label the
  // conversation if needed, warm the annotation cache so word-taps on the
  // fresh bubble resolve instantly.
  async function finishReply(text: string, derivedTopic: string | null) {
    if (derivedTopic && needsTopic) {
      await updateConversationTopic(conversationId!, derivedTopic);
    }
    await appendMessage({
      conversationId: conversationId!,
      role: "ai",
      textTarget: text,
      segments: null,
    });
    warmAnnotation({
      text,
      nativeLanguage: user!.nativeLanguage,
      targetLanguage: user!.targetLanguage,
    });
  }

  if (body.stream) {
    const encoder = new TextEncoder();
    const t0 = Date.now();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        try {
          const [text, derivedTopic] = await Promise.all([
            chatTextStream({
              task: "chat_precise",
              label: replyBench ? `converse/turn/${replyBench}` : "converse/turn",
              benchModel: replyBench,
              messages,
              temperature: 0.7,
              onDelta: (delta) => send({ type: "delta", delta }),
            }),
            topicPromise,
          ]);
          if (!text) throw new Error("Model returned no usable reply");
          await finishReply(text, derivedTopic);
          send({
            type: "done",
            text,
            ...(derivedTopic && needsTopic ? { derivedTopic } : {}),
          });
          console.log(`[timing] converse/turn stream total=${Date.now() - t0}ms`);
        } catch (err) {
          console.error("[/api/converse/turn stream]", err);
          send({ type: "error", message: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  try {
    // Fire AI turn and topic derivation in parallel — both depend only
    // on the just-appended user message, so neither needs to wait for
    // the other. Total latency = max(turn, topic) ≈ turn, since the
    // topic call is much smaller.
    const [text, derivedTopic] = await Promise.all([
      chatText({
        task: "chat_precise",
        label: replyBench ? `converse/turn/${replyBench}` : "converse/turn",
        benchModel: replyBench,
        messages,
        temperature: 0.7,
      }).then((s) => s.trim()),
      topicPromise,
    ]);
    if (!text) {
      throw new Error("Model returned no usable reply");
    }
    await finishReply(text, derivedTopic);

    return NextResponse.json({
      text,
      ...(derivedTopic && needsTopic ? { derivedTopic } : {}),
    });
  } catch (err) {
    console.error("[/api/converse/turn]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  });
}
