import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDateWithoutWeekday } from "@/lib/datetime";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import { createFixtureStore } from "./store";
import {
  observedWeeklyOverviewFacts,
  seedWeeklyOverviewFixture,
  weeklyOverviewExpectations,
  weeklyOverviewFixtureIds,
  type WeeklyOverviewTruth,
} from "./weekly-overview";

const truth: WeeklyOverviewTruth = {
  now: "2026-09-20T16:00:00.000Z",
  timeZone: "America/New_York",
  asOfDisplay: "Sep 20, 2026, noon EDT",
  localNow: "2026-09-20 12:00:00",
  windows: [
    {
      name: "current-calendar-week",
      from: "2026-09-14",
      through: "2026-09-20",
    },
    { name: "upcoming-seven-days", from: "2026-09-20", through: "2026-09-26" },
  ],
  tasks: [
    {
      id: "task",
      due: "2026-09-20",
      status: "blocked",
      category: null,
      assignee: "Other Member",
      blocked: true,
    },
    {
      id: "followup",
      due: "2026-09-23",
      status: "not_started",
      category: "follow_up",
      assignee: "Unassigned",
      blocked: false,
    },
    {
      id: "done",
      due: "2026-09-20",
      status: "complete",
      category: "follow_up",
      assignee: "Owner",
      blocked: false,
    },
  ],
  meetings: [
    {
      id: "earlier",
      day: "2026-09-18",
      local: "2026-09-18 18:00:00",
      status: "completed",
      preparation: "No checklist recorded",
      unchecked: 0,
    },
    {
      id: "later",
      day: "2026-09-23",
      local: "2026-09-23 18:00:00",
      status: "planning",
      preparation: "Incomplete",
      unchecked: 1,
    },
  ],
  roles: [
    { id: "vacant", team: "forming", vacant: true },
    { id: "occupied", team: "active", vacant: false },
  ],
};
const open = ["not_started", "in_progress", "blocked"];
const rows = (entries: { id: string; values: Record<string, string> }[]) =>
  entries.map(({ id, values }) => ({
    id,
    facts: Object.entries(values).map(([label, value]) => ({ label, value })),
  }));
function call(
  name: string,
  input: Record<string, unknown>,
  items: ReturnType<typeof rows>,
  options: {
    total?: number;
    cursor?: string | null;
    mode?: "count" | "list";
  } = {}
): CapturedCall {
  const total = options.total ?? items.length,
    cursor = options.cursor ?? null;
  const query = {
    mode: options.mode ?? "list",
    ...(options.mode !== "count" ? { limit: 2, cursor } : {}),
  };
  return {
    id: `${name}-${cursor ?? "first"}`,
    name,
    input:
      name === "teams.query"
        ? { request: { ...input, query } }
        : { ...input, query },
    output: {
      kind: "read",
      resultMode: options.mode ?? "list",
      counts: { matched: total, returned: items.length },
      items,
      filters: [
        { label: "As of", value: truth.asOfDisplay },
        { label: "Time zone", value: truth.timeZone },
        {
          label: "Next page cursor",
          value:
            Number(cursor ?? 0) + items.length === total ||
            options.mode === "count"
              ? "End of results"
              : String(Number(cursor ?? 0) + items.length),
        },
      ],
    },
  };
}
function taskRows(entries: WeeklyOverviewTruth["tasks"]) {
  return rows(
    entries.map((r) => ({
      id: r.id,
      values: {
        Assignee: r.assignee,
        Status: r.status.replaceAll("_", " "),
        "Due date": r.due
          ? formatDateWithoutWeekday(
              new Date(`${r.due}T00:00:00Z`),
              "short",
              "UTC"
            )
          : "Not recorded",
        Category: r.category === "follow_up" ? "Follow-up" : "Not recorded",
        "Blocked by incomplete prerequisites": r.blocked ? "Yes" : "No",
      },
    }))
  );
}
function captures(windowIndex = 1, mode: "list" | "count" = "list") {
  const w = truth.windows[windowIndex]!,
    date = { kind: "range", from: w.from, through: w.through };
  const tasks = truth.tasks.filter(
    (r) => r.status !== "complete" && r.due! >= w.from && r.due! <= w.through
  );
  const meetings = truth.meetings.filter(
    (r) => r.day >= w.from && r.day <= w.through
  );
  const followup = tasks.filter((r) => r.category === "follow_up");
  return [
    call(
      "tasks.query",
      { where: { all: [{ status: open, due: date }] } },
      mode === "list" ? taskRows(tasks) : [],
      { mode, total: tasks.length }
    ),
    call(
      "tasks.query",
      {
        where: { all: [{ status: open, due: date, category: ["follow_up"] }] },
      },
      mode === "list" ? taskRows(followup) : [],
      { mode, total: followup.length }
    ),
    call(
      "meetings.query",
      {
        where: {
          all: [
            {
              statuses: ["planning", "ready", "in_progress", "completed"],
              date,
            },
          ],
        },
      },
      mode === "list"
        ? rows(
            meetings.map((r) => ({
              id: r.id,
              values: {
                "Local start": r.local,
                Timezone: truth.timeZone,
                "Preparation checklist": r.preparation,
                "Unchecked preparation items": String(r.unchecked),
              },
            }))
          )
        : [],
      { mode, total: meetings.length }
    ),
    call(
      "teams.query",
      { resource: "roles", where: { all: [{ vacant: true }] } },
      mode === "list"
        ? rows([{ id: "vacant", values: { Vacancy: "Open" } }])
        : [],
      { mode, total: 1 }
    ),
  ];
}
const observed = (calls: CapturedCall[], oracle = truth) =>
  observedWeeklyOverviewFacts("cross-01", calls, oracle);
