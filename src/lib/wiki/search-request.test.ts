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

const ACTIONS = path.join(
  process.cwd(),
  "src",
  "app",
  "(dashboard)",
  "wiki",
  "actions.ts"
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

test("a failed read rejects — the action never swallows one into `[]` (#411)", () => {
  // The refusal path had a second decision site, and it was the likelier one:
  // the action's own catch logged the error and returned `[]`, so a dropped
  // connection or a statement timeout resolved as `{status:"results",
  // results: []}` and the reader was told "No articles found." about a search
  // that never ran. Asserted on the source because the action reaches `@/db`
  // and cannot be imported under `tsx --test`.
  const code = codeOf(ACTIONS);

  assert.doesNotMatch(
    code,
    /catch\s*\([^)]*\)\s*\{[^}]*return\s*\[\]/,
    'the search action swallows a failed read into an empty list — the reader is then shown "No articles found." about a search that never ran, and `runWikiSearch` can never classify it unavailable (#411)'
  );
  assert.match(
    code,
    /catch\s*\([^)]*\)\s*\{[\s\S]*?throw\s+\w+;/,
    "the search action must log the failed read server-side and RETHROW, so the one shape for `could not answer` stays a rejection"
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
  // Read inside the debounced callback, not over the module: the searching
  // state is also entered above it, and an ordering anchored on the module's
  // FIRST occurrence would be an assertion about that line instead of about
  // the request.
  const body = sourceReader(codeOf(DIALOG), "wiki-search.tsx").span(
    "debounceRef.current = setTimeout",
    "}, 300);"
  );

  assertInOrder(
    body,
    "wiki-search.tsx (the debounced request)",
    ["await runWikiSearch(", "setView(", 'outcome.status === "results"'],
    "the outcome is recorded after the one await, so every request ends in a state the reader can read"
  );
  assert.doesNotMatch(
    body,
    /kind:\s*"searching"/,
    "the debounced callback re-enters the searching state — settling the request is ONE assignment, so neither outcome can leave the spinner up"
  );
});

test("the dialog holds the outcome as one state, not a fan-out of flags (#411)", () => {
  // `WikiSearchOutcome` already models the answer as a union. Decomposing it
  // into independent booleans made only four of sixteen combinations legal and
  // forced every render guard to re-establish mutual exclusion by hand — one
  // of them ("unavailable implies no results") maintained at a single call
  // site with nothing enforcing it.
  const code = codeOf(DIALOG);

  for (const flag of ["isUnavailable", "hasSearched", "isSearching"]) {
    assert.doesNotMatch(
      code,
      new RegExp(`\\b${flag}\\b`),
      `\`${flag}\` is back — the search outcome is one state (\`view\`), not a set of booleans a render guard has to recombine (#411)`
    );
  }

  const list = sourceReader(code, "wiki-search.tsx").span(
    "<CommandList",
    "</CommandList>"
  );
  // No NEGATION anywhere in the list, in either position: `X && !Y` and
  // `!X && Y` are the same failure, and the five old guards used both. An arm
  // that has to say what it is NOT is an arm the union should have excluded.
  assert.doesNotMatch(
    list,
    /!\s*[A-Za-z_$(]/,
    "a render guard negates another arm's state, so the list arms are mutually exclusive by hand rather than by construction (#411)"
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
    /view\.kind === "unavailable"/,
    "the unavailable message must be its own arm of the view union, not a combination of flags"
  );

  // The list arms are mutually exclusive, and the one that matters is that a
  // REFUSED search never renders "No articles found." — that sentence says the
  // corpus was read and holds nothing, which is a different (and false)
  // statement about a search that never ran. It is now a property of the
  // `"results"` arm rather than a negation the empty-state guard must repeat.
  const emptyState = sourceReader(code, "wiki-search.tsx").span(
    "{SEARCH_UNAVAILABLE_MESSAGE}",
    "{NO_RESULTS_MESSAGE}"
  );
  assert.match(
    emptyState,
    /view\.kind === "results" &&\s*view\.rows\.length === 0/,
    '"No articles found." must belong to the arm where a search actually ran'
  );
});

test("the dialog has ONE live region, and it outlives every arm (#411)", () => {
  // A live region is announced only when text changes INSIDE a region that was
  // already in the DOM. The three `role="status"` arms this dialog used to
  // carry were mutually exclusive, so every transition DETACHED one region and
  // mounted another — never an update — and the results arm carried none at
  // all, which left the dialog with no live region once rows rendered. The
  // refusal message this whole path exists to make legible could therefore
  // never be announced.
  const code = codeOf(DIALOG);
  const list = sourceReader(code, "wiki-search.tsx").span(
    "<CommandList",
    "</CommandList>"
  );

  const regions = list.match(/role="status"/g) ?? [];
  assert.equal(
    regions.length,
    1,
    "the dialog must hold exactly one live region: a per-arm region is mounted and unmounted rather than updated, so nothing is ever announced"
  );

  // And that one region must be UNCONDITIONAL — a region rendered behind a
  // guard is the same mount/unmount failure with a smaller blast radius.
  const region = sourceReader(list, "wiki-search.tsx").span(
    '<div role="status"',
    "</div>"
  );
  assert.doesNotMatch(
    region,
    /view\.kind/,
    "the live region is rendered per-arm again; its TEXT is what varies with `view`, not whether it exists"
  );
  assert.match(
    region,
    /announcementFor\(view\)/,
    "the live region must derive its sentence from the view union, so every outcome has one"
  );

  // Every arm of the union answers, so no outcome is silent. `announcementFor`
  // is exhaustive by `switch` over the union; this pins the two that a reader
  // can otherwise miss entirely.
  const announcer = sourceReader(code, "wiki-search.tsx").span(
    "function announcementFor",
    "export function WikiSearch"
  );
  assert.match(
    announcer,
    /case "unavailable":\s*return SEARCH_UNAVAILABLE_MESSAGE;/
  );
  assert.match(announcer, /case "results":/);
});
