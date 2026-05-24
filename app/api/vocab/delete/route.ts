import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { userVocab } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

/**
 * Hard-delete a vocab row. Used by the practice page's "Karte entfernen"
 * button so the learner can drop entries whose translation / sense-key
 * came out wrong. Scoped to the session user — can't delete other users'
 * rows even with a spoofed rowId.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { rowId?: number };
  const { rowId } = body;
  if (typeof rowId !== "number" || !Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId required" }, { status: 400 });
  }

  await db
    .delete(userVocab)
    .where(and(eq(userVocab.id, rowId), eq(userVocab.userId, session.userId)));

  return NextResponse.json({ ok: true });
}
