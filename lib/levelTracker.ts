// Adaptive level tracker.
//
// pushRecentInput   — FIFO push of a raw STT transcript into the user's
//                     last-5 ring. Also bumps a per-user counter of
//                     samples produced since the last successful level
//                     check (samples_since_last_check). Called from
//                     /api/correct as the user submits a turn.
// runLevelCheckIfDue — fire-and-forget cadence check. The check fires
//                     when ALL of these hold:
//                       • ring is full (5 samples present)
//                       • last_level_check_at is NULL OR ≥6h old (cooldown)
//                       • samples_since_last_check ≥ 3 (gate)
//                     On success: level is reassessed (max ±3 step),
//                     last_level_check_at is touched, and the counter
//                     is reset to 0 so the next 6h window starts fresh.
//
// Sequencing intuition: if the user crams a lot of speech into the 6h
// cooldown window, no check fires until the wall-clock crosses 6h —
// then the very next qualifying input causes the check. If the user
// dribbles 2 samples in 6h and only does the 3rd a day later, the
// check fires on that 3rd sample regardless of the now-long gap.

import { getDb } from "./db";
import { chatJSON } from "./llm";
import { describeLevelScaleCompact, getLevelRange } from "./levels";
import { parseTargetLanguageSpec } from "./targetLanguage";

const MAX_RECENT_INPUTS = 5;
const COOLDOWN_SECONDS = 6 * 60 * 60; // 6 hours between checks
const MIN_NEW_SAMPLES = 3; // gate: at least 3 fresh samples since last check
const MAX_LEVEL_STEP = 3;

interface LevelCheckRow {
  level: number;
  native_language: string;
  target_language_json: string;
  recent_inputs_json: string;
  last_level_check_at: number | null;
  samples_since_last_check: number;
}

/**
 * Pushes the raw transcript into the user's last-5 ring and bumps the
 * "samples since last check" counter. Atomic read-modify-write; safe
 * across concurrent /api/correct calls.
 */
export function pushRecentInput(userId: number, transcript: string): void {
  const trimmed = transcript.trim();
  if (!trimmed) return;

  const db = getDb();
  const row = db
    .prepare("SELECT recent_inputs_json FROM users WHERE id = ?")
    .get(userId) as { recent_inputs_json: string } | undefined;
  if (!row) return;

  let inputs: string[];
  try {
    const parsed = JSON.parse(row.recent_inputs_json);
    inputs = Array.isArray(parsed) ? (parsed.filter((s) => typeof s === "string") as string[]) : [];
  } catch {
    inputs = [];
  }

  inputs.push(trimmed);
  if (inputs.length > MAX_RECENT_INPUTS) {
    inputs = inputs.slice(inputs.length - MAX_RECENT_INPUTS);
  }

  db.prepare(
    `UPDATE users
       SET recent_inputs_json       = ?,
           samples_since_last_check = samples_since_last_check + 1
     WHERE id = ?`,
  ).run(JSON.stringify(inputs), userId);
}

/**
 * Checks whether the user is due for a level reassessment and runs it
 * if so. Safe to call as fire-and-forget — caller never awaits and
 * errors are swallowed.
 *
 * Due conditions (ALL must hold):
 *   • ring is full (5 samples present)
 *   • cooldown elapsed: last_level_check_at IS NULL or ≥COOLDOWN_SECONDS old
 *   • gate met: samples_since_last_check ≥ MIN_NEW_SAMPLES
 *
 * On a successful check we reset samples_since_last_check = 0 and
 * stamp last_level_check_at so the next 6h window starts fresh.
 */
export async function runLevelCheckIfDue(userId: number): Promise<void> {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT level, native_language, target_language_json, recent_inputs_json, last_level_check_at, samples_since_last_check FROM users WHERE id = ?",
    )
    .get(userId) as LevelCheckRow | undefined;
  if (!row) return;
  const targetLanguage = parseTargetLanguageSpec(row.target_language_json);
  const targetName = targetLanguage.language;

  let inputs: string[];
  try {
    const parsed = JSON.parse(row.recent_inputs_json);
    inputs = Array.isArray(parsed) ? (parsed.filter((s) => typeof s === "string") as string[]) : [];
  } catch {
    return;
  }
  if (inputs.length < MAX_RECENT_INPUTS) return;

  const now = Math.floor(Date.now() / 1000);
  if (row.last_level_check_at !== null && now - row.last_level_check_at < COOLDOWN_SECONDS) {
    return;
  }

  if (row.samples_since_last_check < MIN_NEW_SAMPLES) return;

  const currentLevel = row.level;
  const range = getLevelRange(currentLevel, targetLanguage);
  const prompt = `You are evaluating a language learner's proficiency level.

The learner is studying ${targetName}; their native language is ${row.native_language}.

LEVEL SCALE (1-100):
${describeLevelScaleCompact(targetLanguage)}

Their CURRENT level: ${currentLevel}/100 — range ${range.min}-${range.max} (${range.cefr}, "${range.short}").

Their last ${MAX_RECENT_INPUTS} raw speech-to-text inputs in ${targetName} (verbatim transcripts, may contain ${row.native_language} fallback or errors):
${inputs.map((t, i) => `${i + 1}. "${t}"`).join("\n")}

Looking at vocabulary range, grammar complexity, tense usage, native-language fallback density, and error patterns, decide whether the current level (${currentLevel}) accurately reflects this learner's production ability.

Rules:
- Be CONSERVATIVE. Move at most ±${MAX_LEVEL_STEP} from the current level.
- Move UP only if multiple inputs show clear proficiency AT or ABOVE the current level — sustained complexity, low error rate, minimal native fallback.
- Move DOWN if multiple inputs show heavy native-language fallback, errors below the current level, or vocabulary far below the current range.
- If signal is mixed, single inputs are uncharacteristic, or evidence is weak, KEEP the level (return ${currentLevel}).

Return ONLY valid JSON:
{
  "new_level": <integer 1-100, within ${Math.max(1, currentLevel - MAX_LEVEL_STEP)}-${Math.min(100, currentLevel + MAX_LEVEL_STEP)}>,
  "reasoning": "<one short English sentence>"
}`;

  let result: { new_level?: number; reasoning?: string };
  try {
    result = await chatJSON<{ new_level?: number; reasoning?: string }>({
      task: "chat_light",
      label: "level/check",
      systemPrompt: prompt,
      temperature: 0,
    });
  } catch (err) {
    console.warn("[level/check] LLM call failed:", err);
    return;
  }

  const raw = typeof result.new_level === "number" && Number.isFinite(result.new_level) ? result.new_level : currentLevel;
  // Clamp to ±MAX_LEVEL_STEP and the 1-100 bounds.
  const clamped = Math.max(
    Math.max(1, currentLevel - MAX_LEVEL_STEP),
    Math.min(Math.min(100, currentLevel + MAX_LEVEL_STEP), Math.round(raw)),
  );

  db.prepare(
    `UPDATE users
       SET level                    = ?,
           last_level_check_at      = ?,
           samples_since_last_check = 0
     WHERE id = ?`,
  ).run(clamped, now, userId);

  if (clamped !== currentLevel) {
    console.log(
      `[level/check] user ${userId}: ${currentLevel} → ${clamped} (reason: ${result.reasoning ?? "—"})`,
    );
  }
}
