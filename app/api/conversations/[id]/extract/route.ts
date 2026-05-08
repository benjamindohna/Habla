import { NextRequest, NextResponse } from "next/server";
import { chatJSON } from "@/lib/llm";
import { getSession } from "@/lib/auth";
import { getUserById, getUserInterests, setUserInterests, setUserInterestsText } from "@/lib/users";
import { getConversation, getMessages, markConversationEnded } from "@/lib/conversations";
import { generateAndStoreNext, invalidateNextSet } from "@/lib/topicSets";
import { getDb } from "@/lib/db";

const MAX_TAGS = 12;
const RECENT_TAGS = 5;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { id } = await ctx.params;
  const conversationId = Number(id);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });
  }

  const conversation = getConversation(conversationId);
  if (!conversation || conversation.user_id !== user.id) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Idempotent: if extraction already ran, just return ok. Don't re-bill the
  // LLM for a back-arrow that fired twice.
  if (conversation.ended_at != null) {
    return NextResponse.json({ ok: true, alreadyExtracted: true });
  }

  const messages = getMessages(conversationId);
  // Skip extraction for trivial conversations (just the opener, or one user
  // turn) — the LLM has nothing to learn from.
  const userTurns = messages.filter((m) => m.role === "user").length;
  if (userTurns < 1) {
    markConversationEnded(conversationId);
    return NextResponse.json({ ok: true, skipped: "too short" });
  }

  const currentInterests = getUserInterests(user.id);

  const transcript = messages
    .map((m) => (m.role === "ai" ? `AI: ${m.textEs}` : `LEARNER: ${m.textEs}`))
    .join("\n");

  const prompt = `You are curating a learner's interest profile based on a conversation they just had.

Topic of the conversation: "${conversation.topic}"

Their CURRENT profile:
- Narrative: ${user.interestsText.trim() || "(empty)"}
- Tags (max ${MAX_TAGS}): ${currentInterests.length ? currentInterests.join(", ") : "(none)"}

CONVERSATION TRANSCRIPT:
${transcript}

Your job: produce an updated profile that reflects what this learner *actually engages with*. Do BOTH:

1. Update the narrative — a short paragraph (≤150 words) describing who this learner is, what they care about, and how they like to talk. Keep what's still true; integrate new signals from the conversation; drop stale claims if the conversation shows the user has moved on.

2. Update the tag list — at most ${MAX_TAGS} tags total, ranked by importance. Keep tags that are still relevant. Add new tags suggested by the conversation. Drop tags the user no longer engages with. Tags should be short noun phrases (1-5 words).

3. Mark up to ${RECENT_TAGS} of the tags as "recent" — the ones the user is most actively engaged with right now.

Return ONLY valid JSON:
{
  "narrative": "string",
  "tags": [
    { "name": "string", "recent": true | false }
  ]
}`;

  try {
    const parsed = await chatJSON<{ narrative?: unknown; tags?: unknown }>({
      task: "chat_light",
      label: "conversations/extract",
      systemPrompt: prompt,
      temperature: 0.3,
    });

    const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : null;
    const tags = Array.isArray(parsed.tags)
      ? (parsed.tags as Array<{ name?: unknown; recent?: unknown }>)
          .filter((t) => t && typeof t.name === "string" && (t.name as string).trim())
          .map((t) => ({ name: (t.name as string).trim(), recent: t.recent === true }))
          .slice(0, MAX_TAGS)
      : [];

    if (!narrative || tags.length === 0) {
      throw new Error("Curation returned no usable result");
    }

    // Wholesale replace user_interests with the curated list, preserving
    // is_recent flags. Do this in a transaction.
    const db = getDb();
    const tx = db.transaction(() => {
      // Use existing helper for the basic insert, then patch is_recent.
      setUserInterests(user.id, tags.map((t) => t.name));
      const stmt = db.prepare(
        "UPDATE user_interests SET is_recent = ? WHERE user_id = ? AND interest = ?",
      );
      for (const t of tags) stmt.run(t.recent ? 1 : 0, user.id, t.name);
    });
    tx();

    setUserInterestsText(user.id, narrative);
    markConversationEnded(conversationId);

    // Existing preloaded `next` set was generated against stale interests.
    // Drop it and kick off background regeneration against fresh interests
    // so the user's first re-roll after the chat is still instant.
    invalidateNextSet(user.id);
    generateAndStoreNext(user.id).catch((err) =>
      console.error("[/api/conversations/:id/extract] background next-gen failed:", err),
    );

    return NextResponse.json({ ok: true, narrative, tags });
  } catch (err) {
    console.error("[/api/conversations/:id/extract]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
