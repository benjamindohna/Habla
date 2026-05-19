import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getUserById,
  getUserInterests,
  setUserCorrectionStyle,
  type CorrectionStyle,
} from "@/lib/users";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = getUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const interests = getUserInterests(user.id);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    nativeLanguage: user.nativeLanguage,
    targetLanguage: user.targetLanguage,
    level: user.level,
    interests,
    interestsText: user.interestsText,
    correctionStyle: user.correctionStyle,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // target_language is intentionally NOT patchable post-creation: the
  // current data model scopes vocab / topics / conversations per user,
  // not per (user, language), so switching mid-session would mix
  // French vocab into Spanish reviews etc. Adding switching support
  // requires the per-language scoping refactor first.
  const body = (await req.json().catch(() => ({}))) as { correctionStyle?: string };
  const next = body.correctionStyle;
  if (next !== "natural" && next !== "transcript_aware") {
    return NextResponse.json({ error: "Invalid correctionStyle" }, { status: 400 });
  }

  setUserCorrectionStyle(session.userId, next as CorrectionStyle);
  return NextResponse.json({ ok: true, correctionStyle: next });
}
