"use server";

import { verifySession } from "@/lib/auth";
import { searchArticles, type SearchResult } from "@/lib/wiki";

/**
 * Server action to search wiki articles
 *
 * The church is read off the SESSION, never taken as an argument: an entity
 * implied by the actor is not a parameter (`memory/invariants.md` →
 * Authentication), and every export of a `"use server"` module is a public POST
 * endpoint — a caller-supplied church here would be a cross-tenant read.
 *
 * IT MINTS FIRST, ABOVE THE GUARDS AND ABOVE THE `try` (#411 round 2). An
 * earlier version read the session with `getCurrentSession()` INSIDE the try
 * and served a sessionless caller the global corpus, on the reasoning that the
 * global wiki is not secret. Two things make that the wrong call and neither is
 * about the content: `src/proxy.ts` only redirects unauthenticated callers when
 * `request.method === "GET"`, so a POST to /wiki with no session cookie reached
 * this export directly — an anonymous, un-rate-limited full-text query endpoint
 * over the corpus, with no UI in front of it. And the crawler allowance buys
 * "the unauthenticated shell, never a session and never per-user data"; the
 * shell renders `WikiSearchTrigger`, a client dialog that calls this only from
 * a keystroke handler, so no render path — crawler or otherwise — needs a
 * sessionless answer. `verifySession()` throws `Unauthorized` above the `try`
 * so that throw is not converted into an empty result list.
 *
 * SO THIS EXPORT REFUSES BY REJECTING, AND EVERY CALLER MUST HANDLE THAT
 * (#411 round 3). The dialog awaited it bare inside an async `setTimeout`: an
 * unhandled rejection, and a "Searching…" spinner that never settled because
 * the state transitions below the `await` never ran. The refusal shape is not
 * what changed — an empty list would be indistinguishable from "no article
 * matches", and a rejection is what a dropped connection produces anyway — so
 * the call goes through `runWikiSearch` (`src/lib/wiki/search-request.ts`),
 * which turns every request into an outcome the reader is shown. Call this
 * from a new place and route it through there too.
 *
 * A FAILED READ REJECTS TOO, AND THAT IS THE SAME RULE (#411 round 4). The
 * catch below logged the error and returned `[]`, so a dropped Neon
 * connection, a statement timeout or a Postgres error out of
 * `websearch_to_tsquery` resolved as an EMPTY RESULT LIST — `runWikiSearch`
 * classified it `{status:"results", results: []}` and the reader was told "No
 * articles found." about a search that never ran. That is the one outcome the
 * whole refusal path exists to avoid, arriving through the failure that is by
 * far the most likely. The catch stays, because the server-side log is worth
 * keeping and it is the only place with the real error, but it RETHROWS: this
 * export has exactly one shape for "could not answer", and it is a rejection.
 */
export async function searchWikiArticles(
  query: string
): Promise<SearchResult[]> {
  const { user } = await verifySession();

  // Basic input validation
  if (!query || typeof query !== "string") {
    return [];
  }

  // Limit query length to prevent abuse
  const sanitizedQuery = query.slice(0, 200).trim();

  if (!sanitizedQuery) {
    return [];
  }

  try {
    return await searchArticles(sanitizedQuery, user.churchId ?? null);
  } catch (error) {
    console.error("Wiki search error:", error);
    // Never `return []` here: see the docblock. An empty list is the answer to
    // "nothing matches those words", not to "the read failed".
    throw error;
  }
}