const expected = {
  selectedWindowRecognized: true,
  tasksMatch: true,
  meetingsMatch: true,
  followupMatch: true,
  staffingMatch: true,
  asOfAvailable: true,
};
const gates = (facts: ReturnType<typeof observed>["facts"]) =>
  Object.fromEntries(Object.keys(expected).map((key) => [key, facts[key]]));

test("preserves original question and ignores unrelated fixture IDs", () => {
  assert.deepEqual(weeklyOverviewFixtureIds, ["cross-01"]);
  assert.deepEqual(questions.find((q) => q.id === "cross-01")?.turns, [
    "Give me a weekly operational brief covering tasks, meetings, follow-up and staffing gaps.",
  ]);
  const m = createFixtureManifest("people-01", 0),
    store = createFixtureStore("evry-eve-fixture-000000000000-pg");
  seedWeeklyOverviewFixture(m, store);
  assert.equal(weeklyOverviewExpectations(m, store), null);
  assert.deepEqual(observedWeeklyOverviewFacts(m.caseId, captures(), truth), {
    facts: {},
    evidence: [],
  });
});
for (const windowIndex of [0, 1])
  for (const mode of ["list", "count"] as const)
    test(`accepts SQL-comparable ${mode} evidence for window ${windowIndex}`, () => {
      assert.deepEqual(
        gates(observed(captures(windowIndex, mode)).facts),
        expected
      );
    });
test("card selection is irrelevant to read fidelity and does not assert prose quality", () => {
  const calls = captures();
  assert.deepEqual(
    observed(calls),
    observed([
      ...calls,
      {
        id: "text",
        name: "final-text",
        input: { text: "Wrong narrative" },
        output: {},
      },
    ])
  );
  assert.equal("judge" in observed(calls), false);
});

test("an unbounded count cannot establish weekly tasks or follow-up even when its total is correct", () => {
  const calls = captures(1, "count");
  calls[0] = call("tasks.query", { where: { all: [{ status: open }] } }, [], {
    mode: "count",
    total: truth.tasks.filter((r) => r.status !== "complete").length,
  });
  calls[1] = call(
    "tasks.query",
    { where: { all: [{ status: open, category: ["follow_up"] }] } },
    [],
    {
      mode: "count",
      total: truth.tasks.filter(
        (r) => r.status !== "complete" && r.category === "follow_up"
      ).length,
    }
  );
  const facts = observed(calls).facts;
  assert.equal(facts.tasksMatch, false);
  assert.equal(facts.followupMatch, false);
  assert.equal(facts.selectedWindowRecognized, false);
});

test("a complete broad list remains evidence but its diagnostics explicitly describe retrieved open work", () => {
  const oracle = structuredClone(truth);
  oracle.tasks.push(
    {
      id: "far-future-followup",
      due: "2026-12-01",
      status: "not_started",
      category: "follow_up",
      assignee: "Other Member",
      blocked: false,
    },
    {
      id: "overdue-followup",
      due: "2026-08-01",
      status: "not_started",
      category: "follow_up",
      assignee: "Unassigned",
      blocked: false,
    }
  );
  const openTasks = oracle.tasks.filter((r) => r.status !== "complete");
  const broad = call(
    "tasks.query",
    { where: { all: [{ status: open }] } },
    taskRows(openTasks)
  );
  broad.input = {
    where: { all: [{ status: open }] },
    query: { mode: "list", limit: 50, cursor: null },
  };
  const facts = observed([broad, ...captures().slice(2)], oracle).facts;
  assert.deepEqual(gates(facts), expected);
  assert.equal(facts.retrievedOpenTaskCount, 4);
  assert.equal(facts.retrievedOpenFollowupCount, 3);
  assert.equal(facts.taskCount, undefined);
  assert.equal(facts.followupCount, undefined);
});

