import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  intelligenceReportsFixtureIds,
  observedIntelligenceReportsFacts,
} from "./intelligence-reports";

function row(id: string, facts: Record<string, string>, label = id) {
  return {
    id,
    label,
    facts: Object.entries(facts).map(([label, value]) => ({ label, value })),
  };
}
function read(
  resource: string,
  items: ReturnType<typeof row>[],
  query: Record<string, unknown> = {},
  matched = items.length
): CapturedCall {
  return {
    id: `${resource}-${JSON.stringify(query)}`,
    name: "intelligence.query",
    input: { query: { resource, ...query } },
    output: { kind: "read", counts: { matched }, items },
  };
}
const snapshot = {
  ministryRoles: { filledCount: 4, totalRoles: 8 },
  training: { requiredCompletionRate: null },
  launch: { attendanceCount: 0, decisionsCount: null },
  manual: { byKey: { financial_base_established: true } },
};
const report = (data: unknown = snapshot) =>
  read(
    "assessments",
    [
      row("latest", {
        "Generated at": "September 19, 2026",
        "Fact snapshot": JSON.stringify(data),
        "Next content offset": "Not recorded",
      }),
      row("older", { "Generated at": "September 1, 2026" }),
    ],
    { includeFactSnapshot: true }
  );
const insight = (id: string, reportId = "latest") =>
  row(id, {
    "Assessment ID": reportId,
    Category: "Staffing",
    "Stored finding": `Finding ${id}`,
    "Cited facts": JSON.stringify(["ministryRoles.filledCount=4"]),
    "Next content offset": "Not recorded",
  });
const teams: CapturedCall = {
  id: "teams",
  name: "teams.query",
  input: { request: { resource: "teams", query: { mode: "list" } } },
  output: {
    kind: "read",
    counts: { matched: 2 },
    items: [
      row("team-a", { Leader: "Alex Rivera" }),
      row("team-b", { Leader: "Not recorded" }),
    ],
  },
};

