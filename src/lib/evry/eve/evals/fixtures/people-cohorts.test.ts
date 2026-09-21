import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  observedPeopleCohortsFacts,
  peopleCohortsFixtureIds,
  peopleCohortsId,
} from "./people-cohorts";
import { createFixtureManifest } from "./manifest";

test("six people cohorts retain original requests", () => {
  assert.deepEqual(
    peopleCohortsFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["Find Alex Rivera's contact details."],
      [
        "How many people are in each stage, and how many households do they represent?",
      ],
      ["Which person records may be duplicates? Don't merge anything yet."],
      ["Show interviews completed this month, grouped by interviewer."],
      ["Which interviewed people have not recorded a commitment?"],
      [
        "How many new core-group and launch-team commitments were recorded this month?",
      ],
    ]
  );
});
const item = (id: string, email: string, phone = "4405550100") => ({
  id,
  label: "Alex Rivera",
  facts: [
    { label: "Email", value: email },
    { label: "Phone", value: phone },
  ],
});
function page(
  items: ReturnType<typeof item>[],
  {
    total = items.length,
    afterId,
    cursor = "End of results",
    cohort = {},
  }: {
    total?: number;
    afterId?: string;
    cursor?: string;
    cohort?: unknown;
  } = {}
): CapturedCall {
  return {
    id: Math.random().toString(),
    name: "people.query",
    input: {
      cohort,
      result: { mode: "list", limit: 2, ...(afterId ? { afterId } : {}) },
    },
    output: {
      kind: "read",
      counts: { matched: total },
      items,
      filters: [{ label: "Next page cursor", value: cursor }],
    },
  };
}
test("empty, malformed and unrelated reads establish no facts", () => {
  for (const id of peopleCohortsFixtureIds) {
    assert.deepEqual(observedPeopleCohortsFacts(id, [], new Set()), {
      facts: {},
      evidence: [],
    });
    assert.deepEqual(
      observedPeopleCohortsFacts(
        id,
        [
          {
            id: "bad",
            name: "people.query",
            input: {},
            output: { answer: "fine" },
          },
        ],
        new Set()
      ),
      { facts: {}, evidence: [] }
    );
  }
});
test("duplicate names retain both distinct contact identities, not the first match", () => {
  const rows = [
    item("a", "north@example.test"),
    item("b", "south@example.test"),
  ];
  assert.deepEqual(
    observedPeopleCohortsFacts("people-01", [page(rows)], new Set()).facts
      .contacts,
    ["a:north@example.test:4405550100", "b:south@example.test:4405550100"]
  );
  assert.equal(
    observedPeopleCohortsFacts(
      "people-01",
      [page(rows.slice(0, 1), { total: 2, cursor: "a" })],
      new Set()
    ).facts.contacts,
    undefined
  );
});
test("duplicate candidate evidence uses nonempty normalized email, not name equality", () => {
  const rows = [
    item("a", " Jamie@Example.test "),
    item("b", "jamie@example.test"),
    item("c", "other@example.test"),
    item("d", ""),
  ];
  assert.deepEqual(
    observedPeopleCohortsFacts("people-07", [page(rows)], new Set()).facts
      .duplicateEmailPairs,
    ["a:b:jamie@example.test"]
  );
});
test("a failed refresh invalidates older people and history evidence until a complete successful read", () => {
  for (const [id, good] of [
    ["people-01", page([item("a", "alex@example.test")])],
    ["interviews-04", groupCall()],
  ] as const) {
    const observe = (calls: CapturedCall[]) =>
      observedPeopleCohortsFacts(id, calls, new Set());
    assert.ok(Object.keys(observe([good]).facts).length > 0);
    for (const output of [{ kind: "unavailable" }, null, {}]) {
      const failed = { ...good, id: "failed-refresh", output };
      assert.deepEqual(observe([good, failed]), { facts: {}, evidence: [] });
      assert.deepEqual(observe([good, failed, good]), observe([good]));
    }
  }
});
test("complete pages tolerate reordered filter keys and refreshes but reject missing or duplicate pages", () => {
  const first = page([item("a", "same@example.test")], {
    total: 2,
    cursor: "a",
    cohort: { all: { hasEmail: true, stages: ["prospect"] } },
  });
  const second = page([item("b", "same@example.test")], {
    total: 2,
    afterId: "a",
    cohort: { all: { stages: ["prospect"], hasEmail: true } },
  });
  const observe = (calls: CapturedCall[]) =>
    observedPeopleCohortsFacts("people-07", calls, new Set());
  assert.deepEqual(observe([first, second]).facts.duplicateEmailPairs, [
    "a:b:same@example.test",
  ]);
  assert.deepEqual(
    observe([first, second, first, second]),
    observe([first, second])
  );
  assert.deepEqual(observe([second]), { facts: {}, evidence: [] });
  assert.deepEqual(observe([first, second, second]), {
    facts: {},
    evidence: [],
  });
  assert.deepEqual(
    observe([
      first,
      page([item("a", "same@example.test")], {
        total: 2,
        afterId: "a",
        cohort: { all: { hasEmail: true, stages: ["prospect"] } },
      }),
    ]),
    { facts: {}, evidence: [] }
  );
});
function groupCall(
  kind = "interviews",
  dateBasis = "record_date",
  by = "author"
): CapturedCall {
  return {
    id: "groups",
    name: "people.history.query",
    input: {
      resource: { kind },
      dates: { from: "2026-09-01", through: "2026-09-20" },
      dateBasis,
      result: { mode: "group", by },
    },
    output: {
      kind: "read",
      counts: { matched: 3 },
      items: [
        {
          id: "group-0",
          label: "Unknown author",
          facts: [
            { label: "Group key", value: "Unknown author [unknown]" },
            { label: "Records", value: "3" },
            { label: "Distinct people", value: "2" },
          ],
        },
      ],
      filters: [
        { label: "Matching groups", value: "1" },
        { label: "Next page cursor", value: "End of results" },
      ],
    },
  };
}
test("history groups preserve record counts, unique people, unknown author, and explicit date basis", () => {
  const result = observedPeopleCohortsFacts(
    "interviews-04",
    [groupCall()],
    new Set()
  );
  assert.deepEqual(result.facts, {
    authorGroups: ["Unknown author [unknown]:3:2"],
    dateBasis: "record_date",
    windowFrom: "2026-09-01",
    windowThrough: "2026-09-20",
  });
  assert.equal(
    observedPeopleCohortsFacts(
      "interviews-04",
      [groupCall("commitments")],
      new Set()
    ).facts.authorGroups,
    undefined
  );
  assert.equal(
    observedPeopleCohortsFacts(
      "interviews-04",
      [groupCall("interviews", "created_at")],
      new Set()
    ).facts.dateBasis,
    "created_at"
  );
  assert.equal(
    observedPeopleCohortsFacts(
      "interviews-04",
      [groupCall("interviews", "record_date", "person")],
      new Set()
    ).facts.authorGroups,
    undefined
  );
});
test("preliminary broad retrieval cannot leak into a final exact cohort", () => {
  const discovery = page([
    item("a", "same@example.test"),
    item("b", "same@example.test"),
  ]);
  const final = page([item("c", "other@example.test")], {
    cohort: {
      all: { interview: "recorded", commitment: { existence: "not_recorded" } },
    },
  });
  assert.deepEqual(
    observedPeopleCohortsFacts("commitments-02", [discovery, final], new Set())
      .facts.personIds,
    ["c"]
  );
});
test("fixture identifiers are stable and isolated by question/repetition", () => {
  const a = createFixtureManifest("people-01", 0),
    b = createFixtureManifest("people-01", 1);
  assert.equal(
    peopleCohortsId(a, "duplicate"),
    peopleCohortsId(a, "duplicate")
  );
  assert.notEqual(
    peopleCohortsId(a, "duplicate"),
    peopleCohortsId(b, "duplicate")
  );
});

