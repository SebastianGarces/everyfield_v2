import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  engagementFixtureIds,
  engagementId,
  observedEngagementFacts,
} from "./engagement";

const orientationPeople = [
  "a4880ddb-cecc-4807-8c3f-086d5e0a5706",
  "2a40604d-0031-4257-86c0-d6c2ab53401c",
  "6e4d6988-634d-4460-8702-d8e26ed31dc8",
];
function orientationReads(): CapturedCall[] {
  const attendance: CapturedCall = {
    id: "attendance",
    name: "attendance.query",
    input: {
      cohort: {},
      meetingTypes: ["orientation"],
      statuses: ["attended"],
      result: { mode: "list", limit: 50 },
    },
    output: {
      kind: "read",
      counts: { matched: 3 },
      items: orientationPeople.map((person, i) => ({
        id: `attendance-${i}`,
        label: person,
        facts: [
          { label: "person_id", value: person, modelOnly: true },
          { label: "Attendance", value: "Attended" },
        ],
      })),
    },
  };
  const assignments = (activeOnly: boolean): CapturedCall => ({
    id: activeOnly ? "active" : "all",
    name: "teams.query",
    input: {
      request: {
        resource: "assignments",
        where: { all: activeOnly ? [{ statuses: ["active"] }] : [], any: [] },
        query: { mode: "list", limit: 50, sort: "name", direction: "asc" },
      },
    },
    output: {
      kind: "read",
      counts: { matched: activeOnly ? 1 : 2 },
      items: (activeOnly ? [0] : [0, 2]).map((index) => ({
        id: `assignment-${index}`,
        label: orientationPeople[index]!,
        facts: [
          {
            label: "Person ID",
            value: orientationPeople[index]!,
            modelOnly: true,
          },
          { label: "Status", value: index === 0 ? "Active" : "Inactive" },
        ],
      })),
    },
  });
  return [
    assignments(false),
    assignments(true),
    attendance,
    {
      id: "details",
      name: "people.get_many",
      input: {
        resource: "person",
        ids: orientationPeople.slice(1),
        fields: ["contact", "stage", "household"],
      },
      output: {
        kind: "read",
        counts: { matched: 2 },
        items: orientationPeople.slice(1).map((id) => ({ id, label: id })),
      },
    },
  ];
}

test("orientation composition accepts the exact live call structure, deriving identities from attendance minus active assignments", () => {
  for (const calls of [
    orientationReads(),
    orientationReads().filter((call) => call.id !== "active"),
    orientationReads().filter((call) => call.id !== "details"),
  ]) {
    assert.deepEqual(
      observedEngagementFacts("orientations-03", calls, new Set()),
      {
        facts: { peopleIds: orientationPeople.slice(1).sort() },
        evidence: ["actual-orientation-without-current-membership"],
      }
    );
  }
});

test("orientation composition cannot use failed, incomplete, malformed or differently scoped refreshes", () => {
  for (const name of ["attendance.query", "teams.query"]) {
    const base = orientationReads();
    const original = base.findLast((call) => call.name === name)!;
    for (const output of [
      { kind: "unavailable", reason: "query failed" },
      { kind: "read", counts: { matched: 3 }, items: [] },
      {
        kind: "read",
        counts: { matched: 1 },
        items: [
          {
            id: "missing-identity",
            label: "Someone",
            facts: [
              { label: "Status", value: "Active" },
              { label: "Attendance", value: "Attended" },
            ],
          },
        ],
      },
    ])
      assert.deepEqual(
        observedEngagementFacts(
          "orientations-03",
          [...base, { ...original, id: "refresh", output }],
          new Set()
        ).evidence,
        []
      );
  }
  const invalidAttendance = [
    { cohort: { all: { stages: ["core_group"] } } },
    { meetingTypes: ["vision_meeting"] },
    { statuses: ["invited"] },
    { dates: { from: "2026-09-01", through: "2026-09-20" } },
    { result: { mode: "list", limit: 50, afterId: "missing-first" } },
  ];
  for (const change of invalidAttendance) {
    const calls = orientationReads();
    const original = calls.find((call) => call.name === "attendance.query")!;
    original.input = {
      ...(original.input as Record<string, unknown>),
      ...change,
    };
    assert.deepEqual(
      observedEngagementFacts("orientations-03", calls, new Set()).evidence,
      []
    );
  }
  for (const all of [
    [{ statuses: ["inactive"] }],
    [{ teamIds: ["one-team"] }],
  ]) {
    const calls = orientationReads();
    calls.push({
      ...calls[1]!,
      input: {
        request: {
          resource: "assignments",
          where: { all },
          query: { mode: "list", limit: 50 },
        },
      },
    });
    assert.deepEqual(
      observedEngagementFacts("orientations-03", calls, new Set()).evidence,
      []
    );
  }
  assert.deepEqual(
    observedEngagementFacts(
      "orientations-03",
      orientationReads().filter((call) => call.name === "people.get_many"),
      new Set()
    ).evidence,
    []
  );
});

