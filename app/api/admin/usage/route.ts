import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/**
 * Admin-only usage analytics. One endpoint serves the whole page: it
 * returns totals, the per-function breakdown, and the per-user list —
 * all scoped to the requested time range (and optionally a specific
 * user). The frontend re-fetches whenever range or userId changes.
 *
 * Query params:
 *   range:  "1h" | "12h" | "24h" | "7d" | "30d" | "all"
 *   userId: integer or omitted (= all users)
 *
 * The per-user list is ALWAYS scoped to the time range but NOT to
 * userId — that way the user can switch profiles without losing the
 * overview of who else is using the app.
 */

const RANGE_SECONDS: Record<string, number | null> = {
  "1h": 3600,
  "12h": 43_200,
  "24h": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
  all: null,
};

interface FunctionBreakdownRow {
  label: string;
  calls: number;
  totalCost: string;
  avgCost: string;
}

interface UserSummaryRow {
  id: number;
  email: string;
  calls: number;
  totalCost: string;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "24h";
  const userIdRaw = url.searchParams.get("userId");
  const userIdFilter = userIdRaw ? Number(userIdRaw) : null;
  if (userIdFilter !== null && (!Number.isFinite(userIdFilter) || userIdFilter <= 0)) {
    return NextResponse.json({ error: "userId invalid" }, { status: 400 });
  }
  const seconds = RANGE_SECONDS[range];
  if (seconds === undefined) {
    return NextResponse.json({ error: "range invalid" }, { status: 400 });
  }

  // `since` is 0 when range = "all" — every row's created_at is > 0.
  const since = seconds === null ? 0 : Math.floor(Date.now() / 1000) - seconds;

  // 1) Totals (with userId filter applied)
  //    cost_usd is stored as text — cast to numeric. Null/empty rows
  //    (model not in price map) contribute 0 to the sum but still count.
  //    db.execute returns the RowList directly (postgres.js driver), no
  //    `.rows` wrapper.
  const totalsRows = (await db.execute(sql`
    SELECT
      COUNT(*)::bigint AS calls,
      COALESCE(SUM(NULLIF(cost_usd, '')::numeric), 0)::text AS total_cost
    FROM llm_usage
    WHERE created_at >= ${since}
      ${userIdFilter !== null ? sql`AND user_id = ${userIdFilter}` : sql``}
  `)) as unknown as Array<{ calls: string; total_cost: string | null }>;
  const totals = totalsRows[0];
  const totalCalls = Number(totals?.calls ?? 0);
  const totalCost = totals?.total_cost ?? "0";

  // 2) Per-function breakdown (with userId filter)
  const breakdownRows = (await db.execute(sql`
    SELECT
      label,
      COUNT(*)::bigint AS calls,
      COALESCE(SUM(NULLIF(cost_usd, '')::numeric), 0)::text AS total_cost
    FROM llm_usage
    WHERE created_at >= ${since}
      ${userIdFilter !== null ? sql`AND user_id = ${userIdFilter}` : sql``}
    GROUP BY label
    ORDER BY COALESCE(SUM(NULLIF(cost_usd, '')::numeric), 0) DESC NULLS LAST
  `)) as unknown as Array<{ label: string; calls: string; total_cost: string | null }>;
  const byFunction: FunctionBreakdownRow[] = breakdownRows.map((r) => {
    const calls = Number(r.calls);
    const total = Number(r.total_cost ?? 0);
    const avg = calls > 0 ? total / calls : 0;
    return {
      label: r.label,
      calls,
      totalCost: total.toFixed(6),
      avgCost: avg.toFixed(6),
    };
  });

  // 3) Per-user totals (time-range scoped, NOT userId scoped — the user
  //    list stays the same so the user can switch profiles freely).
  //    Includes only rows with a non-null user_id; null-attributed calls
  //    (scripts, background fire-and-forget) are reflected in the totals
  //    but not the user list.
  const usersRows = (await db.execute(sql`
    SELECT
      u.id,
      u.email,
      COUNT(*)::bigint AS calls,
      COALESCE(SUM(NULLIF(lu.cost_usd, '')::numeric), 0)::text AS total_cost
    FROM llm_usage lu
    JOIN users u ON u.id = lu.user_id
    WHERE lu.created_at >= ${since}
    GROUP BY u.id, u.email
    ORDER BY COALESCE(SUM(NULLIF(lu.cost_usd, '')::numeric), 0) DESC NULLS LAST
  `)) as unknown as Array<{ id: number; email: string; calls: string; total_cost: string | null }>;
  const users: UserSummaryRow[] = usersRows.map((r) => ({
    id: r.id,
    email: r.email,
    calls: Number(r.calls),
    totalCost: r.total_cost ?? "0",
  }));

  return NextResponse.json({
    range,
    userIdFilter,
    totalCalls,
    totalCost,
    byFunction,
    users,
  });
}