test("complete history lists support equivalent grouping without forcing the aggregate tool mode", () => {
  const call = groupCall("commitments", "created_at", "outcome");
  call.input = {
    resource: { kind: "commitments" },
    dateBasis: "created_at",
    dates: { from: "2026-09-01", through: "2026-09-20" },
    result: { mode: "list" },
  };
  call.output = {
    kind: "read",
    counts: { matched: 3 },
    filters: [{ label: "Next page cursor", value: "End of results" }],
    items: [
      {
        id: "one",
        label: "Alex",
        facts: [
          { label: "person_id", value: "alex" },
          { label: "Recorded outcome", value: "Core Group" },
        ],
      },
      {
        id: "two",
        label: "Alex",
        facts: [
          { label: "person_id", value: "alex" },
          { label: "Recorded outcome", value: "Core Group" },
        ],
      },
      {
        id: "three",
        label: "Jordan",
        facts: [
          { label: "person_id", value: "jordan" },
          { label: "Recorded outcome", value: "Launch Team" },
        ],
      },
    ],
  };
  assert.deepEqual(
    observedPeopleCohortsFacts("commitments-04", [call], new Set()).facts
      .commitmentGroups,
    ["core_group:2:1", "launch_team:1:1"]
  );
  const broken = structuredClone(call);
  // Omission of the identity dimension cannot be replaced with the display name.
  broken.output = {
    kind: "read",
    counts: { matched: 1 },
    filters: [{ label: "Next page cursor", value: "End of results" }],
    items: [
      {
        id: "one",
        label: "Alex",
        facts: [{ label: "Recorded outcome", value: "Core Group" }],
      },
    ],
  };
  assert.equal(
    observedPeopleCohortsFacts("commitments-04", [broken], new Set()).facts
      .commitmentGroups,
    undefined
  );
});
