import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  observedStaffingFacts,
  staffingFixtureIds,
  staffingId,
} from "./staffing";

test("staffing bindings preserve the original questions", () => {
  assert.deepEqual(
    staffingFixtureIds.map((id) => questions.find((q) => q.id === id)?.turns),
    [
      [
        "Find people tagged either worship or hospitality, but exclude people tagged inactive.",
      ],
      ["What are the requirements for the children's check-in role?"],
      ["Which filled roles have people missing a recorded requirement?"],
    ]
  );
});

test("missing or malformed captured results cannot establish staffing evidence", () => {
  for (const id of staffingFixtureIds) {
    assert.deepEqual(observedStaffingFacts(id, [], new Set()), {
      facts: {},
      evidence: [],
    });
    assert.deepEqual(
      observedStaffingFacts(
        id,
        [
          {
            id: "bad",
            name: "people.query",
            input: {},
            output: { answer: "All requirements verified" },
          },
        ],
        new Set(["bad"])
      ),
      { facts: {}, evidence: [] }
    );
  }
});

test("staffing IDs are isolated by question and repetition", () => {
  const id = staffingId(createFixtureManifest("people-06", 0), "worship");
  assert.equal(
    id,
    staffingId(createFixtureManifest("people-06", 0), "worship")
  );
  assert.notEqual(
    id,
    staffingId(createFixtureManifest("people-06", 1), "worship")
  );
  assert.notEqual(
    id,
    staffingId(createFixtureManifest("roles-03", 0), "worship")
  );
});

test("tag cohort evidence requires all unique retrieved rows, not a first page or duplicated overlap", () => {
  const call = (id: string, ids: string[]): CapturedCall => ({
    id,
    name: "people.query",
    input: {},
    output: {
      kind: "read",
      counts: { matched: 3 },
      items: ids.map((id) => ({ id, label: id })),
    },
  });
  const calls = [
    call("first", ["alex", "jordan"]),
    call("second", ["sam"]),
    call("repeat", ["alex"]),
  ];
  assert.deepEqual(
    observedStaffingFacts("people-06", [calls[0]], new Set(["first"])).evidence,
    []
  );
  assert.deepEqual(
    observedStaffingFacts(
      "people-06",
      [calls[0], calls[2]],
      new Set(["first", "repeat"])
    ).evidence,
    []
  );
  assert.deepEqual(
    observedStaffingFacts("people-06", calls, new Set(["first", "second"])),
    {
      facts: { personIds: ["alex", "jordan", "sam"], total: 3 },
      evidence: ["complete-tag-cohort"],
    }
  );
  assert.deepEqual(
    observedStaffingFacts("people-06", calls, new Set()),
    observedStaffingFacts("people-06", calls, new Set(["first", "second"]))
  );
});

test("a person read without background-check evidence is not a requirement audit", () => {
  const person = "00000000-0000-4000-8000-000000000001";
  const calls: CapturedCall[] = [
    {
      id: "role",
      name: "teams.get_many",
      input: { resource: "roles" },
      output: {
        kind: "read",
        counts: { matched: 1 },
        items: [
          {
            id: "check-in",
            label: "Check-in",
            facts: [
              { label: "Background check required", value: "Yes" },
              { label: "Assigned person linkage", value: `Alex [${person}]` },
            ],
          },
        ],
      },
    },
    {
      id: "person",
      name: "people.get_many",
      input: { resource: "person" },
      output: {
        kind: "read",
        counts: { matched: 1 },
        items: [{ id: person, label: "Alex" }],
      },
    },
  ];
  assert.deepEqual(
    observedStaffingFacts("roles-04", calls, new Set(["role"])),
    {
      facts: { auditedRoleIds: [], missingRequirementRoleIds: [] },
      evidence: [],
    }
  );
});

test("role requirements can ground prose without rendering a role card", () => {
  const calls: CapturedCall[] = [
    {
      id: "role",
      name: "teams.get_many",
      input: { resource: "roles" },
      output: {
        kind: "read",
        counts: { matched: 1 },
        items: [
          {
            id: "check-in",
            label: "Check-in",
            facts: [
              { label: "Background check required", value: "Yes" },
              { label: "Desired skills", value: "Warm welcome" },
              { label: "Time commitment", value: "Medium" },
            ],
          },
        ],
      },
    },
  ];
  const textOnly = observedStaffingFacts("roles-03", calls, new Set());
  assert.deepEqual(
    textOnly,
    observedStaffingFacts("roles-03", calls, new Set(["role"]))
  );
  assert.deepEqual(textOnly.evidence, ["role-requirements"]);
  assert.equal(textOnly.facts.backgroundCheckRequired, true);
});
