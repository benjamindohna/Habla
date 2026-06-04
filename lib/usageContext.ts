// Request-scoped context for the LLM-usage logger. Set at the top of a
// route handler via withRouteUsage(route, userId, fn); the logger in
// lib/llm.ts reads from it via getUsageContext() and tags each
// llm_usage row accordingly.
//
// Why AsyncLocalStorage and not "pass userId through every chat call":
// the chat helpers live in ~15 lib/* files (vocabExplain, generateTopics,
// aiBubblePipeline, …). Threading userId through every one of them
// touches a lot of code and noises up internal APIs. With ALS, each
// route does a one-line wrap and the LLM layer figures it out itself.
// In Node runtime (which is where every LLM-calling route runs), ALS
// propagates across await boundaries cleanly. Edge runtime would NOT
// work — but our LLM-using routes are all Node.
//
// IMPORTANT: this file deliberately does NOT import lib/auth (which
// uses next/headers). Doing so triggers Next.js' production build to
// trace the dependency into contexts where next/headers isn't allowed,
// breaking the build. Each route calls getSession itself and passes
// the userId to withRouteUsage explicitly.

import { AsyncLocalStorage } from "node:async_hooks";

export interface UsageContext {
  userId: number | null;
  /** HTTP route or script identifier, e.g. "/api/converse/turn" or
   *  "scripts/backfillVocabAssets.ts". Used only for telemetry, never
   *  for logic. */
  route: string;
}

const storage = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getUsageContext(): UsageContext | null {
  return storage.getStore() ?? null;
}

/**
 * Convenience for API routes: tag the usage context with a route name
 * and the caller's userId, then run the handler inside that context.
 * The userId is the caller's responsibility (a quick `await getSession()`
 * before the wrapper; pass `session?.userId ?? null`).
 */
export function withRouteUsage<T>(
  route: string,
  userId: number | null,
  fn: () => Promise<T>,
): Promise<T> {
  return withUsageContext({ userId, route }, fn);
}
