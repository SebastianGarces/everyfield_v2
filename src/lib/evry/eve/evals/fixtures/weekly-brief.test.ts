import assert from "node:assert/strict";
import { test } from "node:test";
import { regressions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  observedWeeklyBriefFacts,
  weeklyBriefFixtureIds,
  seedWeeklyBriefFixture,
  weeklyBriefExpectations,
} from "./weekly-brief";
import { createFixtureManifest } from "./manifest";
import { createFixtureStore } from "./store";
const id = "regression-partial-outage",
  team = "11111111-1111-4111-8111-111111111111";
const row = (
  id: string,
  facts: Record<string, string>,
  sourceLink?: { href: string }
) => ({
  id,
  label: id,
  facts: Object.entries(facts).map(([label, value]) => ({ label, value })),
  ...(sourceLink ? { sourceLink } : {}),
});
function read(
  name: string,
  resource: string,
  items: ReturnType<typeof row>[],
  options: {
    offset?: number;
    total?: number;
    extra?: Record<string, unknown>;
  } = {}
): CapturedCall {
  const operations = name === "teams.query",
    offset = options.offset ?? 0,
    total = options.total ?? items.length,
    next = offset + items.length < total ? String(offset + items.length) : null;
  return {
    id: `${name}:${offset}`,
    name,
    input: operations
      ? {
          request: {
            resource,
            query: {
              mode: "list",
              limit: 1,
              cursor: offset ? String(offset) : null,
            },
            ...options.extra,
          },
        }
      : {
          query: {
            resource,
            limit: 1,
            offset,
            ...(name === "launch.query" ? { mode: "list" } : {}),
            ...options.extra,
          },
        },
    output: {
      kind: "read",
      resultMode: "list",
      counts: { matched: total, returned: items.length },
      items,
      filters: operations
        ? [{ label: "Next page cursor", value: next ?? "End of results" }]
        : next
          ? [{ label: "Next offset", value: next }]
          : [],
    },
  };
}
const current = [
  read("launch.query", "status", [
    row("launch", { "Launch date": "October 11, 2026" }),
  ]),
  read("launch.query", "milestones", [
    row("open", { "Completed at": "Not recorded" }),
  ]),
  read("teams.query", "roles", [
    row(
      "22222222-2222-4222-8222-222222222222",
      { Vacancy: "Open" },
      { href: `/teams/${team}` }
    ),
  ]),
];
const absent = () => read("intelligence.query", "assessments", []);
function count(
  name: "launch.query" | "teams.query",
  total: number
): CapturedCall {
  return {
    id: `${name}:count`,
    name,
    input:
      name === "launch.query"
        ? {
            query: {
              resource: "milestones",
              mode: "count",
              completion: "open",
            },
          }
        : {
            request: {
              resource: "roles",
              where: { all: [{ vacant: true }] },
              query: { mode: "count" },
            },
          },
    output: {
      kind: "read",
      resultMode: "count",
      counts: { matched: total, returned: name === "launch.query" ? 1 : 0 },
      items:
        name === "launch.query" ? [row("count", { Count: String(total) })] : [],
      filters:
        name === "launch.query"
          ? []
          : [
              { label: "Total matches", value: String(total) },
              { label: "Next page cursor", value: "End of results" },
            ],
    },
  };
}
const recorded = () =>
  read(
    "intelligence.query",
    "assessments",
    [
      row("history", {
        "Fact snapshot": '{"launch":{"attendanceCount":0}}',
        "Next content offset": "Not recorded",
      }),
    ],
    { extra: { includeFactSnapshot: true } }
  );

