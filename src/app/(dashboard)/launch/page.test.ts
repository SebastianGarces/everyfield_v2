import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader } from "@/lib/testing/source-span";

// ============================================================================
// /launch — what the page must never hide (#614).
//
// SOURCE-SHAPED, because the subject is an async Server Component: rendering it
// in this process would need a session, a database and three awaited reads. The
// two claims below are wiring claims — which reads the page calls, and which
// arms its one render guard has — and the wiring is exactly what regressed.
// The BEHAVIOUR of the repair is proven against rows in
// `src/lib/launch/readiness-converge-live.test.ts`.
// ============================================================================

function launchPage() {
  return sourceReader(
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
    ),
    "launch/page.tsx"
  );
}

test("the readiness section is unhideable for a launch with a day named", () => {
  // THE BUG. The guard was `hasReadiness || history.length > 0`, and the "No
  // readiness list yet" empty state sat INSIDE it — so the one plant that
  // needed the explanation (scheduled, zero milestone rows, no history) was the
  // one plant that could never be shown it. The date card above says "The day
  // is set. Work the readiness list." over the hole.
  const page = launchPage();
  const guard = page.span(
    "{(hasReadiness ||",
    "history={<LaunchHistory entries={history} />}"
  );

  assert.match(
    guard,
    /\|\| expectsReadiness\)/,
    "a scheduled launch must reach LaunchTabs whether or not it has rows"
  );
  assert.match(
    guard,
    /readinessEmptyState\.title/,
    "the empty state's copy is decided once, above the JSX"
  );
});

test("the empty state tells a scheduled launch something different", () => {
  // "Naming Launch Sunday seeds it from the Launch Playbook" is true only
  // BEFORE a day is named. Shown to a planter who named one thirteen days ago,
  // it is advice about a step they already took, which reads as the page not
  // knowing its own state.
  const page = launchPage();
  const copy = page.span("const readinessEmptyState", "return (");

  assert.match(copy, /expectsReadiness\s*\?/);
  assert.match(
    copy,
    /Naming Launch Sunday seeds it from the Launch Playbook\./
  );
  assert.match(copy, /Reload the page to try again\./);
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
