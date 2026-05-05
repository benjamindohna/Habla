import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordLookedUpWord } from "@/lib/users";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    word?: string;
    native?: string | null;
  };

  if (typeof body.word !== "string" || !body.word.trim()) {
    return NextResponse.json({ error: "word required" }, { status: 400 });
  }

  recordLookedUpWord(session.userId, body.word, body.native ?? null);
  return NextResponse.json({ ok: true });
}