test("only the original missing-history regression is bound, with its unchanged required evidence", () => {
  assert.deepEqual(weeklyBriefFixtureIds, [id]);
  const r = regressions.find((r) => r.id === id)!;
  assert.deepEqual(r.turns, ["Give me our weekly operational brief."]);
  assert.equal(r.fixture, "launch-with-unavailable-snapshot");
  assert.deepEqual(r.expectations.requiredEvidence, [
    "launch-date",
    "incomplete-milestones",
    "open-roles",
  ]);
});
test("generic family dispatch skips unrelated cases before any SQL is invoked", () => {
  // Constructing this store is pure. Any accidental query would fail because no stack exists.
  const store = createFixtureStore("evry-eve-fixture-000000000000-pg");
  for (const caseId of ["cross-01", "edges-13", "regression-launch-overview"]) {
    const manifest = createFixtureManifest(caseId, 0);
    assert.equal(seedWeeklyBriefFixture(manifest, store), undefined);
    assert.equal(weeklyBriefExpectations(manifest, store), null);
  }
});
test("missing history preserves current evidence and is null rather than recorded zero", () => {
  const result = observedWeeklyBriefFacts(id, [...current, absent()]);
  assert.deepEqual(result.evidence, [
    "launch-date",
    "incomplete-milestones",
    "open-roles",
  ]);
  assert.equal(result.facts.historicalComparisonAvailable, false);
  assert.equal(result.facts.historicalAttendanceCount, null);
  assert.deepEqual(result.facts.openRoleTeams, [`${team}:1`]);
  assert.equal(result.facts.launchDate, "2026-10-11");
  assert.equal(result.facts.incompleteMilestoneCount, 1);
  assert.equal(result.facts.openRoleCount, 1);
  const history = observedWeeklyBriefFacts(id, [...current, recorded()]);
  assert.equal(history.facts.historicalComparisonAvailable, true);
  assert.equal(history.facts.historicalAttendanceCount, 0);
  assert.deepEqual(history.facts.historicalSnapshotIds, ["history"]);
});
test("complete count and list strategies establish identical brief totals without requiring result cards", () => {
  const list = observedWeeklyBriefFacts(id, [...current, absent()]);
  const aggregate = observedWeeklyBriefFacts(id, [
    current[0]!,
    count("launch.query", 1),
    count("teams.query", 1),
    absent(),
  ]);
  for (const fact of [
    "launchDate",
    "incompleteMilestoneCount",
    "openRoleCount",
    "historicalComparisonAvailable",
    "historicalAttendanceCount",
  ])
    assert.deepEqual(aggregate.facts[fact], list.facts[fact]);
  assert.deepEqual(aggregate.evidence, list.evidence);
  assert.equal(aggregate.facts.incompleteMilestoneIds, undefined);
  const shortDate = read("launch.query", "status", [
    row("launch", { "Launch date": "Oct 11, 2026" }),
  ]);
  assert.equal(
    observedWeeklyBriefFacts(id, [shortDate]).facts.launchDate,
    "2026-10-11"
  );
  const invalidDate = read("launch.query", "status", [
    row("launch", { "Launch date": "Feb 30, 2026" }),
  ]);
  assert.equal(
    observedWeeklyBriefFacts(id, [invalidDate]).facts.launchDate,
    undefined
  );
});
test("restricted, contradictory, stale or incomplete aggregate evidence cannot establish whole-plant totals", () => {
  const milestone = count("launch.query", 1),
    roles = count("teams.query", 1);
  for (const query of [
    { resource: "milestones", mode: "count", completion: "any" },
    {
      resource: "milestones",
      mode: "count",
      completion: "open",
      area: "operations",
    },
    {
      resource: "milestones",
      mode: "count",
      completion: "open",
      milestoneIds: ["subset"],
    },
  ])
    assert.equal(
      observedWeeklyBriefFacts(id, [
        milestone,
        { ...milestone, input: { query } },
      ]).facts.incompleteMilestoneCount,
      undefined
    );
  for (const request of [
    {
      resource: "roles",
      where: { all: [{ vacant: true, teamIds: [team] }] },
      query: { mode: "count" },
    },
    { resource: "roles", query: { mode: "count" } },
    {
      resource: "teams",
      where: { all: [{ hasVacancies: true }] },
      query: { mode: "count" },
    },
  ])
    assert.equal(
      observedWeeklyBriefFacts(id, [roles, { ...roles, input: { request } }])
        .facts.openRoleCount,
      undefined
    );
  const partial = read(
    "launch.query",
    "milestones",
    [row("one", { "Completed at": "Not recorded" })],
    { total: 2 }
  );
  assert.equal(
    observedWeeklyBriefFacts(id, [milestone, partial]).facts
      .incompleteMilestoneCount,
    undefined
  );
  const broken = {
    ...roles,
    output: {
      ...(roles.output as object),
      counts: { matched: 2, returned: 0 },
    },
  };
  assert.equal(
    observedWeeklyBriefFacts(id, [roles, broken]).facts.openRoleCount,
    undefined
  );
});
test("no read, thrown/unavailable output, filtered empty read and truncated snapshot cannot establish history absence", () => {
  const unavailable = { ...absent(), output: { status: "unavailable" } };
  for (const calls of [
    current,
    [...current, absent(), unavailable],
    [
      ...current,
      read("intelligence.query", "assessments", [], {
        extra: { assessmentIds: ["missing"] },
      }),
    ],
    [
      ...current,
      read("intelligence.query", "assessments", [], {
        extra: {
          window: {
            from: "2026-09-01T00:00:00Z",
            until: "2026-09-02T00:00:00Z",
          },
        },
      }),
    ],
    [
      ...current,
      read(
        "intelligence.query",
        "assessments",
        [
          row("history", {
            "Fact snapshot": "{}",
            "Next content offset": "2000",
          }),
        ],
        { extra: { includeFactSnapshot: true } }
      ),
    ],
  ])
    assert.equal(
      observedWeeklyBriefFacts(id, calls).facts.historicalComparisonAvailable,
      undefined
    );
});
test("complete coherent pages work, partial/duplicate/gapped pages and stale success do not", () => {
  const first = read(
    "launch.query",
    "milestones",
    [row("one", { "Completed at": "Not recorded" })],
    { total: 2 }
  );
  const second = read(
    "launch.query",
    "milestones",
    [row("two", { "Completed at": "Not recorded" })],
    { total: 2, offset: 1 }
  );
  assert.deepEqual(
    observedWeeklyBriefFacts(id, [first, second]).facts.incompleteMilestoneIds,
    ["one", "two"]
  );
  for (const calls of [
    [first],
    [second],
    [
      first,
      {
        ...second,
        output: {
          ...(second.output as object),
          items: [row("one", { "Completed at": "Not recorded" })],
        },
      },
    ],
    [...current, first],
  ])
    assert.equal(
      observedWeeklyBriefFacts(id, calls).facts.incompleteMilestoneIds,
      undefined
    );
  const role1 = read(
    "teams.query",
    "roles",
    [
      row(
        "22222222-2222-4222-8222-222222222222",
        { Vacancy: "Open" },
        { href: `/teams/${team}` }
      ),
    ],
    { total: 2 }
  );
  const role2 = read(
    "teams.query",
    "roles",
    [
      row(
        "33333333-3333-4333-8333-333333333333",
        { Vacancy: "Open" },
        { href: `/teams/${team}` }
      ),
    ],
    { total: 2, offset: 1 }
  );
  assert.deepEqual(
    observedWeeklyBriefFacts(id, [role1, role2]).facts.openRoleTeams,
    [`${team}:2`]
  );
  assert.equal(
    observedWeeklyBriefFacts(id, [role1]).facts.openRoleTeams,
    undefined
  );
});
test("equivalent text-only and card-selected evidence grade the same; retrieval is not prose quality", () => {
  const calls = [...current, absent()];
  assert.deepEqual(
    observedWeeklyBriefFacts(id, calls),
    observedWeeklyBriefFacts(id, calls, new Set(calls.map((c) => c.id)))
  );
  assert.deepEqual(observedWeeklyBriefFacts("cross-01", calls), {
    facts: {},
    evidence: [],
  });
  assert.deepEqual(observedWeeklyBriefFacts("edges-13", calls), {
    facts: {},
    evidence: [],
  });
});
