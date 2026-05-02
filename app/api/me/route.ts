import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById, getUserInterests } from "@/lib/users";

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
    level: user.level,
    interests,
    interestsText: user.interestsText,
  });
}
