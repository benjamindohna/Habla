// Picks a verb for the empty-chat greeting "¿De qué quieres ___ hoy?"
// (or the French equivalent). The verb list and frame come from the
// per-language data table in promptExamples.ts; only the rotation
// state (last `MEMORY_SIZE` picks) is held here.
//
// Rotation memory survives reloads via localStorage. Per-language key
// so switching languages mid-session doesn't bleed Spanish "recent"
// picks into the French pool or vice versa.

import { getPromptExamples } from "./promptExamples";
import type { TargetLanguageSpec } from "./targetLanguage";

const STORAGE_KEY_PREFIX = "greetingVerbRecent:";
const MEMORY_SIZE = 3;

function storageKey(spec: TargetLanguageSpec): string {
  return `${STORAGE_KEY_PREFIX}${spec.language}`;
}

function readRecent(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeRecent(key: string, recent: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(recent));
  } catch {
    // quota / private mode — degraded experience, not worth surfacing.
  }
}

/**
 * Pick a verb for the given target language, excluding the last
 * MEMORY_SIZE picks for THAT language. Updates the rolling memory so
 * the next call sees this pick as "recent".
 */
export function pickGreetingVerb(targetLanguage: TargetLanguageSpec): string {
  const verbs = getPromptExamples(targetLanguage).greetingVerbs;
  const key = storageKey(targetLanguage);
  const recent = readRecent(key);
  const pool = verbs.filter((v) => !recent.includes(v));
  const candidates = pool.length > 0 ? pool : verbs;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  writeRecent(key, [...recent, picked].slice(-MEMORY_SIZE));
  return picked;
}

/**
 * Convenience: pick a verb AND render the full greeting using the
 * per-language frame. Returns e.g. "Hola, ¿de qué quieres charlar hoy?"
 * or "Salut, de quoi veux-tu papoter aujourd'hui ?".
 */
export function pickGreeting(targetLanguage: TargetLanguageSpec): { verb: string; sentence: string } {
  const verb = pickGreetingVerb(targetLanguage);
  const sentence = getPromptExamples(targetLanguage).greetingFrame(verb);
  return { verb, sentence };
}
