import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { launchStatuses } from "@/db/schema/launch";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

// ============================================================================
// /launch — what the page must never hide, and what it must never claim (#614).
//
// SOURCE-SHAPED, because the subject is an async Server Component: rendering it
// in this process would need a session, a database and three awaited reads. The
// claims below are wiring and copy claims, and the wiring is exactly what
// regressed. The BEHAVIOUR of the repair is proven against rows in
// `src/lib/launch/readiness-converge-live.test.ts`.
//
// EVERY MATCH RUNS ON STRIPPED SOURCE. This page's own comments discuss the
// things these tests forbid — "the plain read", `launchExpectsReadiness` — so a
// reader over the raw file would fail on a sentence rather than on code, which
// is the trap `stripComments` exists for.
// ============================================================================

function launchPage() {
  return sourceReader(
    stripComments(
      readFileSync(
        path.join(
          process.cwd(),
          "src",
          "app",
          "(dashboard)",
          "launch",
          "page.tsx"
        ),
        "utf8"
      )
    ),
    "launch/page.tsx (stripped)"
  );
}

test("the readiness section is unhideable once a day is named", () => {
  // THE BUG. The guard was `hasReadiness || history.length > 0`, and the "No
  // readiness list yet" empty state sat INSIDE it — so the one plant that
  // needed the explanation (scheduled, zero milestone rows, no history) was the
  // one plant that could never be shown it. The date card above says "The day
  // is set. Work the readiness list." over the hole.
  const guard = launchPage().span(
    "{(hasReadiness ||",
    "history={<LaunchHistory entries={history} />}"
  );

  assert.match(
    guard,
    /\|\| dayIsNamed\)/,
    "a launch with a day must reach LaunchTabs whether or not it has rows"
  );
  assert.match(
    guard,
    /READINESS_EMPTY_STATE\[status\]/,
    "the empty state is read off the status, not off a boolean"
  );
});

test("the guard asks whether a day is named, not whether to seed", () => {
  // The two questions part company on `completed`: a day was named and nothing
  // should be seeded. Reusing `launchExpectsReadiness` here answered the seeding
  // question and left a launched plant either hiding its tabs or being told to
  // name a day it had already launched on.
  const page = launchPage();

  assert.match(page.code, /const dayIsNamed = status !== "planning";/);
  assert.doesNotMatch(
    page.code,
    /launchExpectsReadiness/,
    "the seed predicate is not the page's question"
  );
});

test("every status has its own honest empty-state sentence", () => {
  // A TOTAL MAP, so a fifth status cannot inherit a fourth's copy. The two
  // claims are that the map is total and that only the statuses the converge
  // actually retries for promise a retry.
  const copy = launchPage().span(
    "const READINESS_EMPTY_STATE",
    "export const metadata"
  );

  for (const status of launchStatuses) {
    assert.match(
      copy,
      new RegExp(`\\b${status}: \\{`),
      `${status} has no copy`
    );
  }
  assert.match(copy, /satisfies Record<LaunchStatus/);

  const retryPromises = copy.match(/Reload the page to try again\./g) ?? [];
  assert.equal(
    retryPromises.length,
    2,
    "only `scheduled` and `postponed` may promise a retry — they are the only two the converge tries for"
  );
  assert.match(
    copy,
    /Naming Launch Sunday seeds it from the Launch Playbook\./
  );
  assert.match(copy, /No readiness list was kept for this launch/);
});

test("the page reads readiness through the converging read", () => {
  // `getLaunchReadiness` is the plain read and stays the dashboard's. This page
  // is the one that must repair what it finds, so a change back to the plain
  // read here would restore the stranded state with no test to say so.
  const page = launchPage();

  assert.match(page.code, /convergeLaunchReadiness\(launch, user\.id\)/);
  assert.doesNotMatch(page.code, /getLaunchReadiness\(/);

  // The write during render is legal only because nothing caches this render.
  assert.match(page.code, /export const dynamic = "force-dynamic";/);
});
