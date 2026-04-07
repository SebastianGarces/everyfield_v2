import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistantMessage,
  buildRelativeDateAnchors,
  maybeApplyDeterministicSchedulingDateTime,
} from "./vision-meeting-planner";
import { initialVisionMeetingDraft } from "./vision-meeting-planner-schema";

test("buildRelativeDateAnchors includes next sunday", () => {
  const anchors = buildRelativeDateAnchors(
    new Date("2026-04-07T12:00:00.000Z"),
    "America/Chicago"
  );

  assert.ok(
    anchors.some((anchor) =>
      anchor.includes('"next sunday" => Sunday, April 12, 2026')
    )
  );
});

test("maybeApplyDeterministicSchedulingDateTime resolves next Monday at 7 PM in America/Chicago", () => {
  const result = maybeApplyDeterministicSchedulingDateTime({
    currentDraft: initialVisionMeetingDraft,
    messages: [
      {
        id: "u1",
        role: "user",
        content:
          "Schedule a vision meeting next Monday at 7 PM at North Ridgeville High School.",
      },
    ],
    now: new Date("2026-04-07T12:00:00.000Z"),
    timezone: "America/Chicago",
  });

  assert.equal(result.datetime, "2026-04-14T00:00:00.000Z");
});

test("buildAssistantMessage asks for the missing location without implying creation", () => {
  const message = buildAssistantMessage({
    missingFields: ["location"],
    readyToCreate: false,
    interpretation: {
      datetimeLabel: "Monday, April 13, 2026 at 7:00 PM CDT",
    },
  });

  assert.equal(
    message,
    "I have the date and time set for Monday, April 13, 2026 at 7:00 PM CDT. What location should I use?"
  );
});
