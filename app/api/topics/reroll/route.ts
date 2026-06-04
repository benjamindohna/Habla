import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  rotateNextToCurrent,
  generateAndStoreCurrent,
  generateAndStoreNext,
  getCurrentSet,
} from "@/lib/topicSets";
import { withRouteUsage } from "@/lib/usageContext";

export async function POST() {
  return withRouteUsage("/api/topics/reroll", async () => {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Happy path: next is already populated → instant rotation.
  let topics = await rotateNextToCurrent(session.userId);

  // Synchronous fallback: user re-rolled before background gen finished, or
  // background gen failed silently. Pay the latency once, then continue.
  if (!topics) {
    await generateAndStoreCurrent(session.userId);
    topics = await getCurrentSet(session.userId);
    if (!topics) return NextResponse.json({ error: "Failed to generate" }, { status: 500 });
  }

  // Fire-and-forget: regenerate `next` so the user's next re-roll is instant.
  // Errors are swallowed; the next request will retry.
  generateAndStoreNext(session.userId).catch((err) =>
    console.error("[/api/topics/reroll] background next-gen failed:", err),
  );

  return NextResponse.json({ topics });
  });
}