test("orientation composition requires complete non-overlapping pages and accepts legitimate repeated attendance by one person", () => {
  const base = orientationReads();
  const attendance = base.find((call) => call.name === "attendance.query")!;
  const output = attendance.output as {
    kind: string;
    counts: { matched: number };
    items: Array<{ id: string }>;
  };
  const first = {
    ...attendance,
    input: {
      ...(attendance.input as object),
      result: { mode: "list", limit: 2 },
    },
    output: { ...output, items: output.items.slice(0, 2) },
  };
  const last = {
    ...attendance,
    id: "attendance-next",
    input: {
      ...(attendance.input as object),
      result: { mode: "list", limit: 2, afterId: output.items[1]!.id },
    },
    output: { ...output, items: output.items.slice(2) },
  };
  const prefix = base.filter((call) => call.name !== "attendance.query");
  assert.deepEqual(
    observedEngagementFacts(
      "orientations-03",
      [...prefix, first, last],
      new Set()
    ).facts.peopleIds,
    orientationPeople.slice(1).sort()
  );
  for (const pages of [
    [first],
    [last],
    [first, last, last],
    [first, { ...last, output: first.output }],
  ])
    assert.deepEqual(
      observedEngagementFacts(
        "orientations-03",
        [...prefix, ...pages],
        new Set()
      ).evidence,
      []
    );
  const repeatedPerson = {
    ...attendance,
    output: {
      ...output,
      counts: { matched: 4 },
      items: [
        ...output.items,
        { ...output.items[1]!, id: "different-orientation-same-person" },
      ],
    },
  };
  assert.deepEqual(
    observedEngagementFacts(
      "orientations-03",
      [...prefix, repeatedPerson],
      new Set()
    ).facts.peopleIds,
    orientationPeople.slice(1).sort()
  );
});

test("orientation assignment pages preserve active status and empty populations are factual only after a successful complete read", () => {
  const base = orientationReads();
  const assignment = base[0]!;
  const output = assignment.output as {
    kind: string;
    counts: { matched: number };
    items: Array<{
      id: string;
      label: string;
      facts: Array<{ label: string; value: string }>;
    }>;
  };
  const request = (cursor?: string) => ({
    request: {
      resource: "assignments",
      where: { all: [], any: [] },
      query: {
        mode: "list",
        limit: 1,
        sort: "name",
        direction: "asc",
        ...(cursor ? { cursor } : {}),
      },
    },
  });
  const first = {
    ...assignment,
    input: request(),
    output: { ...output, items: output.items.slice(0, 1) },
  };
  const next = {
    ...assignment,
    id: "assignment-next",
    input: request("1"),
    output: { ...output, items: output.items.slice(1) },
  };
  const rest = base.filter((call) => call.name !== "teams.query");
  assert.deepEqual(
    observedEngagementFacts(
      "orientations-03",
      [...rest, first, next],
      new Set()
    ).facts.peopleIds,
    orientationPeople.slice(1).sort()
  );
  for (const pages of [
    [first],
    [next],
    [first, next, next],
    [first, { ...next, input: request("2") }],
  ])
    assert.deepEqual(
      observedEngagementFacts("orientations-03", [...rest, ...pages], new Set())
        .evidence,
      []
    );
  for (const missing of ["Person ID", "Status"]) {
    const malformed = {
      ...assignment,
      output: {
        ...output,
        items: output.items.map((row) => ({
          ...row,
          facts: row.facts.filter((fact) => fact.label !== missing),
        })),
      },
    };
    assert.deepEqual(
      observedEngagementFacts(
        "orientations-03",
        [...rest, malformed],
        new Set()
      ).evidence,
      []
    );
  }
  const empty = {
    ...assignment,
    output: { kind: "read", counts: { matched: 0 }, items: [] },
  };
  assert.deepEqual(
    observedEngagementFacts("orientations-03", [...rest, empty], new Set())
      .facts.peopleIds,
    [...orientationPeople].sort()
  );
  const noAttendees = rest.map((call) =>
    call.name === "attendance.query" ? { ...call, output: empty.output } : call
  );
  assert.deepEqual(
    observedEngagementFacts(
      "orientations-03",
      [...noAttendees, empty],
      new Set()
    ),
    {
      facts: { peopleIds: [] },
      evidence: ["actual-orientation-without-current-membership"],
    }
  );
});

