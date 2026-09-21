import assert from "node:assert/strict";
import { test } from "node:test";
import { questions, regressions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import { createFixtureManifest } from "./manifest";
import {
  observedReadinessCohortFacts,
  readinessCohortFixtureIds,
  readinessCohortId,
} from "./readiness-cohorts";

test("seven readiness bindings retain original questions, including three-turn pagination", () => {
  const corpus = [...questions, ...regressions];
  assert.equal(new Set(readinessCohortFixtureIds).size, 7);
  for (const id of readinessCohortFixtureIds)
    assert.ok(corpus.find((c) => c.id === id));
  assert.deepEqual(corpus.find((c) => c.id === "cross-04")?.turns, [
    "Show people without interviews.",
    "Just the people who attended twice.",
    "Show the next page.",
  ]);
  assert.deepEqual(corpus.find((c) => c.id === "notes-03")?.turns, [
    "Who has an open follow-up task but no completed follow-up recorded?",
  ]);
});

test("seed identities are deterministic and case/repetition scoped", () => {
  const m = createFixtureManifest("notes-03", 0);
  assert.equal(readinessCohortId(m, "sunday"), readinessCohortId(m, "sunday"));
  assert.notEqual(
    readinessCohortId(m, "sunday"),
    readinessCohortId(createFixtureManifest("notes-03", 1), "sunday")
  );
  assert.notEqual(
    readinessCohortId(m, "sunday"),
    readinessCohortId(createFixtureManifest("meetings-04", 0), "sunday")
  );
});

const item = (id: string, facts: Record<string, string> = {}) => ({
  id,
  label: id,
  facts: Object.entries(facts).map(([label, value]) => ({ label, value })),
});
function read(
  id: string,
  name: string,
  input: unknown,
  items: ReturnType<typeof item>[],
  matched = items.length
): CapturedCall {
  return {
    id,
    name,
    input,
    output: { kind: "read", counts: { matched }, items },
  };
}
function page(
  id: string,
  ids: string[],
  afterId?: string,
  all: object = {
    interview: "not_recorded",
    attendance: { minimumMeetings: 2 },
  }
): CapturedCall {
  return read(
    id,
    "people.query",
    {
      cohort: { all },
      result: { mode: "list", limit: 2, ...(afterId ? { afterId } : {}) },
    },
    ids.map((id) => item(id)),
    5
  );
}

test("observer cannot accept model-written facts without trusted read captures", () => {
  for (const id of readinessCohortFixtureIds) {
    const result = observedReadinessCohortFacts(
      id,
      [
        {
          id: "fake",
          name: "people.query",
          input: {},
          output: { facts: { personIds: ["a"] } },
        },
      ],
      new Set(["fake"])
    );
    assert.equal(result.evidence.length, 0);
    assert.equal(result.facts.personIds, undefined);
  }
});

test("next page does not require fetching every remaining page", () => {
  const result = observedReadinessCohortFacts(
    "cross-04",
    [page("one", ["a", "b"]), page("two", ["c", "d"], "b")],
    new Set()
  );
  assert.deepEqual(result, {
    facts: {
      total: 5,
      duplicateIds: [],
      filtersPreserved: true,
      paginationCoherent: true,
    },
    evidence: ["continued-filtered-people-pages"],
  });
});

test("pagination preserves stage in the prospect-specific original regression", () => {
  const missingStage = [page("one", ["a", "b"]), page("two", ["c", "d"], "b")];
  assert.equal(
    observedReadinessCohortFacts(
      "regression-pagination",
      missingStage,
      new Set()
    ).facts.filtersPreserved,
    false
  );
  const cohort = {
    stages: ["prospect"],
    interview: "not_recorded",
    attendance: { minimumMeetings: 2 },
  };
  assert.equal(
    observedReadinessCohortFacts(
      "regression-pagination",
      [
        page("one", ["a", "b"], undefined, cohort),
        page("two", ["c", "d"], "b", cohort),
      ],
      new Set()
    ).facts.filtersPreserved,
    true
  );
});

test("a fresh read replaces old pages and equivalent object key order is coherent", () => {
  const calls = [
    page("old-one", ["a", "b"]),
    page("old-two", ["c", "d"], "b"),
    page("new-one", ["a", "b"]),
    page("new-two", ["c", "d"], "b", {
      attendance: { minimumMeetings: 2 },
      interview: "not_recorded",
    }),
  ];
  assert.equal(
    observedReadinessCohortFacts("cross-04", calls, new Set()).facts
      .paginationCoherent,
    true
  );
  assert.deepEqual(
    observedReadinessCohortFacts("cross-04", calls, new Set()).facts
      .duplicateIds,
    []
  );
});

test("missing pages, duplicate rows, changed predicates and shifted cursors cannot pass", () => {
  for (const calls of [
    [page("two", ["c", "d"], "b")],
    [page("one", ["a", "b"]), page("two", ["b", "d"], "b")],
    [page("one", ["a", "b"]), page("two", ["c", "d"], "wrong")],
    [
      page("one", ["a", "b"]),
      page("two", ["c", "d"], "b", { attendance: { minimumMeetings: 2 } }),
    ],
  ])
    assert.equal(
      observedReadinessCohortFacts("cross-04", calls, new Set()).evidence
        .length,
      0
    );
});

test("unrelated preliminary cohorts are not unioned with final filtered pages", () => {
  const calls = [
    page("broad", ["x", "y"], undefined, { interview: "not_recorded" }),
    page("one", ["a", "b"]),
    page("two", ["c", "d"], "b"),
  ];
  assert.deepEqual(
    observedReadinessCohortFacts("cross-04", calls, new Set()).facts,
    {
      total: 5,
      duplicateIds: [],
      filtersPreserved: true,
      paginationCoherent: true,
    }
  );
});

test("an added hidden cohort restriction cannot pass merely by returning the same count", () => {
  const extra = {
    interview: "not_recorded",
    attendance: { minimumMeetings: 2 },
    search: "Alex",
  };
  const result = observedReadinessCohortFacts(
    "cross-04",
    [
      page("one", ["a", "b"], undefined, extra),
      page("two", ["c", "d"], "b", extra),
    ],
    new Set()
  );
  assert.equal(result.facts.total, 5);
  assert.equal(result.facts.filtersPreserved, false);
  assert.equal(result.evidence.length, 0);
});

test("separate recommendations do not require one particular follow-up or attendance threshold", () => {
  const calls = [
    read(
      "interview",
      "people.query",
      {
        cohort: { all: { interview: "not_recorded" } },
        result: { mode: "list" },
      },
      [item("a")]
    ),
    read(
      "orientation",
      "people.query",
      {
        cohort: {
          all: {
            attendance: { maximumMeetings: 0, meetingTypes: ["orientation"] },
          },
        },
        result: { mode: "list" },
      },
      [item("a"), item("b")]
    ),
  ];
  assert.deepEqual(observedReadinessCohortFacts("cross-02", calls, new Set()), {
    facts: { interviewAbsenceChecked: true, orientationAbsenceChecked: true },
    evidence: ["recorded-readiness-dimensions"],
  });
});

test("cross-02 negative loses orientation evidence even when interview and attendance reads are valid", () => {
  const calls = [
    read(
      "interviews",
      "people.query",
      {
        cohort: { all: { interview: "not_recorded" } },
        result: { mode: "list" },
      },
      [item("a")]
    ),
    read(
      "attendance",
      "people.query",
      {
        cohort: {
          all: {
            interview: "not_recorded",
            attendance: { minimumMeetings: 2 },
          },
        },
        result: { mode: "list" },
      },
      [item("a")]
    ),
    read(
      "wrong-orientation",
      "people.query",
      {
        cohort: { all: { stages: ["launch_team"] } },
        result: { mode: "list" },
      },
      [item("a")]
    ),
  ];
  const observed = observedReadinessCohortFacts("cross-02", calls, new Set());
  assert.deepEqual(observed.facts, {
    interviewAbsenceChecked: true,
    orientationAbsenceChecked: false,
  });
  assert.deepEqual(observed.evidence, []);
});

test("task ownership normalizes explicit null display but never invents an unassigned owner from missing evidence", () => {
  const account = "11111111-1111-4111-8111-111111111111";
  const variants: Array<{
    fields: Record<string, string>;
    expected: string;
    complete: boolean;
  }> = [
    {
      fields: { "Assignee account ID": account, Assignee: "Fixture Owner" },
      expected: account,
      complete: true,
    },
    {
      fields: { "Assignee account ID": "Not recorded", Assignee: "Unassigned" },
      expected: "unassigned",
      complete: true,
    },
    {
      fields: { Assignee: "Unassigned" },
      expected: "unknown",
      complete: false,
    },
    {
      fields: {
        "Assignee account ID": "Not recorded",
        Assignee: "Unavailable account",
      },
      expected: "unknown",
      complete: false,
    },
    { fields: {}, expected: "unknown", complete: false },
  ];
  for (const variant of variants) {
    const calls = [
      read("meeting", "meetings.query", { query: { mode: "list" } }, [
        item("meeting"),
      ]),
      read("attendance", "attendance.query", { result: { mode: "list" } }, [
        item("attendance", {
          person_id: "person",
          meeting_id: "meeting",
          Attendance: "Attended",
        }),
      ]),
      read("tasks", "tasks.query", { query: { mode: "list" } }, [
        item("task", variant.fields),
      ]),
      read(
        "people",
        "people.get_many",
        { resource: "person", ids: ["person"] },
        [item("person")]
      ),
    ];
    const result = observedReadinessCohortFacts(
      "meetings-04",
      calls,
      new Set(["people"])
    );
    assert.deepEqual(result.facts.taskOwners, [`task:${variant.expected}`]);
    assert.equal(
      result.evidence.includes("sunday-attendance-and-current-task-ownership"),
      variant.complete
    );
  }
});

test("open and completed follow-up evidence is kept separate", () => {
  const open = read(
    "open",
    "people.history.query",
    {
      resource: { kind: "follow_up", state: "open" },
      cohort: { all: { followUp: "not_recorded" } },
      result: { mode: "list" },
    },
    [
      item("task-a", { person_id: "a", "Recorded outcome": "Not started" }),
      item("task-b", { person_id: "a", "Recorded outcome": "Blocked" }),
    ]
  );
  assert.deepEqual(
    observedReadinessCohortFacts("notes-03", [open], new Set()),
    {
      facts: { personIds: ["a"] },
      evidence: ["open-follow-up-without-completion"],
    }
  );
  open.input = {
    resource: { kind: "follow_up", state: "open" },
    result: { mode: "list" },
  };
  assert.equal(
    observedReadinessCohortFacts("notes-03", [open], new Set()).evidence.length,
    0
  );
});

test("orientation requires actual commitment and no recorded orientation attendance, not stage", () => {
  const call = read(
    "orientation",
    "people.query",
    {
      cohort: {
        all: {
          commitment: { existence: "recorded", types: ["launch_team"] },
          attendance: { maximumMeetings: 0, meetingTypes: ["orientation"] },
        },
      },
      result: { mode: "list" },
    },
    [item("a")]
  );
  assert.deepEqual(
    observedReadinessCohortFacts("orientations-02", [call], new Set()).facts
      .personIds,
    ["a"]
  );
  assert.equal(
    observedReadinessCohortFacts("orientations-02", [call], new Set()).evidence
      .length,
    1
  );
  call.input = {
    cohort: { all: { stages: ["launch_team"] } },
    result: { mode: "list" },
  };
  assert.equal(
    observedReadinessCohortFacts("orientations-02", [call], new Set()).evidence
      .length,
    0
  );
});

test("synthesis observes real dimensions without mandating a recommendation threshold", () => {
  for (const threshold of [1, 2, 3]) {
    const calls = [
      read(
        "interview",
        "people.query",
        {
          cohort: {
            all: {
              interview: "not_recorded",
              attendance: { minimumMeetings: threshold },
            },
          },
          result: { mode: "list" },
        },
        [item("a")]
      ),
      read(
        "follow-up",
        "people.history.query",
        {
          resource: { kind: "follow_up", state: "completed" },
          result: { mode: "list" },
        },
        [item("f", { person_id: "a", "Recorded outcome": "Complete" })]
      ),
    ];
    assert.deepEqual(
      observedReadinessCohortFacts("interviews-06", calls, new Set()).facts,
      {
        interviewAbsenceChecked: true,
        actualAttendanceReviewed: true,
        completedFollowUpReviewed: true,
      }
    );
  }
});

test("RSVP-only, empty and incomplete reads do not establish factual synthesis dimensions", () => {
  const calls = [
    read(
      "interview",
      "people.query",
      {
        cohort: { all: { interview: "not_recorded" } },
        result: { mode: "list" },
      },
      [item("a")],
      2
    ),
    read(
      "attendance",
      "attendance.query",
      { rsvp: ["confirmed"], result: { mode: "list" } },
      [item("r", { Attendance: "Absent" })]
    ),
    read(
      "follow-up",
      "people.history.query",
      {
        resource: { kind: "follow_up", state: "completed" },
        result: { mode: "list" },
      },
      []
    ),
  ];
  assert.deepEqual(
    observedReadinessCohortFacts("interviews-06", calls, new Set()).facts,
    {
      interviewAbsenceChecked: false,
      actualAttendanceReviewed: false,
      completedFollowUpReviewed: false,
    }
  );
  assert.equal(
    observedReadinessCohortFacts("cross-02", calls, new Set()).facts
      .orientationAbsenceChecked,
    false
  );
});
