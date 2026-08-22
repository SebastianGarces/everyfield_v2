import assert from "node:assert/strict";
import { test } from "node:test";

import { readsAsAnImperative } from "@/lib/auth/read-only-surfaces";

import {
  PEOPLE_SUBTITLE_FOR_A_READER,
  peopleDirectorySubtitle,
} from "./presentation";

// ============================================================================
// #668 — the People directory stops telling a Member to manage it.
//
// EACH SENTENCE IS PINNED BY EQUALITY, not by the shared predicate alone, for
// the reason `communication/presentation.test.ts` records: `readsAsAnImperative`
// reads a CLOSED verb list, which is right for a repo-wide scan and wrong as
// the only guard here — a replacement that instructed a Member in a verb the
// list has never seen would pass it. The equality is what fails when the copy
// changes; the predicate call beside it is what ties this surface to the shared
// rule.
// ============================================================================

test("the subtitle asks the seat that may write to manage, and tells everyone else what they can read", () => {
  const writer = peopleDirectorySubtitle(true);
  assert.equal(writer, "Manage your contacts and pipeline");
  assert.ok(
    readsAsAnImperative(writer),
    "the seat that holds `people.write` is the one the header may address"
  );

  const member = peopleDirectorySubtitle(false);
  assert.equal(member, PEOPLE_SUBTITLE_FOR_A_READER);
  assert.equal(
    member,
    "Your plant's contacts, and where each one is in the pipeline",
    "the Member's header says what the page IS for them — the directory, the pipeline board, search and the filters are all readable — rather than going quiet"
  );
  assert.ok(
    !readsAsAnImperative(member),
    "an imperative for a write they do not hold is the #668 defect"
  );
});
