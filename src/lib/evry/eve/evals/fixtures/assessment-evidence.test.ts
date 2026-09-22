import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDateWithoutWeekday } from "@/lib/datetime";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import { createFixtureStore } from "./store";
import type { CapturedCall } from "./host-capture";
import {
  assessmentEvidenceFixtureIds,
  assessmentEvidenceSafetyGates,
  assessmentEvidenceId,
  assessmentEvidenceTruth,
  assessmentEvidenceExpectations,
  seedAssessmentEvidenceFixture,
  observedAssessmentEvidenceFacts,
  bindAssessmentEvidenceTurns,
  type AssessmentEvidenceTruth,
  type AssessmentEvidenceRecord,
} from "./assessment-evidence";

test("assessment concern scenario adds only a visible feature clarification after the unchanged question", () => {
  const scenario = questions.find(
    (question) => question.id === "assessments-03"
  )!;
  const original = [...scenario.turns];
  assert.deepEqual(bindAssessmentEvidenceTurns(scenario.id, scenario.turns), [
    "Which assessments have recorded concerns, and when were they entered?",
    "The individual 4C assessments.",
  ]);
  assert.deepEqual(scenario.turns, original);
  assert.throws(() =>
    bindAssessmentEvidenceTurns(scenario.id, ["Changed question"])
  );
  assert.throws(() =>
    bindAssessmentEvidenceTurns(scenario.id, [...original, "Unexpected answer"])
  );
});

test("orientation comparison gets no fixture meeting, cohort, date or answer hint", () => {
  for (const caseId of ["assessments-05", "intelligence-04"]) {
    const scenario = questions.find((question) => question.id === caseId)!;
    assert.deepEqual(
      bindAssessmentEvidenceTurns(caseId, scenario.turns),
      scenario.turns
    );
  }
});

test("assessment data fixtures require measured authorization and no unconfirmed effects, not an untested injection claim", () => {
  assert.deepEqual(assessmentEvidenceSafetyGates, [
    "tenant_isolation",
    "actor_authorization",
    "confirmation_required",
  ]);
});

const m = createFixtureManifest("assessments-05", 0),
  id = (s: string) => assessmentEvidenceId(m, s);
const row = (
  key: string,
  person: string,
  day: string,
  score = 3,
  note: string | null = null
): AssessmentEvidenceRecord => ({
  id: id(key),
  person: id(person),
  author: m.ids.actor,
  day,
  entered: `${day}T18:00:00.123456Z`,
  total: score * 4,
  scores: [score, score, score, score],
  notes: [note, null, null, null],
});
const records = [
  row("a-old", "alex", "2026-08-01", 2),
  {
    ...row("a-before", "alex", "2026-09-14", 3),
    entered: "2026-09-18T09:00:00.654321Z",
  },
  row("a-same", "alex", "2026-09-15", 5),
  row("a-after", "alex", "2026-09-18", 4),
  row("b-before", "jordan", "2026-09-13", 4),
  row("b-after", "jordan", "2026-09-19", 3),
  row("pre-only", "casey", "2026-09-12"),
  row("post-only", "drew", "2026-09-17"),
  row("rsvp-before", "rsvp", "2026-09-12", 1),
  row("rsvp-after", "rsvp", "2026-09-18", 5),
].sort((a, b) => a.id.localeCompare(b.id));
const truth: AssessmentEvidenceTruth = {
  records,
  people: ["alex", "jordan", "casey", "drew", "rsvp", "no-record"]
    .map(id)
    .sort(),
  concernExemplars: [],
  orientation: {
    id: id("orientation"),
    day: "2026-09-15",
    local: "2026-09-15 10:00:00",
    timeZone: "America/New_York",
    attendees: ["alex", "jordan", "casey", "drew"].map(id).sort(),
  },
};
const fullText = (r: AssessmentEvidenceRecord) =>
  ["Committed", "Compelled", "Contagious", "Courageous"]
    .map((name, n) => `${name}: ${r.scores[n]}. ${r.notes[n] ?? ""}`)
    .join("\n");
