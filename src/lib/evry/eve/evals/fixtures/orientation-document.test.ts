import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureManifest } from "./manifest";
import {
  orientationDocumentExpectations,
  orientationDocumentPlanReference,
  orientationDocumentValueFacts,
  seedOrientationDocumentFixture,
  type OrientationDocumentTruth,
} from "./orientation-document";

const truth: OrientationDocumentTruth = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Core team orientation",
  church: "Fixture church",
  start_utc: "2026-09-21T14:00:00Z",
  duration: 120,
  location: "Church hall",
  address: "123 A St.",
  agenda: [
    { title: "Welcome", minutes: 10 },
    { title: "Pause", minutes: 0 },
    { title: "Legacy discussion" },
  ],
};
const values = {
  church_name: truth.church,
  meeting_title: truth.title,
  meeting_date: "Monday, September 21, 2026 at 10:00 AM EDT",
  meeting_duration: "2 hours",
  meeting_location: "Church hall, 123 A St.",
  meeting_agenda:
    "Welcome (10 minutes)\nPause (0 minutes)\nLegacy discussion (duration not recorded)",
};
test("saved orientation facts accept equivalent explicit date and duration representations", () => {
  assert.deepEqual(orientationDocumentValueFacts(truth, values), {
    meetingDetailsMatch: true,
    savedAgendaMatches: true,
  });
  assert.deepEqual(
    orientationDocumentValueFacts(truth, {
      ...values,
      meeting_date: "2026-09-21T10:00:00-04:00",
      meeting_duration: "120 minutes",
    }),
    { meetingDetailsMatch: true, savedAgendaMatches: true }
  );
});
test("wrong day, wrong timezone, missing address and unrelated title cannot pass", () => {
  for (const changes of [
    { meeting_date: "September 22, 2026 10:00 AM EDT" },
    { meeting_date: "September 21, 2026 10:00 AM UTC" },
    { meeting_date: "September 21, 2026 10:00 AM" },
    { meeting_title: "Vision Meeting" },
    { meeting_location: "Church hall" },
    { meeting_duration: "90 minutes" },
  ])
    assert.equal(
      orientationDocumentValueFacts(truth, { ...values, ...changes })
        .meetingDetailsMatch,
      false
    );
});
test("missing, reordered, mistimed or invented agenda entries fail including zero versus unknown", () => {
  for (const agenda of [
    "Welcome (10 minutes)\nPause (0 minutes)",
    values.meeting_agenda.replace("10 minutes", "20 minutes"),
    values.meeting_agenda.replace("0 minutes", "duration not recorded"),
    values.meeting_agenda.replace("duration not recorded", "0 minutes"),
    values.meeting_agenda.replace("Welcome (", "Welcome extended ("),
    values.meeting_agenda.split("\n").reverse().join("\n"),
    values.meeting_agenda + "\nVision pitch (20 minutes)",
  ])
    assert.equal(
      orientationDocumentValueFacts(truth, {
        ...values,
        meeting_agenda: agenda,
      }).savedAgendaMatches,
      false
    );
});
test("unrelated corpus cases are not seeded or bound", () => {
  const m = createFixtureManifest("tasks-01", 1);
  seedOrientationDocumentFixture(m, {
    sql: () => {
      throw new Error("Unexpected write");
    },
  });
  assert.equal(orientationDocumentExpectations(m), null);
});
test("latest failed or unpresented preparation cannot reuse an older confirmation", () => {
  const output = {
    activePlan: {
      mode: "set",
      plan: { planId: truth.id, fingerprint: "a".repeat(64) },
    },
    artifacts: [{ kind: "confirmation" }],
  };
  const call = { id: "prepared", name: "actions.prepare", input: {}, output };
  assert.ok(orientationDocumentPlanReference([call], new Set([call.id])));
  assert.equal(orientationDocumentPlanReference([call], new Set()), null);
  assert.equal(
    orientationDocumentPlanReference(
      [call, { ...call, id: "failed", output: { status: "unavailable" } }],
      new Set([call.id])
    ),
    null
  );
});
