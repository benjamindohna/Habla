import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withRouteUsage } from "@/lib/usageContext";
import { getUserById } from "@/lib/users";
import {
  interpret,
  localizeStream,
  segment,
  type CorrectionStyle,
} from "@/lib/correctionPipeline";
import { pushRecentInput, runLevelCheckIfDue } from "@/lib/levelTracker";
import { autoSaveUnknownVocab } from "@/lib/extractUnknownVocab";
import { warmAnnotation } from "@/lib/annotate";
import type { CorrectionResult } from "@/types/correction";

/**
 * Streaming variant of /api/correct. Same pipeline, same models, same
 * side effects — but results hit the client as they materialise instead
 * of after the full 3-step chain:
 *
 *   event: interpretation    interpret done (or override echo)
 *   event: localize_delta    corrected-text token chunk (many)
 *   event: localized         corrected text complete
 *   event: result            full CorrectionResult incl. pairs
 *   event: error             terminal failure
 *
 * Wire format: newline-delimited JSON over SSE `data:` lines. Each event
 * carries `type`; step events carry `ms` (server-side step duration) so
 * the client console can attribute latency.
 *
 * Note on sequencing: localize consumes interpret's output (the intended
 * meaning IS its input for the default "natural" style), so the two steps
 * cannot run in parallel without changing what the quality-critical step
 * sees. We keep them sequential and stream instead — time-to-first-text
 * becomes interpret's latency alone.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  return withRouteUsage("/api/correct/stream", session?.userId ?? null, async () => {
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as {
      transcript?: string;
      overrideIntendedMeaning?: string;
      nativeLanguage?: string;
      style?: CorrectionStyle;
    };

    const transcript = body.transcript?.trim();
    if (!transcript) {
      return NextResponse.json({ error: "transcript required" }, { status: 400 });
    }
    const nativeLanguage = body.nativeLanguage?.trim() || "German";
    const style: CorrectionStyle =
      body.style === "transcript_aware" ? "transcript_aware" : "natural";
    const override = body.overrideIntendedMeaning?.trim();

    await pushRecentInput(session.userId, transcript);
    void runLevelCheckIfDue(session.userId);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        const t0 = Date.now();
        try {
          const interpretation = override
            ? { intended_meaning_native: override, confidence: "high" as const, notes_native: "" }
            : await interpret(transcript, nativeLanguage, user.targetLanguage);
          const tInterpret = Date.now() - t0;
          send({
            type: "interpretation",
            interpretation: interpretation.intended_meaning_native,
            confidence: interpretation.confidence,
            notes: interpretation.notes_native,
            ms: tInterpret,
          });

          const tLoc0 = Date.now();
          const local_version_target = await localizeStream({
            intendedMeaning: interpretation.intended_meaning_native,
            transcript,
            nativeLanguage,
            targetLanguage: user.targetLanguage,
            style,
            onDelta: (delta) => send({ type: "localize_delta", delta }),
          });
          const tLocalize = Date.now() - tLoc0;
          send({ type: "localized", text: local_version_target, ms: tLocalize });

          // Warm the annotation cache for the corrected sentence NOW —
          // by the time the user reads the correction and taps a word,
          // the client's /api/annotate call joins this in-flight run or
          // hits the fresh cache row.
          warmAnnotation({
            text: local_version_target,
            nativeLanguage: user.nativeLanguage,
            targetLanguage: user.targetLanguage,
          });

          const tSeg0 = Date.now();
          const pairs = await segment({
            transcript,
            localVersionTarget: local_version_target,
            nativeLanguage,
            targetLanguage: user.targetLanguage,
            task: "chat_light",
            improvedPrompt: true,
          });

          const result: CorrectionResult = {
            transcript_raw: transcript,
            intended_meaning_native: interpretation.intended_meaning_native,
            local_version_target,
            confidence: interpretation.confidence,
            notes_native: interpretation.notes_native,
            pairs,
          };
          const tSegment = Date.now() - tSeg0;
          send({ type: "result", result, ms: tSegment });
          console.log(
            `[timing] correct/stream interpret=${tInterpret}ms localize=${tLocalize}ms segment=${tSegment}ms total=${Date.now() - t0}ms`,
          );

          void autoSaveUnknownVocab({
            userId: session.userId,
            transcript,
            interpretation: interpretation.intended_meaning_native,
            localVersionTarget: local_version_target,
            nativeLanguage,
            targetLanguage: user.targetLanguage,
          });
        } catch (err) {
          console.error("[/api/correct/stream]", err);
          send({ type: "error", message: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