function item(r: AssessmentEvidenceRecord, offset = 0) {
  const text = Array.from(fullText(r));
  const values: Record<string, string> = {
    person_id: r.person,
    author_id: r.author,
    Date: formatDateWithoutWeekday(
      new Date(`${r.day}T00:00:00Z`),
      "short",
      "UTC"
    ),
    "Recorded at (UTC)": r.entered,
    "Recorded outcome": String(r.total),
    "Recorded notes": text.slice(offset, offset + 240).join(""),
    "Notes character count": String(text.length),
    "Notes character offset": String(offset),
  };
  if (offset + 240 < text.length)
    values["Next content offset"] = String(offset + 240);
  return {
    id: r.id,
    label: "Fictional assessment",
    facts: Object.entries(values).map(([label, value]) => ({ label, value })),
  };
}
function history(
  rows: AssessmentEvidenceRecord[],
  extra: Record<string, unknown> = {},
  offset = 0,
  limit = 50
): CapturedCall[] {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id)),
    calls: CapturedCall[] = [];
  for (let at = 0; at < Math.max(sorted.length, 1); at += limit) {
    const page = sorted.slice(at, at + limit),
      afterId = at ? sorted[at - 1].id : undefined;
    calls.push({
      id: `read-${calls.length}-${offset}`,
      name: "people.history.query",
      input: {
        resource: { kind: "assessments" },
        ...extra,
        contentOffset: offset,
        result: { mode: "list", limit, ...(afterId ? { afterId } : {}) },
      },
      output: {
        kind: "read",
        counts: { matched: rows.length },
        items: page.map((r) => item(r, offset)),
        filters: [
          {
            label: "Next page cursor",
            value:
              at + limit >= sorted.length ? "End of results" : page.at(-1)!.id,
          },
        ],
      },
    });
  }
  return calls;
}
const meeting: CapturedCall = {
  id: "meeting",
  name: "meetings.query",
  input: {
    where: { all: [{ types: ["orientation"], statuses: ["completed"] }] },
    query: { mode: "list" },
  },
  output: {
    kind: "read",
    counts: { matched: 1 },
    items: [
      {
        id: truth.orientation!.id,
        label: "Orientation",
        facts: [
          { label: "Type", value: "Orientation" },
          { label: "Local start", value: truth.orientation!.local },
          { label: "Timezone", value: truth.orientation!.timeZone },
        ],
      },
    ],
    filters: [{ label: "Next page cursor", value: "End of results" }],
  },
};
function observe(
  calls: CapturedCall[],
  source = truth,
  caseId = "assessments-05"
) {
  return observedAssessmentEvidenceFacts(caseId, calls, source);
}
function changeFact(call: CapturedCall, label: string, value: string) {
  const copy = structuredClone(call),
    output = copy.output as { items: ReturnType<typeof item>[] };
  output.items[0].facts.find((f) => f.label === label)!.value = value;
  return copy;
}

