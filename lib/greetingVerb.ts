// Picks a verb for the empty-chat greeting "¿De qué quieres ___ hoy?".
//
// Curated so each entry slots cleanly into the frame and reads as
// natural Castellano. Anything weird (chatear → registers as messaging,
// rajar → too slangy, tratar → wrong preposition) is intentionally
// left out.
//
// Rotation: last `MEMORY_SIZE` picks are excluded from the next pool
// via localStorage. State survives reloads but is per-browser; no
// server state needed for what is essentially a cosmetic touch.

const VERBS = [
  "hablar",
  "charlar",
  "conversar",
  "dialogar",
  "platicar",
  "parlotear",
  "cotillear",
  "chismorrear",
  "debatir",
  "comentar",
  "departir",
] as const;

const STORAGE_KEY = "greetingVerbRecent";
const MEMORY_SIZE = 3;

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeRecent(recent: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // quota / private mode — degraded experience, not worth surfacing.
  }
}

/** Pick a verb, excluding the last MEMORY_SIZE picks. Updates the
 *  rolling memory so the next call sees this pick as "recent". */
export function pickGreetingVerb(): string {
  const recent = readRecent();
  const pool = VERBS.filter((v) => !recent.includes(v));
  // Defensive: if MEMORY_SIZE ≥ VERBS.length the pool would be empty.
  // Falling back to the full list still rotates, just with weaker
  // memory.
  const candidates = pool.length > 0 ? pool : (VERBS as readonly string[]);
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  writeRecent([...recent, picked].slice(-MEMORY_SIZE));
  return picked;
}
