// Adaptive level tracker. See file-history for the firing rules
// (6h cooldown + ≥3-new-sample gate, ring of last 5 inputs).

import { db } from "./db";
import { users } from "./schema";
import { eq, sql } from "drizzle-orm";
import { chatJSON } from "./llm";
import { describeLevelScaleCompact, getLevelRange } from "./levels";
import { parseTargetLanguageSpec } from "./targetLanguage";

const MAX_RECENT_INPUTS = 5;
const COOLDOWN_SECONDS = 6 * 60 * 60;
const MIN_NEW_SAMPLES = 3;
const MAX_LEVEL_STEP = 3;

export async function pushRecentInput(userId: number, transcript: string): Promise<void> {
  const trimmed = transcript.trim();
  if (!trimmed) return;

  const rows = await db
    .select({ recent_inputs_json: users.recentInputsJson })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (rows.length === 0) return;

  let inputs: string[];
  try {
    const parsed = JSON.parse(rows[0].recent_inputs_json);
    inputs = Array.isArray(parsed) ? (parsed.filter((s) => typeof s === "string") as string[]) : [];
  } catch {
    inputs = [];
  }

  inputs.push(trimmed);
  if (inputs.length > MAX_RECENT_INPUTS) {
    inputs = inputs.slice(inputs.length - MAX_RECENT_INPUTS);
  }

  await db
    .update(users)
    .set({
      recentInputsJson: JSON.stringify(inputs),
      samplesSinceLastCheck: sql`${users.samplesSinceLastCheck} + 1`,
    })
    .where(eq(users.id, userId));
}

export async function runLevelCheckIfDue(userId: number): Promise<void> {
  const rows = await db
    .select({
      level: users.level,
      native_language: users.nativeLanguage,
      target_language_json: users.targetLanguageJson,
      recent_inputs_json: users.recentInputsJson,
      last_level_check_at: users.lastLevelCheckAt,
      samples_since_last_check: users.samplesSinceLastCheck,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (rows.length === 0) return;
  const row = rows[0];
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
  const clamped = Math.max(
    Math.max(1, currentLevel - MAX_LEVEL_STEP),
    Math.min(Math.min(100, currentLevel + MAX_LEVEL_STEP), Math.round(raw)),
  );

  await db
    .update(users)
    .set({ level: clamped, lastLevelCheckAt: now, samplesSinceLastCheck: 0 })
    .where(eq(users.id, userId));

  if (clamped !== currentLevel) {
    console.log(
      `[level/check] user ${userId}: ${currentLevel} → ${clamped} (reason: ${result.reasoning ?? "—"})`,
    );
  }
}