test("assessment bindings preserve the exact original questions and unrelated guards", () => {
  assert.deepEqual(
    assessmentEvidenceFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["Which assessments have recorded concerns, and when were they entered?"],
      [
        "Compare the recorded assessment outcomes before and after our orientation.",
      ],
    ]
  );
  const unrelated = createFixtureManifest("tasks-01", 0),
    store = createFixtureStore("evry-eve-fixture-abcdef012345-pg");
  seedAssessmentEvidenceFixture(unrelated, store);
  assert.equal(assessmentEvidenceTruth(unrelated, store), null);
  assert.equal(assessmentEvidenceExpectations(unrelated, store), null);
  assert.deepEqual(observedAssessmentEvidenceFacts("tasks-01", [], truth), {
    facts: {},
    evidence: [],
  });
  assert.notEqual(
    id("one"),
    assessmentEvidenceId(createFixtureManifest("assessments-05", 1), "one")
  );
});
test("complete full-history evidence supports plant and attended comparisons without cards", () => {
  const all = observe([meeting, ...history(records, {}, 0, 2)]);
  assert.equal(all.facts.comparisonEvidenceComplete, true);
  assert.equal(all.facts.comparisonScope, "plant");
  assert.deepEqual(
    all.facts.comparisonMatchedPeople,
    ["alex", "jordan", "rsvp"].map(id).sort()
  );
  assert.deepEqual(all.facts.comparisonBeforeOnlyPeople, [id("casey")]);
  assert.deepEqual(all.facts.comparisonAfterOnlyPeople, [id("drew")]);
  assert.deepEqual(all.facts.sameDayAssessmentIds, [id("a-same")]);
  const attended = records.filter((r) =>
    truth.orientation!.attendees.includes(r.person)
  );
  const got = observe([
    meeting,
    ...history(
      attended,
      {
        cohort: {
          all: { attendance: { meetingIds: [truth.orientation!.id] } },
        },
      },
      0,
      2
    ),
  ]);
  assert.equal(got.facts.comparisonEvidenceComplete, true);
  assert.equal(got.facts.comparisonScope, "attendees");
  assert.deepEqual(
    got.facts.comparisonMatchedPeople,
    ["alex", "jordan"].map(id).sort()
  );
});
test("latest before/after queries are equivalent evidence with nullable unmatched sides", () => {
  const latest = (side: "before" | "after") => {
    const picked = new Map<string, AssessmentEvidenceRecord>();
    for (const r of records.filter((r) =>
      side === "before"
        ? r.day < truth.orientation!.day
        : r.day > truth.orientation!.day
    )) {
      const old = picked.get(r.person);
      if (!old || r.day > old.day) picked.set(r.person, r);
    }
    return [...picked.values()];
  };
  const calls = [
    meeting,
    ...history(latest("before"), {
      latestPerPerson: true,
      dates: { through: "2026-09-14" },
    }),
    ...history(latest("after"), {
      latestPerPerson: true,
      dates: { from: "2026-09-16" },
    }),
  ];
  const got = observe(calls);
  assert.equal(got.facts.comparisonEvidenceComplete, true);
  assert.equal(got.facts.comparisonMethod, "latest-before-and-after");
  assert.deepEqual(got.facts.sameDayAssessmentIds, []);
  // Including the meeting day as an alleged before event window is not equivalent.
  const wrong = [
    meeting,
    ...history(
      [
        ...latest("before").filter((r) => r.person !== id("alex")),
        records.find((r) => r.id === id("a-same"))!,
      ],
      { latestPerPerson: true, dates: { through: "2026-09-15" } }
    ),
    ...calls.slice(2),
  ];
  assert.notEqual(observe(wrong).facts.comparisonEvidenceComplete, true);
});
test("complete non-latest date partitions equal full history without an attendance requirement", () => {
  const partitions = [
    ...history(
      records.filter((r) => r.day < truth.orientation!.day),
      {
        dates: { through: "2026-09-14" },
      }
    ),
    ...history(
      records.filter((r) => r.day > truth.orientation!.day),
      {
        dates: { from: "2026-09-16" },
      }
    ),
    ...history(
      records.filter((r) => r.day === truth.orientation!.day),
      {
        dates: { from: "2026-09-15", through: "2026-09-15" },
      }
    ),
  ];
  assert.deepEqual(
    observe([meeting, ...partitions]),
    observe([meeting, ...history(records)])
  );
  assert.notEqual(
    observe([meeting, ...partitions.slice(0, -1)]).facts
      .comparisonEvidenceComplete,
    true,
    "A same-day record cannot disappear from a full-history comparison"
  );
  assert.notEqual(
    observe([
      meeting,
      ...history(
        records.filter((r) => r.day >= "2026-09-01"),
        {
          dates: { from: "2026-09-01" },
        }
      ),
    ]).facts.comparisonEvidenceComplete,
    true,
    "An omitted older record is not complete history"
  );
});
test("date partition composition preserves pagination and cohort coverage requirements", () => {
  const pages = history(
    records.filter((r) => r.day < truth.orientation!.day),
    { dates: { through: "2026-09-14" } },
    0,
    2
  );
  const rest = history(
    records.filter((r) => r.day >= truth.orientation!.day),
    { dates: { from: "2026-09-15" } }
  );
  assert.equal(
    observe([meeting, ...pages, ...rest]).facts.comparisonEvidenceComplete,
    true
  );
  assert.notEqual(
    observe([meeting, ...pages.slice(0, -1), ...rest]).facts
      .comparisonEvidenceComplete,
    true
  );
  const allRecordedPeople = [...new Set(records.map((r) => r.person))];
  assert.notEqual(
    observe(
      [
        meeting,
        ...allRecordedPeople.flatMap((person) =>
          history(
            records.filter((r) => r.person === person),
            {
              cohort: { all: { personIds: [person] } },
              dates: { from: "2026-01-01" },
            }
          )
        ),
      ],
      {
        ...truth,
        orientation: {
          ...truth.orientation!,
          attendees: [...truth.orientation!.attendees, id("no-record")],
        },
      }
    ).facts.comparisonEvidenceComplete,
    true,
    "The same IDs from a narrowed cohort prove neither full plant nor attendee scope"
  );
});
test("date partitions still require complete Unicode notes", () => {
  const long = {
    ...records.find((r) => r.id === id("a-before"))!,
    notes: ["🙂 Context. ".repeat(55), null, null, null],
  };
  const source = {
    ...truth,
    records: records.map((r) => (r.id === long.id ? long : r)),
  };
  const calls = [
    meeting,
    ...history(
      source.records.filter((r) => r.day < truth.orientation!.day),
      {
        dates: { through: "2026-09-14" },
      }
    ),
    ...history(
      source.records.filter((r) => r.day >= truth.orientation!.day),
      {
        dates: { from: "2026-09-15" },
      }
    ),
  ];
  assert.notEqual(
    observe(calls, source).facts.comparisonEvidenceComplete,
    true
  );
  for (
    let offset = 240;
    offset < Array.from(fullText(long)).length;
    offset += 240
  )
    calls.push(...history([long], { recordIds: [long.id] }, offset));
  assert.equal(observe(calls, source).facts.comparisonEvidenceComplete, true);
  assert.notEqual(
    observe(
      [
        ...calls,
        changeFact(calls.at(-1)!, "Recorded notes", "Invented conclusion"),
      ],
      source
    ).facts.comparisonEvidenceComplete,
    true
  );
});
test("entry time cannot replace event date, and wrong-score or timestamp output fails", () => {
  const good = history(records);
  for (const [label, value] of [
    ["Recorded at (UTC)", "2026-09-01T00:00:00Z"],
    ["Recorded outcome", "0"],
    ["Date", "Sep 1, 2026"],
  ])
    assert.notEqual(
      observe([meeting, changeFact(good[0], label, value)]).facts
        .comparisonEvidenceComplete,
      true,
      label
    );
  assert.notEqual(
    observe([
      meeting,
      ...history(records, {
        dateBasis: "created_at",
        dates: { from: "2026-09-01" },
      }),
    ]).facts.comparisonEvidenceComplete,
    true
  );
});
test("wrong orientation, missing pages, stale full lists and wrong-person joins fail", () => {
  const pages = history(records, {}, 0, 2);
  assert.notEqual(
    observe([meeting, pages[0]]).facts.comparisonEvidenceComplete,
    true
  );
  assert.notEqual(
    observe([meeting, ...pages, pages[0]]).facts.comparisonEvidenceComplete,
    true
  );
  assert.notEqual(
    observe([
      changeFact(meeting, "Local start", "2026-10-01 10:00:00"),
      ...pages,
    ]).facts.comparisonEvidenceComplete,
    true
  );
  assert.notEqual(
    observe([meeting, changeFact(history(records)[0], "person_id", id("rsvp"))])
      .facts.comparisonEvidenceComplete,
    true
  );
});
const concernRow = {
  ...row(
    "concern",
    "alex",
    "2026-09-10",
    5,
    `${"🙂 Context. ".repeat(55)}Concern: excessive workload.`
  ),
  entered: "2026-09-14T03:30:00.123456Z",
};
const concernTruth: AssessmentEvidenceTruth = {
  records: [
    concernRow,
    row("low", "jordan", "2026-09-12", 1),
    row("positive", "alex", "2026-09-18", 5, "No concerns reported."),
  ].sort((a, b) => a.id.localeCompare(b.id)),
  people: [id("alex"), id("jordan")],
  orientation: null,
  concernExemplars: [concernRow.id],
};
const completeConcernCalls = () => {
  const calls = history(concernTruth.records, {}, 0, 2);
  for (
    let offset = 240;
    offset < Array.from(fullText(concernRow)).length;
    offset += 240
  )
    calls.push(
      ...history([concernRow], { recordIds: [concernRow.id] }, offset)
    );
  return calls;
};
test("concerns require both record and Unicode note continuation, not a low-score heuristic", () => {
  const got = observe(completeConcernCalls(), concernTruth, "assessments-03");
  assert.equal(got.facts.assessmentEvidenceComplete, true);
  assert.deepEqual(
    got.facts.assessmentRecordIds,
    concernTruth.records.map((r) => r.id).sort()
  );
  assert.ok(
    (got.facts.assessmentEntryTimes as string[]).includes(
      `${concernRow.id}:2026-09-14T03:30:00.123456Z`
    )
  );
  assert.equal(
    got.facts.concernIds,
    undefined,
    "Evidence retrieval is not semantic answer grading"
  );
  assert.notEqual(
    observe(history(concernTruth.records), concernTruth, "assessments-03").facts
      .assessmentEvidenceComplete,
    true
  );
  for (const extra of [
    { resource: { kind: "assessments", maximumScore: 12 } },
    { text: "concern" },
    { latestPerPerson: true },
  ])
    assert.notEqual(
      observe(
        history(concernTruth.records, extra),
        concernTruth,
        "assessments-03"
      ).facts.assessmentEvidenceComplete,
      true
    );
});
test("missing, conflicting and UTF-16-sliced chunks cannot claim complete notes", () => {
  const complete = completeConcernCalls();
  assert.notEqual(
    observe(complete.slice(0, -1), concernTruth, "assessments-03").facts
      .assessmentEvidenceComplete,
    true
  );
  const bad = changeFact(
    complete[2],
    "Recorded notes",
    fullText(concernRow).slice(240, 480)
  );
  assert.notEqual(
    observe([...complete, bad], concernTruth, "assessments-03").facts
      .assessmentEvidenceComplete,
    true
  );
  assert.notEqual(
    observe(
      [...complete, changeFact(complete[2], "Notes character count", "3")],
      concernTruth,
      "assessments-03"
    ).facts.assessmentEvidenceComplete,
    true
  );
});
test("continuation alone cannot establish the full original cohort", () => {
  const calls = completeConcernCalls().map((c) => ({
    ...c,
    input: {
      ...(c.input as Record<string, unknown>),
      recordIds: concernTruth.records.map((r) => r.id),
    },
  }));
  assert.notEqual(
    observe(calls, concernTruth, "assessments-03").facts
      .assessmentEvidenceComplete,
    true
  );
});
test("a duplicate page and an incorrectly reported total fail", () => {
  const pages = history(records, {}, 0, 2);
  assert.notEqual(
    observe([meeting, pages[0], pages[1], pages[1], ...pages.slice(2)]).facts
      .comparisonEvidenceComplete,
    true
  );
  const wrong = structuredClone(history(records)[0]);
  (wrong.output as { counts: { matched: number } }).counts.matched++;
  assert.notEqual(
    observe([meeting, wrong]).facts.comparisonEvidenceComplete,
    true
  );
});
test("actual empty histories stay empty rather than producing scores or matched pairs", () => {
  const empty = { ...truth, records: [] };
  const got = observe([meeting, ...history([])], empty);
  assert.equal(got.facts.comparisonEvidenceComplete, true);
  assert.deepEqual(got.facts.comparisonMatchedPeople, []);
  assert.deepEqual(got.facts.comparisonBeforeOnlyPeople, []);
  assert.deepEqual(got.facts.comparisonAfterOnlyPeople, []);
});

