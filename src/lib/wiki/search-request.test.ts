import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { codeOf } from "@/lib/auth/server-action-surface";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

import {
  SEARCH_UNAVAILABLE_MESSAGE,
  runWikiSearch,
  type WikiSearch,
} from "./search-request";
import type { SearchResult } from "./search";

// ----------------------------------------------------------------------------
// The search REFUSAL path (#411 round 3).
//
// `searchWikiArticles` refuses by throwing — `verifySession()` above everything
// else, so a POST with no session cookie and a session that expired while the
// dialog was open both reject rather than being served the corpus. The dialog
// awaited that promise inside an async `setTimeout` callback with no rejection
// handling, which is a CRITICAL two ways over:
//
//   1. an unhandled promise rejection, and
//   2. a "Searching…" spinner that never settles, because every state
//      transition in that callback sits BELOW the `await` that rejected. The
//      reader is left with a spinner and no way to learn the search refused.
//
// The refusal itself is unchanged (the action still mints first and still
// throws). What changed is that the dialog no longer awaits it bare: every
// request goes through `runWikiSearch`, which resolves to an OUTCOME.
//
// Two halves are asserted here. The outcome function is exercised directly —
// this is the refusal path, run rather than reasoned about. The wiring is
// asserted on the SOURCE, because the dialog is a `"use client"` component
// whose debounce and dialog cannot be driven under `tsx --test`; the anchors go
// through `src/lib/testing/source-span.ts`, so an anchor that moves throws
// instead of quietly asserting about the empty string.
//
// The browser half — trigger the refusal, watch the spinner settle, console
// clean — is proved on the branch's Vercel preview (`.claude/skills/
// validate-frontend`).
// ----------------------------------------------------------------------------

const DIALOG = path.join(
  process.cwd(),
  "src",
  "components",
  "wiki",
  "wiki-search.tsx"
);

function result(slug: string): SearchResult {
  return {
    id: slug,
    slug,
    title: slug,
    excerpt: null,
    phase: null,
    contentType: "reference",
    sectionId: null,
    readTimeMinutes: null,
    rank: 1,
  };
}

// ============================================================================
// 1. The outcome — a request always resolves
// ============================================================================

test("a refused search resolves as unavailable, it does not reject (#411)", async () => {
  // The exact refusal: `verifySession()` throwing `Unauthorized` out of the
  // server action. Awaiting this bare inside the debounce callback was the
  // unhandled rejection AND the stuck spinner.
  const refuse: WikiSearch = async () => {
    throw new Error("Unauthorized");
  };

  const outcome = await runWikiSearch(refuse, "elders");

  assert.deepEqual(outcome, { status: "unavailable" });
});

test("a request that fails any other way resolves the same (#411)", async () => {
  // A dropped connection, a 500 out of the action, or a deploy that invalidated
  // the action id all reject too — and a server action rejection reaches the
  // browser as an opaque digest, so the dialog cannot tell them apart. A second
  // return shape on the action would therefore not have closed this: the
  // handling has to be at the call, and it has to cover a non-Error throw.
  assert.deepEqual(
    await runWikiSearch(async () => {
      throw "boom";
    }, "elders"),
    { status: "unavailable" }
  );

  assert.deepEqual(
    await runWikiSearch(
      () => Promise.reject(new Error("Failed to fetch")),
      "e"
    ),
    { status: "unavailable" }
  );
});

test("a successful search resolves with its rows, unchanged", async () => {
  const rows = [result("discovery/a"), result("discovery/b")];

  assert.deepEqual(await runWikiSearch(async () => rows, "elders"), {
    status: "results",
    results: rows,
  });
});

test("no results is a RESULT, never the unavailable outcome", async () => {
  // The two say different things to the reader — "nothing matches those words"
  // against "the search could not run" — and collapsing them is what an
  // action that returned `[]` on refusal would have done.
  assert.deepEqual(await runWikiSearch(async () => [], "zzz"), {
    status: "results",
    results: [],
  });
});

test("the unavailable message tells the reader what to do", () => {
  assert.ok(SEARCH_UNAVAILABLE_MESSAGE.trim().length > 0);
  assert.match(
    SEARCH_UNAVAILABLE_MESSAGE,
    /reload/i,
    "the refusal a reader actually meets is an expired session, and reloading is what returns them to /login"
  );
});

// ============================================================================
// 2. The wiring — the dialog never awaits the action bare
// ============================================================================

test("the dialog routes every search through the outcome boundary (#411)", () => {
  const code = codeOf(DIALOG);

  assert.match(
    code,
    /runWikiSearch\(\s*searchWikiArticles\s*,/,
    "the dialog no longer hands the server action to `runWikiSearch`"
  );
  assert.doesNotMatch(
    code,
    /await\s+searchWikiArticles\(/,
    "the dialog awaits the server action bare again — its refusal is an unhandled rejection and the spinner never settles (#411)"
  );
});

test("the debounced request has exactly one await, and it cannot reject (#411)", () => {
  // The stuck spinner was structural, not a missing `finally`: the callback's
  // only `await` rejected, so `setIsSearching(false)` below it never ran. What
  // keeps that closed is that the callback awaits ONE thing and that thing
  // resolves for every input. A second bare `await` in here would reopen it.
  const body = sourceReader(codeOf(DIALOG), "wiki-search.tsx").span(
    "debounceRef.current = setTimeout",
    "}, 300);"
  );

  const awaits = body.match(/await\s+[A-Za-z_$][\w$]*\(/g) ?? [];
  assert.deepEqual(
    awaits,
    ["await runWikiSearch("],
    "the debounced search awaits something other than the outcome boundary"
  );
});

test("the spinner settles on both outcomes (#411)", () => {
  // Read inside the debounced callback, not over the module: `setIsSearching(
  // false)` also appears in the empty-query branch above it, and an ordering
  // anchored on the module's FIRST occurrence would be an assertion about that
  // branch instead of about the request.
  const body = sourceReader(codeOf(DIALOG), "wiki-search.tsx").span(
    "debounceRef.current = setTimeout",
    "}, 300);"
  );

  assertInOrder(
    body,
    "wiki-search.tsx (the debounced request)",
    [
      "await runWikiSearch(",
      "setIsUnavailable(outcome.status",
      "setIsSearching(false)",
    ],
    "the outcome is recorded and the searching state is cleared after the one await, so every request ends in a state the reader can read"
  );
});

test("the dialog renders the unavailable outcome (#411)", () => {
  const code = codeOf(DIALOG);

  assert.match(
    code,
    /\{SEARCH_UNAVAILABLE_MESSAGE\}/,
    "nothing renders the unavailable outcome, so a refused search still shows the reader an empty box"
  );
  assert.match(
    code,
    /!isSearching &&\s+isUnavailable/,
    "the unavailable message must be shown only once the spinner has stopped"
  );

  // The three list states are mutually exclusive, and the one that matters is
  // that a REFUSED search never renders "No articles found." — that sentence
  // says the corpus was read and holds nothing, which is a different (and
  // false) statement about a search that never ran.
  const emptyState = sourceReader(code, "wiki-search.tsx").span(
    "{SEARCH_UNAVAILABLE_MESSAGE}",
    "No articles found."
  );
  assert.match(
    emptyState,
    /!isUnavailable/,
    '"No articles found." must not be shown for a search that never ran'
  );
});
