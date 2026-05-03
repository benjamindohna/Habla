import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addUserInterest } from "@/lib/users";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { interest } = (await req.json().catch(() => ({}))) as { interest?: string };
  if (typeof interest !== "string" || !interest.trim()) {
    return NextResponse.json({ error: "interest required" }, { status: 400 });
  }

  // INSERT OR IGNORE — duplicates are silently skipped (PRIMARY KEY collision).
  // No interests_text regeneration here; that happens in Phase 7's post-chat
  // curation step which has a richer signal (the actual conversation).
  addUserInterest(session.userId, interest.trim());

  return NextResponse.json({ ok: true });
}
