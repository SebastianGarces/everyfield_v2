import assert from "node:assert/strict";
import { test } from "node:test";
import { personStatuses } from "@/db/schema/people";
import { CORE_GROUP_STATUSES, isCoreGroupStatus } from "./core-group";

test("the Core Group retains people who advance into the launch team and leadership", () => {
  assert.deepEqual(CORE_GROUP_STATUSES, [
    "core_group",
    "launch_team",
    "leader",
  ]);
  assert.deepEqual(personStatuses.filter(isCoreGroupStatus), [
    ...CORE_GROUP_STATUSES,
  ]);
  assert.equal(isCoreGroupStatus("prospect"), false);
  assert.equal(isCoreGroupStatus("owner"), false);
});