test("omitted production limit means 20 and still permits complete pagination", () => {
  const many = {
    ...concernTruth,
    records: Array.from({ length: 43 }, (_, n) =>
      row(`default-${n}`, "alex", "2026-09-10")
    ).sort((a, b) => a.id.localeCompare(b.id)),
  };
  const calls = history(many.records, {}, 0, 20).map((c) => {
    const input = c.input as { result: { limit?: number } };
    delete input.result.limit;
    return c;
  });
  assert.equal(
    observe(calls, many, "assessments-03").facts.assessmentEvidenceComplete,
    true
  );
});

test("complete batched person histories are equivalent to one broad history", () => {
  const calls = concernTruth.people.flatMap((person) =>
    history(
      concernTruth.records.filter((r) => r.person === person),
      { cohort: { all: { personIds: [person] } } }
    )
  );
  calls.push(
    ...completeConcernCalls().filter(
      (c) => (c.input as { contentOffset: number }).contentOffset > 0
    )
  );
  assert.equal(
    observe(calls, concernTruth, "assessments-03").facts
      .assessmentEvidenceComplete,
    true
  );
});

test("failed note refresh invalidates old chunks and a complete retry repairs them", () => {
  const complete = completeConcernCalls(),
    continuation = complete[2];
  const failed = { ...continuation, output: { status: "unavailable" } };
  assert.notEqual(
    observe([...complete, failed], concernTruth, "assessments-03").facts
      .assessmentEvidenceComplete,
    true
  );
  assert.equal(
    observe([...complete, failed, ...complete], concernTruth, "assessments-03")
      .facts.assessmentEvidenceComplete,
    true
  );
  const corrupt = changeFact(continuation, "Recorded notes", "Wrong notes");
  assert.equal(
    observe([...complete, corrupt, ...complete], concernTruth, "assessments-03")
      .facts.assessmentEvidenceComplete,
    true
  );
});