test("four bindings retain the original report and phase questions", () => {
  assert.deepEqual(intelligenceReportsFixtureIds, [
    "intelligence-01",
    "intelligence-02",
    "intelligence-03",
    "intelligence-05",
  ]);
  for (const id of intelligenceReportsFixtureIds)
    assert.ok(questions.find((q) => q.id === id)?.turns.length);
});
test("latest report findings retain full cited text and ignore presentation choice", () => {
  const calls = [
    report(),
    read("insights", [insight("one"), insight("old", "older")]),
  ];
  const observed = observedIntelligenceReportsFacts("intelligence-01", calls);
  assert.deepEqual(observed.facts.insightIds, ["one"]);
  assert.equal(observed.facts.reportId, "latest");
  assert.deepEqual(
    observed,
    observedIntelligenceReportsFacts(
      "intelligence-01",
      calls,
      new Set(calls.map((c) => c.id))
    )
  );
  assert.deepEqual(
    observedIntelligenceReportsFacts("intelligence-01", [
      report(),
      read("insights", [insight("one")], {}, 2),
    ]).facts,
    {}
  );
  const long = insight("one");
  long.facts.push({ label: "Next content offset", value: "2000" });
  assert.deepEqual(
    observedIntelligenceReportsFacts("intelligence-01", [
      report(),
      read("insights", [long]),
    ]).facts,
    {}
  );
});
test("record pagination requires contiguous unique pages and latest fresh read completeness", () => {
  const first = read("insights", [insight("one")], { limit: 1, offset: 0 }, 2);
  const second = read("insights", [insight("two")], { limit: 1, offset: 1 }, 2);
  assert.deepEqual(
    observedIntelligenceReportsFacts("intelligence-01", [
      report(),
      first,
      second,
    ]).facts.insightIds,
    ["one", "two"]
  );
  for (const suffix of [
    [first],
    [second],
    [first, read("insights", [insight("one")], { limit: 1, offset: 1 }, 2)],
    [first, read("insights", [insight("two")], { limit: 1, offset: 2 }, 2)],
    [first, second, first],
    [
      first,
      read(
        "insights",
        [insight("two")],
        { limit: 1, offset: 1, category: "staffing" },
        2
      ),
    ],
  ])
    assert.deepEqual(
      observedIntelligenceReportsFacts("intelligence-01", [report(), ...suffix])
        .facts,
      {}
    );
});
test("staffing keeps report-time coverage separate from present team owners", () => {
  const calls = [report(), read("insights", [insight("one")]), teams];
  const observed = observedIntelligenceReportsFacts("intelligence-02", calls);
  assert.equal(observed.facts.reportFilled, 4);
  assert.deepEqual(observed.facts.currentTeamLeaders, [
    "team-a:Alex Rivera",
    "team-b:Not recorded",
  ]);
  assert.deepEqual(
    observed,
    observedIntelligenceReportsFacts(
      "intelligence-02",
      calls,
      new Set(["teams"])
    )
  );
  const partial = structuredClone(teams);
  partial.output = {
    kind: "read",
    counts: { matched: 3 },
    items: [row("team-a", { Leader: "Alex Rivera" })],
  };
  assert.deepEqual(
    observedIntelligenceReportsFacts("intelligence-02", [
      report(),
      read("insights", [insight("one")]),
      partial,
    ]).facts,
    {}
  );
  assert.deepEqual(
    observedIntelligenceReportsFacts("intelligence-02", [
      ...calls,
      report({ ...snapshot, ministryRoles: { filledCount: 5, totalRoles: 8 } }),
    ]).facts,
    {}
  );
});
test("null, measured zero and self-attestation are different evidence; missing paths cannot become zero", () => {
  const result = observedIntelligenceReportsFacts("intelligence-03", [
    report(),
  ]);
  assert.deepEqual(result.facts.unknownIndicators, [
    "launch.decisionsCount",
    "training.requiredCompletionRate",
  ]);
  assert.deepEqual(result.facts.zeroIndicators, ["launch.attendanceCount"]);
  assert.equal(result.facts.selfAttestedFunding, true);
  const wrong = observedIntelligenceReportsFacts("intelligence-03", [
    report({ ...snapshot, training: { requiredCompletionRate: 0 } }),
  ]);
  assert.notDeepEqual(wrong.facts, result.facts);
  assert.deepEqual(
    observedIntelligenceReportsFacts("intelligence-03", [
      report({ ...snapshot, training: {} }),
    ]).facts,
    {}
  );
});
test("failed or partial exact snapshot refresh invalidates old evidence and a complete reread restores it", () => {
  const exact = read(
    "assessments",
    [
      row("latest", {
        "Generated at": "September 19, 2026",
        "Fact snapshot": JSON.stringify(snapshot),
        "Next content offset": "Not recorded",
      }),
    ],
    { assessmentIds: ["latest"], includeFactSnapshot: true }
  );
  const partial = read(
    "assessments",
    [
      row("latest", {
        "Fact snapshot": JSON.stringify(snapshot),
        "Next content offset": "2000",
      }),
    ],
    { assessmentIds: ["latest"], includeFactSnapshot: true }
  );
  const unrelatedFailure: CapturedCall = {
    ...exact,
    input: {
      query: {
        resource: "assessments",
        assessmentIds: ["other"],
        includeFactSnapshot: true,
      },
    },
    output: { status: "unavailable" },
  };
  for (const caseId of ["intelligence-02", "intelligence-03"]) {
    const prefix =
      caseId === "intelligence-02"
        ? [report(), read("insights", [insight("one")]), teams]
        : [report()];
    const expected = observedIntelligenceReportsFacts(caseId, prefix);
    assert.ok(expected.evidence.length);
    for (const refresh of [
      { ...exact, output: { status: "unavailable" } },
      { ...exact, output: null },
      read("assessments", [], {
        assessmentIds: ["latest"],
        includeFactSnapshot: true,
      }),
      partial,
    ]) {
      assert.deepEqual(
        observedIntelligenceReportsFacts(caseId, [...prefix, refresh]),
        { facts: {}, evidence: [] }
      );
      assert.deepEqual(
        observedIntelligenceReportsFacts(caseId, [...prefix, refresh, exact]),
        expected
      );
    }
    assert.deepEqual(
      observedIntelligenceReportsFacts(caseId, [...prefix, unrelatedFailure]),
      expected
    );
    // Normal discovery pages containing a different report do not refresh the selected body.
    assert.deepEqual(
      observedIntelligenceReportsFacts(caseId, [
        ...prefix,
        read("assessments", [row("older", {})], { offset: 2 }),
      ]),
      expected
    );
  }
});
test("current phase requires authoritative context and a real transition, never declaration or reason text", () => {
  const context: CapturedCall = {
    id: "context",
    name: "context.get",
    input: {},
    output: { currentPhase: 3 },
  };
  const transition = row("transition", {
    Kind: "Transition",
    "From phase": "2",
    "To phase": "3",
    "Recorded at": "September 12, 2026",
    Reason: "Prepared",
  });
  const declaration = row("declaration", {
    Kind: "Initial declaration",
    "From phase": "1",
    "To phase": "3",
    "Recorded at": "August 1, 2026",
    Reason: "Transition",
  });
  const good = observedIntelligenceReportsFacts("intelligence-05", [
    context,
    read("transitions", [transition, declaration]),
  ]);
  assert.equal(good.facts.transitionId, "transition");
  for (const calls of [
    [read("transitions", [transition])],
    [context, read("transitions", [declaration])],
    [context, read("transitions", [transition], {}, 3)],
    [
      { ...context, output: { currentPhase: 5 } },
      read("transitions", [transition]),
    ],
  ])
    assert.deepEqual(
      observedIntelligenceReportsFacts("intelligence-05", calls).facts,
      {}
    );
});
