import type { SearchResult } from "./search";

// ============================================================================
// One search request, as the reader experiences it (#411 round 3)
//
// `searchWikiArticles` (`src/app/(dashboard)/wiki/actions.ts`) REFUSES BY
// THROWING: it mints an actor with `verifySession()` above everything else, so
// a caller with no session — or one whose session expired while the dialog was
// open — gets a rejected promise rather than an empty list. That refusal is
// deliberate and stays (`memory/invariants.md` → Authentication; an empty list
// would be indistinguishable from "no article matches").
//
// The dialog awaited that promise inside an async `setTimeout` callback with no
// rejection handling, which cost two things at once: an unhandled promise
// rejection, and a "Searching…" spinner that never settled — every later state
// transition sat below the `await` that rejected. The reader was left staring
// at a spinner with no way to learn that the search had refused.
//
// A rejection is not only the refusal, either: a dropped connection, a 500 from
// the action, or a deploy that invalidated the action id all reject the same
// way. So the fix is not a second return shape on the action — it is that
// EVERY search request resolves to an outcome the dialog can render. This
// function is that boundary, and it is a plain function over an injected
// `search` so the refusal path can be exercised without a browser, a session or
// a database (`search-request.test.ts`).
//
// It is deliberately NOT re-exported from `./index` — a `"use client"` dialog
// imports it, and the barrel reaches `@/db` through every other wiki module.
// ============================================================================

/**
 * What the reader is shown when a search cannot answer.
 *
 * Covers the refusal (an expired session) and the transport failures with it:
 * the dialog cannot tell them apart — a server action rejection reaches the
 * browser as an opaque digest — and reloading is the one action that helps in
 * every case, because it is what returns an expired session to `/login`.
 */
export const SEARCH_UNAVAILABLE_MESSAGE =
  "Search is unavailable. Reload the page and try again.";

/** The outcome of one search request. Never a rejection. */
export type WikiSearchOutcome =
  | { status: "results"; results: SearchResult[] }
  | { status: "unavailable" };

/** How the dialog reaches the server action. */
export type WikiSearch = (query: string) => Promise<SearchResult[]>;

/**
 * Run one search and resolve, whatever happens.
 *
 * The caught error is NOT logged here. The two things that reach this branch
 * are already recorded where they happen — the action logs a failed read and
 * Next logs the `Unauthorized` throw, both server-side — so a client log would
 * only add noise to the console the browser proof reads, for an outcome the
 * reader is now told about on screen.
 */
export async function runWikiSearch(
  search: WikiSearch,
  query: string
): Promise<WikiSearchOutcome> {
  try {
    return { status: "results", results: await search(query) };
  } catch {
    return { status: "unavailable" };
  }
}
