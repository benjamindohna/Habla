import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { USERS } from "@/lib/users";
import { createSession } from "@/lib/auth";

export async function POST(request: Request) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());

  // Always run bcrypt compare to prevent timing attacks (even for unknown users)
  const dummyHash = "$2b$10$invalidhashusedtopreventinenumerationtiming00000000000";
  const isValid = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);

  if (!user || !isValid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession(user.email);
  return NextResponse.json({ ok: true });
}
