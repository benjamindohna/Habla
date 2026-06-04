// Admin-only usage analytics page. Server component does the auth +
// admin gate, then hands off to the interactive UsageClient. Anyone
// without admin rights gets a plain 404-style message rather than a
// redirect — admin pages shouldn't advertise their existence.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { isAdminEmail } from "@/lib/admin";
import { UsageClient } from "./UsageClient";

export default async function AdminUsagePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await getUserById(session.userId);
  if (!user || !isAdminEmail(user.email)) {
    return (
      <main className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <p className="text-sm text-neutral-500">Nicht gefunden.</p>
      </main>
    );
  }
  return <UsageClient />;
}
