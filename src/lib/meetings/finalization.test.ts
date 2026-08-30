import assert from "node:assert/strict";
import test from "node:test";

import { meetingFinalizationTaskAssigneeId } from "./finalization";

test("only a led vision meeting assigns generated finalization tasks", () => {
  assert.equal(
    meetingFinalizationTaskAssigneeId({
      meetingType: "vision_meeting",
      leadershipStatus: "planter_confirmed",
      ownerId: "owner",
    }),
    "owner"
  );
  assert.equal(
    meetingFinalizationTaskAssigneeId({
      meetingType: "vision_meeting",
      leadershipStatus: null,
      ownerId: "owner",
    }),
    "owner"
  );
  assert.equal(
    meetingFinalizationTaskAssigneeId({
      meetingType: "vision_meeting",
      leadershipStatus: "no_planter",
      ownerId: "owner",
    }),
    null
  );
  assert.equal(
    meetingFinalizationTaskAssigneeId({
      meetingType: "vision_meeting",
      leadershipStatus: "planter_confirmed",
      ownerId: null,
    }),
    null
  );
  assert.equal(
    meetingFinalizationTaskAssigneeId({
      meetingType: "orientation",
      leadershipStatus: "planter_confirmed",
      ownerId: "owner",
    }),
    null
  );
});