test("a through-week count may include overdue work when its retrieval scope is explicit", () => {
  const calls = captures(1, "count");
  for (const index of [0, 1]) {
    calls[index]!.input = {
      where: {
        all: [
          {
            status: open,
            due: { kind: "range", from: null, through: "2026-09-26" },
            ...(index === 1 ? { category: ["follow_up"] } : {}),
          },
        ],
      },
      query: { mode: "count" },
    };
  }
  assert.deepEqual(gates(observed(calls).facts), expected);
});
test("requires every requested area", () => {
  for (let index = 0; index < 4; index++) {
    const calls = captures();
    calls.splice(index, 1);
    // The broad task query legitimately also establishes follow-up. Remove its
    // category facts by keeping only a count when testing the dedicated read.
    if (index === 1) calls[0] = captures(1, "count")[0]!;
    assert.notDeepEqual(gates(observed(calls).facts), expected);
  }
});
test("refuses actor-only task scope and unrelated time windows", () => {
  const mine = captures();
  mine[0]!.input = {
    where: { all: [{ status: open, assignment: { kind: "mine" } }] },
    query: { mode: "list" },
  };
  assert.equal(observed(mine).facts.tasksMatch, false);
  const wrong = captures();
  wrong[2]!.input = {
    where: {
      all: [
        { date: { kind: "range", from: "2025-09-20", through: "2025-09-26" } },
      ],
    },
    query: { mode: "list" },
  };
  assert.equal(observed(wrong).facts.meetingsMatch, false);
});
test("does not combine mismatched legitimate windows into one coherent brief", () => {
  const calls = captures(0);
  calls[2] = captures(1)[2]!;
  assert.equal(observed(calls).facts.selectedWindowRecognized, false);
});
test("requires complete contiguous unique pages and invalidates older complete evidence", () => {
  const calls = captures(),
    first = structuredClone(calls[0]!);
  const output = first.output as {
    items: unknown[];
    counts: { returned: number };
    filters: { label: string; value: string }[];
  };
  output.items = output.items.slice(0, 1);
  output.counts.returned = 1;
  output.filters.find((f) => f.label === "Next page cursor")!.value = "1";
  assert.equal(observed([...calls, first]).facts.tasksMatch, false);
  const second = structuredClone(calls[0]!);
  second.input = {
    ...(second.input as object),
    query: { mode: "list", limit: 2, cursor: "1" },
  };
  const tail = second.output as typeof output;
  tail.items = tail.items.slice(1);
  tail.counts.returned = 1;
  assert.equal(
    observed([first, second, ...calls.slice(1)]).facts.tasksMatch,
    true
  );
  tail.items = output.items;
  assert.equal(
    observed([first, second, ...calls.slice(1)]).facts.tasksMatch,
    false
  );
  assert.equal(
    observed([...calls, { ...calls[0]!, output: { status: "unavailable" } }])
      .facts.tasksMatch,
    false
  );
});
test("rejects invented follow-up, wrong counts, inactive-role occupancy and preparation zero conflation", () => {
  const missing = captures();
  (missing[1]!.output as { items: { id: string }[] }).items[0]!.id =
    "rsvp-only";
  assert.equal(observed(missing).facts.followupMatch, false);
  const count = captures(1, "count");
  (count[3]!.output as { counts: { matched: number } }).counts.matched = 0;
  assert.equal(observed(count).facts.staffingMatch, false);
  const filled = captures();
  (
    filled[3]!.output as { items: { facts: { value: string }[] }[] }
  ).items[0]!.facts[0]!.value = "Filled";
  assert.equal(observed(filled).facts.staffingMatch, false);
  const checklist = captures(0);
  (
    checklist[2]!.output as { items: { facts: { value: string }[] }[] }
  ).items[0]!.facts[0]!.value = "Complete";
  assert.equal(observed(checklist).facts.meetingsMatch, false);
});
test("refuses stale or missing asOf and foreign rows", () => {
  const stale = captures();
  (
    stale[0]!.output as { filters: { label: string; value: string }[] }
  ).filters.find((f) => f.label === "As of")!.value = "Last year";
  assert.equal(observed(stale).facts.asOfAvailable, false);
  const foreign = captures();
  (foreign[0]!.output as { items: { id: string }[] }).items[0]!.id = "foreign";
  assert.equal(observed(foreign).facts.tasksMatch, false);
});
