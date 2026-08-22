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
// claim below is a wiring claim — which read the page calls — and the BEHAVIOUR
// of that read is proven against rows in
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
