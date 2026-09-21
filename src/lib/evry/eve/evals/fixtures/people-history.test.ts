import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  peopleHistoryFixtureIds,
  peopleHistoryId,
  observedPeopleHistoryFacts,
} from "./people-history";

test("five people-history bindings preserve the original corpus", () => {
  assert.deepEqual(
    peopleHistoryFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["Which people have music skills but are not assigned to any ministry?"],
      ["Compare Alex and Jordan's latest interview records."],
      ["Show Jordan's most recent 4 C's assessment."],
      ["How many people have an assessment from the past 90 days?"],
      ["Which committed people have not attended an orientation?"],
    ]
  );
});
test("missing and malformed calls cannot establish history facts", () => {
  for (const id of peopleHistoryFixtureIds) {
    assert.deepEqual(observedPeopleHistoryFacts(id, [], new Set()), {
      facts: {},
      evidence: [],
    });
    assert.deepEqual(
      observedPeopleHistoryFacts(
        id,
        [
          {
            id: "bad",
            name: "people.history.query",
            input: { resource: { kind: "assessments" } },
            output: { answer: "Everyone has been assessed." },
          },
        ],
        new Set(["bad"])
      ),
      { facts: {}, evidence: [] }
    );
  }
});
test("history fixture IDs are deterministic and isolated", () => {
  const id = peopleHistoryId(
    createFixtureManifest("interviews-05", 0),
    "alex-latest"
  );
  assert.equal(
    id,
    peopleHistoryId(createFixtureManifest("interviews-05", 0), "alex-latest")
  );
  assert.notEqual(
    id,
    peopleHistoryId(createFixtureManifest("interviews-05", 1), "alex-latest")
  );
  assert.notEqual(
    id,
    peopleHistoryId(createFixtureManifest("assessments-01", 0), "alex-latest")
  );
});
test("assessment totals distinguish people from repeated records", () => {
  const call: CapturedCall = {
    id: "count",
    name: "people.history.query",
    input: {
      resource: { kind: "assessments" },
      dateBasis: "record_date",
      dates: { from: "2026-06-23", through: "2026-09-20" },
      result: { mode: "count" },
    },
    output: {
      kind: "read",
      counts: { matched: 4 },
      items: [
        {
          id: "total",
          label: "Assessments",
          facts: [
            { label: "Records", value: "4" },
            { label: "Distinct people", value: "2" },
          ],
        },
      ],
    },
  };
  assert.deepEqual(
    observedPeopleHistoryFacts("assessments-04", [call], new Set(["count"])),
    {
      facts: {
        distinctPeople: 2,
        assessmentRecords: 4,
        windowFrom: "2026-06-23",
        windowThrough: "2026-09-20",
      },
      evidence: ["recorded:assessments-04"],
    }
  );
  assert.deepEqual(
    observedPeopleHistoryFacts("assessments-04", [call], new Set()),
    observedPeopleHistoryFacts("assessments-04", [call], new Set(["count"]))
  );
});
test("assessment facts cannot be supplied by a different history resource", () => {
  const call: CapturedCall = {
    id: "wrong",
    name: "people.history.query",
    input: { resource: { kind: "interviews" } },
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [
        {
          id: "interview",
          label: "Jordan",
          facts: [
            { label: "person_id", value: "jordan" },
            { label: "Recorded outcome", value: "Qualified" },
          ],
        },
      ],
    },
  };
  assert.deepEqual(
    observedPeopleHistoryFacts("assessments-01", [call], new Set(["wrong"])),
    { facts: {}, evidence: [] }
  );
});

test("complete bounded person groups establish the same aggregate as count mode", () => {
  const group = (id: string) => ({
    id: `group-${id}`,
    label: "Fixture",
    facts: [
      { label: "Records", value: "2" },
      { label: "Distinct people", value: "1" },
      { label: "Group key", value: `Fixture [${id}]` },
    ],
  });
  const alex = "67c7e8b9-9f52-48b6-8624-7f25daf1ce13",
    jordan = "c67793d2-5887-4af2-859c-de6ab657dfda";
  const page = (id: string, ids: string[], offset = 0): CapturedCall => ({
    id,
    name: "people.history.query",
    input: {
      resource: { kind: "assessments" },
      dateBasis: "record_date",
      dates: { from: "2026-06-22", through: "2026-09-20" },
      cohort: {},
      latestPerPerson: false,
      result: { mode: "group", by: "person", offset },
    },
    output: {
      kind: "read",
      counts: { matched: 4 },
      filters: [{ label: "Matching groups", value: "2" }],
      items: ids.map(group),
    },
  });
  const complete = page("complete", [alex, jordan]);
  const expected = {
    facts: {
      distinctPeople: 2,
      assessmentRecords: 4,
      windowFrom: "2026-06-22",
      windowThrough: "2026-09-20",
    },
    evidence: ["recorded:assessments-04"],
  };
  assert.deepEqual(
    observedPeopleHistoryFacts("assessments-04", [complete], new Set()),
    expected
  );
  assert.deepEqual(
    observedPeopleHistoryFacts(
      "assessments-04",
      [complete],
      new Set(["complete"])
    ),
    expected
  );
  assert.deepEqual(
    observedPeopleHistoryFacts(
      "assessments-04",
      [page("first", [alex]), page("second", [jordan], 1)],
      new Set()
    ),
    expected
  );
  const incomplete = [page("first", [alex]), page("repeat", [alex])];
  assert.deepEqual(
    observedPeopleHistoryFacts("assessments-04", incomplete, new Set()),
    { facts: {}, evidence: [] }
  );
  for (const input of [
    {
      resource: { kind: "assessments" },
      result: { mode: "group", by: "person" },
    },
    {
      resource: { kind: "assessments" },
      dates: { from: "2026-06-22", through: "2026-09-20" },
      dateBasis: "created_at",
      result: { mode: "group", by: "person" },
    },
  ])
    assert.deepEqual(
      observedPeopleHistoryFacts(
        "assessments-04",
        [{ ...complete, input }],
        new Set()
      ),
      { facts: {}, evidence: [] }
    );
  const unbounded = {
    ...page("discovery", [alex, jordan]),
    input: {
      resource: { kind: "assessments" },
      dates: {},
      result: { mode: "group", by: "person" },
    },
  };
  assert.deepEqual(
    observedPeopleHistoryFacts(
      "assessments-04",
      [unbounded, page("first", [alex])],
      new Set()
    ),
    { facts: {}, evidence: [] }
  );
});