test("six engagement bindings retain the original questions and follow-up", () => {
  assert.deepEqual(
    engagementFixtureIds.map((id) => questions.find((q) => q.id === id)?.turns),
    [
      ["List prospects added in the last 30 days with the volunteer tag."],
      [
        "Show prospects with the volunteer tag.",
        "Only the ones added this month. Keep the same tag.",
      ],
      ["What meetings are happening this week, and where?"],
      ["Which upcoming meetings have unfinished preparation checklists?"],
      ["What feedback did we record for our last two meetings?"],
      ["Who attended orientation but has not joined a ministry?"],
    ]
  );
});

test("engagement IDs are deterministic and isolated between cases and repetitions", () => {
  const value = engagementId(
    createFixtureManifest("people-02", 0),
    "month-start"
  );
  assert.equal(
    value,
    engagementId(createFixtureManifest("people-02", 0), "month-start")
  );
  assert.notEqual(
    value,
    engagementId(createFixtureManifest("people-02", 1), "month-start")
  );
  assert.notEqual(
    value,
    engagementId(createFixtureManifest("people-08", 0), "month-start")
  );
});

test("model-written facts and absent captures cannot establish engagement evidence", () => {
  for (const id of engagementFixtureIds) {
    assert.deepEqual(observedEngagementFacts(id, [], new Set()), {
      facts: {},
      evidence: [],
    });
    assert.deepEqual(
      observedEngagementFacts(
        id,
        [
          {
            id: "untrusted",
            name: "people.query",
            input: {},
            output: {
              facts: { peopleIds: ["alex"] },
              answer: "I checked everyone.",
            },
          },
        ],
        new Set(["untrusted"])
      ),
      { facts: {}, evidence: [] }
    );
  }
});

function peoplePage(
  id: string,
  ids: string[],
  matched: number,
  created?: { from: string; through: string },
  afterId?: string
): CapturedCall {
  return {
    id,
    name: "people.query",
    input: {
      cohort: {
        all: {
          stages: ["prospect"],
          tags: { names: ["volunteer"] },
          ...(created ? { created } : {}),
        },
      },
      result: { mode: "list", limit: 2, ...(afterId ? { afterId } : {}) },
    },
    output: {
      kind: "read",
      counts: { matched },
      items: ids.map((id) => ({ id, label: id })),
    },
  };
}

test("tag follow-up records initial and narrowed cohorts without mixing their pages", () => {
  const calls = [
    peoplePage("first", ["a", "b"], 3),
    peoplePage("second", ["c"], 3, undefined, "b"),
    peoplePage("narrowed", ["b"], 1, {
      from: "2026-09-01",
      through: "2026-09-30",
    }),
  ];
  assert.deepEqual(observedEngagementFacts("people-08", calls, new Set()), {
    facts: { initialPeopleIds: ["a", "b", "c"], peopleIds: ["b"] },
    evidence: ["complete-tagged-prospect-window"],
  });
  assert.deepEqual(
    observedEngagementFacts("people-08", calls.slice(1), new Set()).evidence,
    []
  );
});