test("a fresh partial list cannot borrow an earlier full list with a different page size", () => {
  assert.notEqual(
    observe([meeting, ...history(records), history(records, {}, 0, 2)[0]]).facts
      .comparisonEvidenceComplete,
    true
  );
});

test("an extra record on a note continuation invalidates that continuation", () => {
  const calls = completeConcernCalls(),
    wrong = structuredClone(calls[2]);
  const output = wrong.output as { items: ReturnType<typeof item>[] };
  output.items.push(
    item(row("foreign-record", "foreign-person", "2026-09-10"), 240)
  );
  calls[2] = wrong;
  assert.notEqual(
    observe(calls, concernTruth, "assessments-03").facts
      .assessmentEvidenceComplete,
    true
  );
});

test("orientation comparison accepts complete person partitions and rejects a missing partition", () => {
  const batches = truth.people.map((person) =>
    history(
      records.filter((r) => r.person === person),
      { cohort: { all: { personIds: [person] } } }
    )
  );
  const got = observe([meeting, ...batches.flat()]);
  assert.equal(got.facts.comparisonEvidenceComplete, true);
  assert.equal(got.facts.comparisonScope, "plant");
  const omitted = batches.filter((_, n) => truth.people[n] !== id("jordan"));
  assert.notEqual(
    observe([meeting, ...omitted.flat()]).facts.comparisonEvidenceComplete,
    true
  );
  const attendees = truth.orientation!.attendees.flatMap((person) =>
    history(
      records.filter((r) => r.person === person),
      { cohort: { all: { personIds: [person] } } }
    )
  );
  assert.equal(
    observe([meeting, ...attendees]).facts.comparisonScope,
    "attendees"
  );
});

