import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistantMessage,
  buildRelativeDateAnchors,
  maybeApplyDeterministicLocationResolution,
  maybePreventImplicitDateTimeAssumptions,
  maybeApplyDeterministicSchedulingDateTime,
} from "./vision-meeting-planner";
import {
  initialVisionMeetingDraft,
  type PlannerSavedLocation,
} from "./vision-meeting-planner-schema";

const singleSavedLocation: PlannerSavedLocation[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "North Ridgeville High School",
    address: "123 Center Ridge Rd, North Ridgeville, OH 44039",
  },
];

const multipleSavedLocations: PlannerSavedLocation[] = [
  ...singleSavedLocation,
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Community Center",
    address: "456 Main St, North Ridgeville, OH 44039",
  },
];

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

test("maybePreventImplicitDateTimeAssumptions clears a model-guessed midnight when the user only gave a date", () => {
  const result = maybePreventImplicitDateTimeAssumptions({
    currentDraft: {
      ...initialVisionMeetingDraft,
      datetime: "2026-04-08T05:00:00.000Z",
    },
    previousDraft: initialVisionMeetingDraft,
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Meeting tomorrow at the high school, 35 ppl",
      },
    ],
    timezone: "America/Chicago",
  });

  assert.equal(result.draft.datetime, null);
  assert.equal(result.pendingDateLabel, "Wednesday, April 8, 2026");
  assert.equal(result.requiresTimeClarification, true);
});

test("maybePreventImplicitDateTimeAssumptions keeps an explicit midnight time", () => {
  const result = maybePreventImplicitDateTimeAssumptions({
    currentDraft: {
      ...initialVisionMeetingDraft,
      datetime: "2026-04-08T05:00:00.000Z",
    },
    previousDraft: initialVisionMeetingDraft,
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Meeting tomorrow at midnight at the high school",
      },
    ],
    timezone: "America/Chicago",
  });

  assert.equal(result.draft.datetime, "2026-04-08T05:00:00.000Z");
  assert.equal(result.pendingDateLabel, undefined);
  assert.equal(result.requiresTimeClarification, false);
});

test("maybeApplyDeterministicLocationResolution matches a saved location by name from the user message", () => {
  const result = maybeApplyDeterministicLocationResolution({
    currentDraft: {
      ...initialVisionMeetingDraft,
      locationName: "North Ridgeville High School",
    },
    messages: [
      {
        id: "u1",
        role: "user",
        content:
          "Schedule it at North Ridgeville High School for about 50 people.",
      },
    ],
    savedLocations: singleSavedLocation,
  });

  assert.deepEqual(result.draft, {
    ...initialVisionMeetingDraft,
    locationId: "11111111-1111-4111-8111-111111111111",
    locationName: "North Ridgeville High School",
    locationAddress: "123 Center Ridge Rd, North Ridgeville, OH 44039",
  });
  assert.equal(result.requiresSavedLocationClarification, false);
});

test("maybeApplyDeterministicLocationResolution maps a default location phrase to the only saved location", () => {
  const result = maybeApplyDeterministicLocationResolution({
    currentDraft: {
      ...initialVisionMeetingDraft,
      locationName: "my default location",
    },
    messages: [
      {
        id: "u1",
        role: "user",
        content:
          "Schedule a meeting tomorrow 4pm, my default location, 50 ppl note: potluck dinner planning",
      },
    ],
    savedLocations: singleSavedLocation,
  });

  assert.deepEqual(result.draft, {
    ...initialVisionMeetingDraft,
    locationId: "11111111-1111-4111-8111-111111111111",
    locationName: "North Ridgeville High School",
    locationAddress: "123 Center Ridge Rd, North Ridgeville, OH 44039",
  });
  assert.equal(
    result.matchedSavedLocation?.name,
    "North Ridgeville High School"
  );
});