test("month-to-date evidence uses actual returned records, without hiding future rows in the observer", () => {
  const initial = peoplePage("initial", ["past", "future"], 2);
  const narrowed = peoplePage("month-to-date", ["past"], 1);
  narrowed.input = {
    cohort: {
      all: {
        stages: ["prospect"],
        tags: { names: ["volunteer"] },
        createdWindow: {
          from: "2026-09-01T04:00:00Z",
          until: "2026-09-20T16:00:00Z",
        },
      },
    },
    result: { mode: "list", limit: 2 },
  };
  assert.deepEqual(
    observedEngagementFacts("people-08", [initial, narrowed], new Set()).facts,
    { initialPeopleIds: ["future", "past"], peopleIds: ["past"] }
  );
  const wrong = { ...narrowed, output: initial.output };
  assert.deepEqual(
    observedEngagementFacts("people-08", [initial, wrong], new Set()).facts
      .peopleIds,
    ["future", "past"]
  );
});

test("partial and duplicated pages cannot establish complete result evidence", () => {
  for (const calls of [
    [peoplePage("first", ["a", "b"], 3)],
    [
      peoplePage("first", ["a", "b"], 3),
      peoplePage("second", ["b"], 3, undefined, "b"),
    ],
  ]) {
    assert.deepEqual(
      observedEngagementFacts("people-02", calls, new Set()).evidence,
      []
    );
  }
  assert.deepEqual(
    observedEngagementFacts(
      "people-02",
      [
        peoplePage("first", ["a", "b"], 3),
        peoplePage("second", ["c"], 3, undefined, "b"),
      ],
      new Set()
    ).evidence,
    ["complete-tagged-prospect-window"]
  );
});

test("a repeated complete query uses the refreshed records, not a union of both reads", () => {
  const initial = peoplePage("initial", ["old"], 1);
  const current = peoplePage("refresh", ["a", "b"], 2);
  assert.deepEqual(
    observedEngagementFacts(
      "people-02",
      [initial, current, { ...current, id: "again" }],
      new Set()
    ),
    {
      facts: { peopleIds: ["a", "b"] },
      evidence: ["complete-tagged-prospect-window"],
    }
  );
  assert.deepEqual(
    observedEngagementFacts(
      "people-02",
      [
        peoplePage("complete", ["a", "b"], 2),
        peoplePage("incomplete-refresh", ["a"], 2),
      ],
      new Set()
    ).evidence,
    []
  );
});

test("an entire paginated refresh replaces the old pagination run", () => {
  const calls = [
    peoplePage("old-first", ["a", "b"], 3),
    peoplePage("old-next", ["c"], 3, undefined, "b"),
    peoplePage("refresh-first", ["b", "d"], 3),
    peoplePage("refresh-next", ["e"], 3, undefined, "d"),
  ];
  assert.deepEqual(observedEngagementFacts("people-02", calls, new Set()), {
    facts: { peopleIds: ["b", "d", "e"] },
    evidence: ["complete-tagged-prospect-window"],
  });
  assert.deepEqual(
    observedEngagementFacts("people-02", calls.slice(0, -1), new Set())
      .evidence,
    []
  );
});

test("equivalent nested filter key order keeps pages in the same read", () => {
  const window = { from: "2026-09-01", through: "2026-09-30" };
  const first = peoplePage("first", ["a", "b"], 3, window);
  const last = peoplePage("last", ["c"], 3, window, "b");
  last.input = {
    result: { afterId: "b", limit: 2, mode: "list" },
    cohort: {
      all: {
        created: { through: window.through, from: window.from },
        tags: { names: ["volunteer"] },
        stages: ["prospect"],
      },
    },
  };
  assert.deepEqual(
    observedEngagementFacts("people-02", [first, last], new Set()),
    {
      facts: { peopleIds: ["a", "b", "c"] },
      evidence: ["complete-tagged-prospect-window"],
    }
  );
});

