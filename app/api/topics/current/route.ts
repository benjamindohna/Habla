import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureUserTopicSets, getCurrentSet } from "@/lib/topicSets";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Defensive lazy fallback: if the user has no current set yet (e.g., warm
  // wasn't run after account creation), generate it on the fly. This is the
  // only place a user might experience the 5-9s wait, and only once.
  await ensureUserTopicSets(session.userId);

  const topics = await getCurrentSet(session.userId);
  if (!topics) return NextResponse.json({ error: "No current set" }, { status: 500 });

  return NextResponse.json({ topics });
}
