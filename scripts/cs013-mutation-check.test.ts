/**
 * The needles of `cs013-mutation-check.ts`, checked on every PR (#681).
 *
 * The harness itself cannot live here: it rewrites checked-in files and runs a
 * suite per mutation, which is minutes of work and a manual reviewer's job. Its
 * NEEDLES are a different thing — reading twelve files and counting a substring
 * costs milliseconds, and it is the half that rots. `needleDrift()` carries the
 * account of why that had to move here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { needleDrift } from "./cs013-mutation-check";

test("every cs013 mutation needle still quotes its file exactly once", () => {
  // deepEqual against [] rather than a length check: the failure output IS the
  // report — each rotted needle named, with the file it expected to match.
  assert.deepEqual(needleDrift(), []);
});