test("missing first or middle pages and repeated continuation pages remain invalid", () => {
  const first = peoplePage("first", ["a", "b"], 4);
  const last = peoplePage("last", ["c", "d"], 4, undefined, "b");
  for (const calls of [
    [last],
    [first, peoplePage("skipped", ["e", "f"], 4, undefined, "d")],
    [first, last, { ...last, id: "repeated-continuation" }],
    [first, peoplePage("overlap", ["b", "c"], 4, undefined, "b")],
  ])
    assert.deepEqual(
      observedEngagementFacts("people-02", calls, new Set()).evidence,
      []
    );
});

test("meeting offset pages use the final read and reject missing or repeated continuations", () => {
  const page = (id: string, ids: string[], cursor?: string): CapturedCall => ({
    id,
    name: "meetings.query",
    input: {
      where: { all: [{ statuses: ["ready"], timing: "upcoming" }] },
      query: { mode: "list", limit: 2, ...(cursor ? { cursor } : {}) },
    },
    output: {
      kind: "read",
      counts: { matched: 3 },
      items: ids.map((id) => ({
        id,
        label: id,
        facts: [
          { label: "When", value: "10 AM" },
          { label: "Location", value: "Church" },
        ],
      })),
    },
  });
  const first = page("first", ["a", "b"]),
    last = page("last", ["c"], "2");
  const refreshFirst = page("refresh-first", ["a", "b"], "0"),
    refreshLast = page("refresh-last", ["c"], "2");
  refreshLast.input = {
    query: {
      direction: "asc",
      sort: "date",
      mode: "list",
      limit: 2,
      cursor: "2",
    },
    where: { all: [{ timing: "upcoming", statuses: ["ready"] }] },
  };
  const good = observedEngagementFacts(
    "meetings-01",
    [first, last, refreshFirst, refreshLast],
    new Set()
  );
  assert.deepEqual(good.facts.meetingIds, ["a", "b", "c"]);
  assert.deepEqual(good.evidence, ["complete-church-local-week"]);
  for (const calls of [
    [last],
    [first, page("missing-offset", ["c"], "4")],
    [first, last, { ...last, id: "duplicate" }],
    [first, last, refreshFirst],
  ])
    assert.deepEqual(
      observedEngagementFacts("meetings-01", calls, new Set()).evidence,
      []
    );
});

test("latest meeting feedback preserves a missing record instead of inventing feedback", () => {
  const query: CapturedCall = {
    id: "meetings",
    name: "meetings.query",
    input: {
      where: { all: [{ statuses: ["completed"] }] },
      query: { mode: "list", limit: 2, direction: "desc", sort: "date" },
    },
    output: {
      kind: "read",
      counts: { matched: 10 },
      items: [
        { id: "latest", label: "Latest" },
        { id: "second", label: "Second" },
      ],
    },
  };
  const details: CapturedCall = {
    id: "details",
    name: "meetings.get_many",
    input: { ids: ["latest", "second"], sections: ["evaluation"] },
    output: {
      kind: "read",
      counts: { matched: 2 },
      items: [
        {
          id: "latest",
          label: "Latest",
          facts: [
            { label: "Evaluation notes", value: "Not recorded" },
            { label: "Evaluation score", value: "Not recorded" },
          ],
        },
        {
          id: "second",
          label: "Second",
          facts: [
            { label: "Evaluation notes", value: "Welcome was warm." },
            { label: "Evaluation score", value: "24" },
          ],
        },
      ],
    },
  };
  assert.deepEqual(
    observedEngagementFacts("meetings-07", [query, details], new Set()),
    {
      facts: {
        meetingIds: ["latest", "second"],
        evaluations: [
          "latest: Not recorded | Not recorded",
          "second: Welcome was warm. | 24",
        ],
      },
      evidence: ["latest-two-recorded-or-missing-evaluations"],
    }
  );
  assert.deepEqual(
    observedEngagementFacts("meetings-07", [query], new Set()).evidence,
    []
  );
});