test("maybeApplyDeterministicLocationResolution preserves an already resolved location when the user says same place", () => {
  const result = maybeApplyDeterministicLocationResolution({
    currentDraft: {
      ...initialVisionMeetingDraft,
      locationId: "11111111-1111-4111-8111-111111111111",
      locationName: "North Ridgeville High School",
      locationAddress: "123 Center Ridge Rd, North Ridgeville, OH 44039",
    },
    messages: [
      {
        id: "u2",
        role: "user",
        content: "Same place, but make it 50 people instead.",
      },
    ],
    savedLocations: multipleSavedLocations,
  });

  assert.equal(result.draft.locationId, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.draft.locationName, "North Ridgeville High School");
  assert.equal(
    result.draft.locationAddress,
    "123 Center Ridge Rd, North Ridgeville, OH 44039"
  );
  assert.equal(result.requiresSavedLocationClarification, false);
});

test("maybeApplyDeterministicLocationResolution clears ambiguous default location placeholders when multiple saved locations exist", () => {
  const result = maybeApplyDeterministicLocationResolution({
    currentDraft: {
      ...initialVisionMeetingDraft,
      locationName: "my default location",
    },
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Tomorrow at 4 PM at my default location",
      },
    ],
    savedLocations: multipleSavedLocations,
  });

  assert.equal(result.draft.locationId, null);
  assert.equal(result.draft.locationName, null);
  assert.equal(result.draft.locationAddress, null);
  assert.equal(result.requiresSavedLocationClarification, true);
  assert.deepEqual(result.suggestedSavedLocations, [
    "North Ridgeville High School",
    "Community Center",
  ]);
});

test("buildAssistantMessage asks the user to choose between saved locations when default location is ambiguous", () => {
  const message = buildAssistantMessage({
    missingFields: ["location"],
    readyToCreate: false,
    draft: initialVisionMeetingDraft,
    pendingDateLabel: undefined,
    requiresSavedLocationClarification: true,
    requiresTimeClarification: false,
    suggestedSavedLocations: [
      "North Ridgeville High School",
      "Community Center",
    ],
    interpretation: {
      dateLabel: undefined,
      datetimeLabel: "Wednesday, April 8, 2026 at 4:00 PM CDT",
    },
  });

  assert.equal(
    message,
    "I found multiple saved locations. Which one should I use: North Ridgeville High School, Community Center?"
  );
});

test("buildAssistantMessage asks for an address when the location name is known but unresolved", () => {
  const message = buildAssistantMessage({
    missingFields: ["location"],
    readyToCreate: false,
    draft: {
      ...initialVisionMeetingDraft,
      locationName: "North Ridgeville High School",
    },
    pendingDateLabel: undefined,
    requiresSavedLocationClarification: false,
    requiresTimeClarification: false,
    suggestedSavedLocations: [],
    interpretation: {
      dateLabel: undefined,
      datetimeLabel: "Monday, April 13, 2026 at 7:00 PM CDT",
    },
  });

  assert.equal(
    message,
    "I have the location name set to North Ridgeville High School. What address should I use?"
  );
});

test("buildAssistantMessage asks for a time when the date is known but time is missing", () => {
  const message = buildAssistantMessage({
    missingFields: ["datetime"],
    readyToCreate: false,
    draft: {
      ...initialVisionMeetingDraft,
      locationId: "11111111-1111-4111-8111-111111111111",
      locationName: "North Ridgeville High School",
      locationAddress: "123 Center Ridge Rd, North Ridgeville, OH 44039",
    },
    pendingDateLabel: "Wednesday, April 8, 2026",
    requiresSavedLocationClarification: false,
    requiresTimeClarification: true,
    suggestedSavedLocations: [],
    interpretation: {
      dateLabel: "Wednesday, April 8, 2026",
      locationLabel:
        "North Ridgeville High School, 123 Center Ridge Rd, North Ridgeville, OH 44039",
    },
  });

  assert.equal(
    message,
    "I have the date set for Wednesday, April 8, 2026 and the location set to North Ridgeville High School, 123 Center Ridge Rd, North Ridgeville, OH 44039. What time should I use?"
  );
});
