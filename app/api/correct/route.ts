import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import {
  interpret,
  localize,
  segment,
  type CorrectionStyle,
} from "@/lib/correctionPipeline";
import { pushRecentInput, runLevelCheckIfDue } from "@/lib/levelTracker";
import type { CorrectionResult } from "@/types/correction";

/**
 * Single orchestrator for the correction pipeline. The client posts the raw
 * transcript (already from /api/transcribe) plus the user's preferences and
 * receives the full CorrectionResult — no further round-trips needed.
 *
 * `overrideIntendedMeaning` skips the interpret step: used when the user
 * manually edits the "What I think you tried to say" line and asks for a
 * fresh correction against their own interpretation.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const user = getUserById(session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    transcript?: string;
    overrideIntendedMeaning?: string;
    nativeLanguage?: string;
    style?: CorrectionStyle;
    /** Test-only flags from /playground/correct-test: per-step model
     *  override. Default false → production (chat_precise / gpt-4o). */
    localizeMini?: boolean;
    segmentMini?: boolean;
    /** Test-only flag: use the consolidated V2 segment prompt
     *  (coverage-invariants first, more diverse worked examples).
     *  Default false → V1 (production-stable). */
    improvedSegmentPrompt?: boolean;
  };

  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json({ error: "transcript required" }, { status: 400 });
  }
  const nativeLanguage = body.nativeLanguage?.trim() || "German";

  // Adaptive level tracker: push the raw transcript into the user's
  // FIFO ring of last 5 inputs, then fire-and-forget the cadence check
  // (no-op unless 5 inputs are present and >24h since last check).
  pushRecentInput(session.userId, transcript);
  void runLevelCheckIfDue(session.userId);
  const style: CorrectionStyle = body.style === "transcript_aware" ? "transcript_aware" : "natural";
  const override = body.overrideIntendedMeaning?.trim();

  // Production defaults (when client doesn't send the flag):
  //   localize → chat_precise (4o) — needed for accurate target-language output
  //   segment  → chat_light (mini) — counter-intuitively better at clean alignment
  // Playground sends explicit booleans via its toggles, those win.
  const localizeTask = body.localizeMini === true ? "chat_light" : "chat_precise";
  const segmentTask = body.segmentMini === false ? "chat_precise" : "chat_light";
  // Default V2 segment prompt — V1 only when client explicitly opts out.
  const useImprovedSegmentPrompt = body.improvedSegmentPrompt !== false;

  try {
    const interpretation = override
      ? { intended_meaning_native: override, confidence: "high" as const, notes_native: "" }
      : await interpret(transcript, nativeLanguage, user.targetLanguage);

    const local_version_target = await localize({
      intendedMeaning: interpretation.intended_meaning_native,
      transcript,
      nativeLanguage,
      targetLanguage: user.targetLanguage,
      style,
      task: localizeTask,
    });

    const pairs = await segment({
      transcript,
      localVersionTarget: local_version_target,
      nativeLanguage,
      targetLanguage: user.targetLanguage,
      task: segmentTask,
      improvedPrompt: useImprovedSegmentPrompt,
    });

    const result: CorrectionResult = {
      transcript_raw: transcript,
      intended_meaning_native: interpretation.intended_meaning_native,
      local_version_target,
      confidence: interpretation.confidence,
      notes_native: interpretation.notes_native,
      pairs,
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/correct]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
