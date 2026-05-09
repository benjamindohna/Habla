import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  interpret,
  localize,
  segment,
  type CorrectionStyle,
} from "@/lib/correctionPipeline";
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
      : await interpret(transcript, nativeLanguage);

    const local_version_es = await localize({
      intendedMeaning: interpretation.intended_meaning_native,
      transcript,
      nativeLanguage,
      style,
      task: localizeTask,
    });

    const pairs = await segment({
      transcript,
      localVersionEs: local_version_es,
      nativeLanguage,
      task: segmentTask,
      improvedPrompt: useImprovedSegmentPrompt,
    });

    const result: CorrectionResult = {
      transcript_raw: transcript,
      intended_meaning_native: interpretation.intended_meaning_native,
      local_version_es,
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
