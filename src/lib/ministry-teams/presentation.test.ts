import assert from "node:assert/strict";
import { test } from "node:test";

import { readsAsAnImperative } from "@/lib/auth/read-only-surfaces";

import { TEAMS_SUBTITLE_FOR_A_READER, teamsListSubtitle } from "./presentation";

// ============================================================================
// #668 — the Ministry Teams header stops telling a Member to organize and staff.
//
// Pinned by equality with the predicate beside it, for the reason
// `communication/presentation.test.ts` records: the predicate reads a CLOSED
// verb list, so it cannot be the only guard on a sentence somebody rewrites.
// ============================================================================

test("the subtitle asks the seat that may write to organize, and tells everyone else what they can read", () => {
  const writer = teamsListSubtitle(true);
  assert.equal(writer, "Organize, staff, and track your ministry teams");
  assert.ok(
    readsAsAnImperative(writer),
    "the seat that holds `teams.write` is the one the header may address"
  );

  const member = teamsListSubtitle(false);
  assert.equal(member, TEAMS_SUBTITLE_FOR_A_READER);
  assert.equal(
    member,
    "Your plant's ministry teams, and how each one is staffed",
    "the Member's header keeps the one verb of the three that was theirs — tracking is reading — and drops the two that are `teams.write`"
  );
  assert.ok(
    !readsAsAnImperative(member),
    "an imperative for a write they do not hold is the #668 defect"
  );
});
