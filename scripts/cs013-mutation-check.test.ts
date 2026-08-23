/**
 * The targets of `cs013-mutation-check.ts`, checked on every PR (#681).
 *
 * A target is the exact source text a mutation must find before it can break
 * it. The harness itself cannot live here: it rewrites checked-in files and
 * runs a suite per mutation, which is minutes of work and a manual reviewer's
 * job. Its TARGETS are a different thing — reading twelve files and counting a
 * substring costs milliseconds, and it is the half that goes stale.
 * `staleTargets()` carries the account of why that had to move here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { staleTargets } from "./cs013-mutation-check";

test("every cs013 mutation target still quotes its file exactly once", () => {
  // deepEqual against [] rather than a length check: the failure output IS the
  // report — each stale target named, with the file it expected to match.
  assert.deepEqual(staleTargets(), []);
});
