// Request-scoped context for the LLM-usage logger. Set at the top of a
// route handler via withUsageContext({ userId, route }, fn); the logger
// in lib/llm.ts reads from it via getUsageContext() and tags each
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
 * Convenience for API routes: looks up the session and runs the handler
 * inside a usage context tagged with the resolved userId and the given
 * route path. Routes that don't require auth can pass `requireAuth: false`
 * and handle the null-session case themselves; the wrapper still tags
 * the context so the usage row gets the route name. Anything thrown
 * inside `fn` propagates up unchanged.
 */
export async function withRouteUsage<T>(
  route: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Lazy import to avoid pulling auth machinery into non-API contexts.
  const { getSession } = await import("./auth");
  const session = await getSession();
  return withUsageContext(
    { userId: session?.userId ?? null, route },
    fn,
  );
}
