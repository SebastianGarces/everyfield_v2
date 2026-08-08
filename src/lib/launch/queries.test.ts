import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ============================================================================
// Launch reads — the header's promise, made checkable.
//
// `queries.ts` opens with "Every read is church_id-scoped". It was not true:
// `getLaunchJournal(launchId)` and `getLaunchMilestones(launchId)` took bare
// ids, and the second had no caller at all. Neither was exploitable — every
// caller resolved the id through `getLaunchForChurch(session.churchId)` — but a
// barrel-exported helper taking a bare uuid under a header promising otherwise
// is a trap for the next caller, who will read the header and not the
// signature.
//
// The dead one is gone; the other is scoped. This scans the SOURCE because the
// property is about the module's SHAPE, and because a drizzle query builder
// cannot be inspected without executing it.
// ============================================================================

const QUERIES_PATH = path.join(process.cwd(), "src/lib/launch/queries.ts");
const LAUNCH_DIR = path.join(process.cwd(), "src", "lib", "launch");

function source(file = QUERIES_PATH): string {
  return readFileSync(file, "utf8");
}

/** Comments stripped: every rule here is also EXPLAINED here. */
function code(file = QUERIES_PATH): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

test("every read takes the church it is scoped to", () => {
  const signatures = [
    ...code().matchAll(/export async function (\w+)\(([^)]*)\)/g),
  ];
  assert.ok(signatures.length >= 3, "found no exported reads to scan");
  for (const [, name, params] of signatures) {
    assert.match(
      params,
      /churchId/,
      `${name} takes no church id, but the file's header promises one`
    );
  }
});

test("the journal read filters on church_id, not only on launch_id", () => {
  // A launch id is a uuid a caller could hold from anywhere. `and(launchId,
  // churchId)` costs nothing on top of the same index lookup and makes the
  // header true.
  assert.match(code(), /eq\(launchEvents\.launchId, launchId\)/);
  assert.match(code(), /eq\(launchEvents\.churchId, churchId\)/);
});

test("the dead milestone read is gone, barrel included", () => {
  // `getLaunchMilestones` had no caller. `getLaunchReadiness` (milestones.ts) is
  // the one milestone read, and it is scoped by launch AND church.
  assert.doesNotMatch(code(), /getLaunchMilestones/);
  assert.doesNotMatch(
    code(path.join(LAUNCH_DIR, "index.ts")),
    /getLaunchMilestones/
  );
});
