/**
 * The needles of `cs013-mutation-check.ts`, checked on every PR (#681).
 *
 * The harness itself cannot live here: it rewrites checked-in files and runs a
 * suite per mutation, which is minutes of work and a manual reviewer's job. Its
 * NEEDLES are a different thing — reading twelve files and counting a substring
 * costs nothing, and it is the half that rots.
 *
 * And rot is exactly what went unnoticed. The harness has always exited 1 on a
 * needle that matches nothing, but no workflow, no package script and no hook
 * has ever invoked it, so that exit code reached no one. By the time #681 was
 * filed two needles had rotted — #676 renamed "stage" to "phase" in the copy,
 * #677 re-indented the block around another — and both mutations had quietly
 * stopped being applied. Nothing was red anywhere. A guard nobody runs is not a
 * guard, so the guard moved to where the runner already is.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { needleDrift } from "./cs013-mutation-check";

test("every cs013 mutation needle still quotes its file exactly once", () => {
  // deepEqual against [] rather than a length check: the failure output IS the
  // report — each rotted needle named, with the file it expected to match.
  assert.deepEqual(needleDrift(), []);
});
