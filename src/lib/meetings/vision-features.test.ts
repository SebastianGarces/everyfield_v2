import assert from "node:assert/strict";
import { test } from "node:test";
import { hasVisionFeature } from "./vision-features";
import { adminRsvpSchema } from "./admin-rsvp";

test("Vision features reject other meeting types at every stage", () => {
  for (const type of ["team_meeting", "orientation"] as const)
    for (const status of ["planning", "ready", "completed", "cancelled"])
      for (const feature of ["outcomes", "evaluation", "logistics"] as const)
        assert.equal(hasVisionFeature({ type, status }, feature), false);
});

test("cards and materials remain available while evaluation follows completion", () => {
  for (const status of ["planning", "ready", "completed", "cancelled"]) {
    const meeting = { type: "vision_meeting" as const, status };
    assert.equal(hasVisionFeature(meeting, "outcomes"), true);
    assert.equal(hasVisionFeature(meeting, "logistics"), true);
    assert.equal(
      hasVisionFeature(meeting, "evaluation"),
      status === "completed"
    );
  }
});

test("administrative RSVP accepts explicit response/reset choices, not response-card values", () => {
  for (const status of ["confirmed", "declined", "pending"])
    assert.equal(adminRsvpSchema.safeParse(status).success, true);
  for (const status of [
    null,
    undefined,
    "",
    "interested",
    "ready_commit",
    "constructor",
    1,
  ])
    assert.equal(adminRsvpSchema.safeParse(status).success, false);
});
