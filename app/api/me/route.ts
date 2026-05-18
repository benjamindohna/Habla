import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getUserById,
  getUserInterests,
  setUserCorrectionStyle,
  setUserTargetLanguage,
  type CorrectionStyle,
} from "@/lib/users";
import type { TargetLanguageSpec } from "@/lib/targetLanguage";

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

  const body = (await req.json().catch(() => ({}))) as {
    correctionStyle?: string;
    targetLanguage?: TargetLanguageSpec;
  };

  if (body.correctionStyle !== undefined) {
    const next = body.correctionStyle;
    if (next !== "natural" && next !== "transcript_aware") {
      return NextResponse.json({ error: "Invalid correctionStyle" }, { status: 400 });
    }
    setUserCorrectionStyle(session.userId, next as CorrectionStyle);
    return NextResponse.json({ ok: true, correctionStyle: next });
  }

  if (body.targetLanguage !== undefined) {
    const spec = body.targetLanguage;
    if (
      !spec ||
      typeof spec.language !== "string" ||
      (spec.location !== null && typeof spec.location !== "string") ||
      (spec.style !== "everyday" && spec.style !== "street" && spec.style !== "office")
    ) {
      return NextResponse.json({ error: "Invalid targetLanguage" }, { status: 400 });
    }
    setUserTargetLanguage(session.userId, spec);
    return NextResponse.json({ ok: true, targetLanguage: spec });
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