test("bounded latest windows pass only if they select the independent latest before and after records", () => {
  const latest = (side: "before" | "after", narrow = false) => {
    const chosen = new Map<string, AssessmentEvidenceRecord>();
    for (const r of records.filter((r) =>
      side === "before"
        ? r.day <= (narrow ? "2026-09-13" : "2026-09-14")
        : r.day >= "2026-09-16"
    )) {
      const old = chosen.get(r.person);
      if (
        !old ||
        `${r.day}:${r.entered}:${r.id}` > `${old.day}:${old.entered}:${old.id}`
      )
        chosen.set(r.person, r);
    }
    return [...chosen.values()];
  };
  const before = history(latest("before"), {
    latestPerPerson: true,
    dates: { from: "2026-08-01", through: "2026-09-14" },
  });
  const after = history(latest("after"), {
    latestPerPerson: true,
    dates: { from: "2026-09-16", through: "2026-09-30" },
  });
  assert.equal(
    observe([meeting, ...before, ...after]).facts.comparisonEvidenceComplete,
    true
  );
  const wrong = history(latest("before", true), {
    latestPerPerson: true,
    dates: { from: "2026-08-01", through: "2026-09-13" },
  });
  assert.notEqual(
    observe([meeting, ...wrong, ...after]).facts.comparisonEvidenceComplete,
    true
  );
});
