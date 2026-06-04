// Who is allowed into /admin/* pages. v1 is hardcoded — there is no
// `is_admin` column on users yet and only one human is administering
// the app. When that changes:
//   - add `is_admin BOOLEAN NOT NULL DEFAULT false` to users
//   - migrate this constant to read from that column
//   - keep the env-var override as an escape hatch (so a stranded admin
//     can still get in via deploy config without a DB write)

const HARDCODED_ADMIN_EMAILS = ["benji@habla.app"];

function envAdmins(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  const lower = email.trim().toLowerCase();
  if (HARDCODED_ADMIN_EMAILS.includes(lower)) return true;
  if (envAdmins().includes(lower)) return true;
  return false;
}
