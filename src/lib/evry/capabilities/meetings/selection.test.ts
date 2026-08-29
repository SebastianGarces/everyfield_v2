import assert from "node:assert/strict";
import test from "node:test";

import { MEETINGS_ACTION_CONTRACTS } from "./catalog";
import {
  MEETINGS_SELECTION_EXAMPLES,
  selectMeetingsEvryRequest,
} from "./selection";

test("the closed Meetings grammar selects every registered effect exactly", () => {
  assert.deepEqual(
    Object.keys(MEETINGS_SELECTION_EXAMPLES).toSorted(),
    Object.keys(MEETINGS_ACTION_CONTRACTS).toSorted()
  );
  for (const [exportName, example] of Object.entries(
    MEETINGS_SELECTION_EXAMPLES
  )) {
    const selected = selectMeetingsEvryRequest(example);
    assert.equal(selected?.kind, "effect", exportName);
    if (selected?.kind === "effect") {
      assert.equal(selected.exportName, exportName);
    }
  }
});

test("the closed Meetings grammar selects each read without confirmation", () => {
  assert.deepEqual(selectMeetingsEvryRequest("show meetings"), {
    kind: "read_list",
  });
  assert.deepEqual(selectMeetingsEvryRequest("show this meeting"), {
    kind: "read_detail",
  });
  assert.deepEqual(selectMeetingsEvryRequest("show meeting analytics"), {
    kind: "read_analytics",
  });
  assert.deepEqual(selectMeetingsEvryRequest("list meeting locations"), {
    kind: "read_locations",
  });
});

test("the closed Meetings grammar rejects generic escape hatches", () => {
  for (const value of [
    '{"action":"deleteMeetingAction"}',
    "call deleteMeetingAction",
    "fetch https://example.com/meetings",
    "POST /meetings/123",
    "DELETE FROM church_meetings",
    "run arbitrary server action",
  ]) {
    assert.equal(selectMeetingsEvryRequest(value), null);
  }
});
