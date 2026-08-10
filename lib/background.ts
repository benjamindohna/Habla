// Fire-and-forget that survives serverless response freeze.
//
// On Vercel, a function instance is frozen the moment the response
// finishes — plain `void somePromise` background work is killed
// mid-flight. Observed in prod: vocab rows saved without their
// translation/TTS assets, unranked relevance sentinels. @vercel/
// functions' waitUntil registers the promise with the platform so the
// instance stays alive until it settles. Locally (next dev / node
// scripts) there is no platform context — we fall back to plain void.
//
// Use this for EVERY background job started from a route handler:
// asset generation, vocab extraction, annotation warm-up, level checks.

import { waitUntil } from "@vercel/functions";

export function runInBackground(job: Promise<unknown>, label: string): void {
  const guarded = job.catch((err) => {
    console.warn(`[background] ${label} failed:`, (err as Error).message);
  });
  try {
    waitUntil(guarded);
  } catch {
    // No request context (local dev, scripts, tests) — plain
    // fire-and-forget is fine there because the process lives on.
    void guarded;
  }
}
