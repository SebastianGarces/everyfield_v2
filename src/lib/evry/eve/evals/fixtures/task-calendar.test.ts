import assert from "node:assert/strict";
import { test } from "node:test";
import { questions, regressions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  observedTaskCalendarFacts,
  taskCalendarFixtureIds,
  taskCalendarReferenceInstant,
} from "./task-calendar";

const page = (
  ids: string[],
  total = ids.length,
  cursor?: string,
  where: unknown = {}
): CapturedCall => ({
  id: `tasks-${cursor ?? 0}`,
  name: "tasks.query",
  input: {
    where,
    query: { mode: "list", limit: 2, ...(cursor ? { cursor } : {}) },
  },
  output: {
    kind: "read",
    counts: { matched: total },
    items: ids.map((id) => ({ id, label: id })),
  },
});
const context: CapturedCall = {
  id: "context",
  name: "context.get",
  input: {},
  output: {
    today: "2026-09-19",
    timeZone: "America/New_York",
    referenceInstant: "2026-09-20T00:30:00.000Z",
  },
};

test("bindings retain original questions and a server clock that separates UTC from church day", () => {
  assert.deepEqual(
    taskCalendarFixtureIds.map(
      (id) => [...questions, ...regressions].find((q) => q.id === id)?.turns
    ),
    [
      ["Show Alex and Jordan's pending tasks this week."],
      ["List tasks due today when I am traveling in a different timezone."],
      ["What's due today?"],
    ]
  );
  assert.equal(
    taskCalendarReferenceInstant("regression-today-midnight").toISOString(),
    "2026-09-20T00:30:00.000Z"
  );
  assert.equal(
    taskCalendarReferenceInstant("edges-02").toISOString(),
    "2026-09-20T00:30:00.000Z"
  );
});
test("observer needs actual complete reads, not model-written facts or a partial list", () => {
  for (const calls of [
    [],
    [{ ...context, name: "model.answer" }],
    [page(["a"], 2)],
  ]) {
    assert.equal(
      observedTaskCalendarFacts("edges-02", calls).facts.taskIds,
      undefined
    );
    assert.deepEqual(observedTaskCalendarFacts("edges-02", calls).evidence, []);
  }
  assert.deepEqual(
    observedTaskCalendarFacts("edges-02", [context, page(["b", "a"])]),
    {
      facts: {
        taskIds: ["a", "b"],
        localDate: "2026-09-19",
        timeZone: "America/New_York",
      },
      evidence: ["complete-calendar-task-query", "church-local-calendar"],
    }
  );
});
test("latest coherent pagination run tolerates refresh and key order but rejects gaps and duplicate rows", () => {
  const first = page(["a", "b"], 3, undefined, {
    due: "today",
    status: "pending",
  });
  const second = page(["c"], 3, "2", { status: "pending", due: "today" });
  assert.deepEqual(
    observedTaskCalendarFacts("edges-02", [first, second, first, second]).facts
      .taskIds,
    ["a", "b", "c"]
  );
  for (const pages of [
    [first],
    [second],
    [first, page(["c"], 3, "1", first.input)],
    [first, page(["a"], 3, "2", { due: "today", status: "pending" })],
  ])
    assert.equal(
      observedTaskCalendarFacts("edges-02", pages).facts.taskIds,
      undefined
    );
});
test("later unrelated or incomplete task query cannot inherit the prior complete result", () => {
  assert.equal(
    observedTaskCalendarFacts("edges-02", [page(["a"]), page(["b"], 2)]).facts
      .taskIds,
    undefined
  );
});
test("assignee evidence accepts actual account or person resolution before the task query", () => {
  const m = createFixtureManifest("regression-multi-assignee", 0);
  const link: CapturedCall = {
    id: "link",
    name: "tasks.assignees.search",
    input: { search: "Alex" },
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [
        {
          id: m.ids.actor,
          label: "Alex",
          facts: [
            { label: "Account ID", value: m.ids.actor },
            { label: "Person ID", value: m.ids["core-alex"] },
          ],
        },
      ],
    },
  };
  const person: CapturedCall = {
    id: "person",
    name: "people.query",
    input: {},
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [
        {
          id: m.ids["core-alex"],
          label: "Alex",
          facts: [{ label: "person_id", value: m.ids["core-alex"] }],
        },
      ],
    },
  };
  for (const [kind, identity, resolution] of [
    ["accounts", m.ids.actor, link],
    ["people", m.ids["core-alex"], person],
  ] as const) {
    const tasks = {
      ...page([m.ids["task-today"]], 1, undefined, {
        all: [{ assignment: { kind, ids: [identity] } }],
      }),
      output: {
        kind: "read",
        counts: { matched: 1 },
        items: [
          {
            id: m.ids["task-today"],
            label: "Task",
            facts: [{ label: "Assignee account ID", value: m.ids.actor }],
          },
        ],
      },
    };
    const observed = observedTaskCalendarFacts(m.caseId, [resolution, tasks]);
    assert.deepEqual(observed.facts.assigneeAccounts, [m.ids.actor]);
    assert.ok(observed.evidence.includes("resolved-task-assignees"));
    for (const calls of [
      [tasks],
      [tasks, resolution],
      [{ ...resolution, name: "model.answer" }, tasks],
    ])
      assert.ok(
        !observedTaskCalendarFacts(m.caseId, calls).evidence.includes(
          "resolved-task-assignees"
        )
      );
    const wrongKind = {
      ...tasks,
      input: {
        where: {
          all: [
            {
              assignment: {
                kind: kind === "people" ? "accounts" : "people",
                ids: [identity],
              },
            },
          ],
        },
        query: { mode: "list" },
      },
    };
    assert.ok(
      !observedTaskCalendarFacts(m.caseId, [
        resolution,
        wrongKind,
      ]).evidence.includes("resolved-task-assignees")
    );
  }
});
test("calendar.resolve today is equivalent context without trusting absolute or different relative dates", () => {
  const calendar: CapturedCall = {
    id: "calendar",
    name: "calendar.resolve",
    input: { date: { kind: "relative_day", daysFromToday: 0 } },
    output: {
      status: "resolved",
      calendarDate: "2026-09-19",
      timeZone: "America/New_York",
      referenceInstant: "2026-09-20T00:30:00.000Z",
    },
  };
  assert.deepEqual(
    observedTaskCalendarFacts("edges-02", [calendar, page(["a"])]),
    observedTaskCalendarFacts("edges-02", [context, page(["a"])])
  );
  for (const input of [
    { date: { kind: "absolute", date: "2026-09-19" } },
    { date: { kind: "relative_day", daysFromToday: 1 } },
  ])
    assert.equal(
      observedTaskCalendarFacts("edges-02", [{ ...calendar, input }]).facts
        .localDate,
      undefined
    );
  assert.equal(
    observedTaskCalendarFacts("edges-02", [
      { ...calendar, output: { status: "needs_input" } },
    ]).facts.localDate,
    undefined
  );
});
test("unsupported cases and failed context reads cannot manufacture timezone evidence", () => {
  assert.deepEqual(
    observedTaskCalendarFacts("tasks-01", [context, page(["a"])]),
    { facts: {}, evidence: [] }
  );
  assert.equal(
    observedTaskCalendarFacts("edges-02", [
      { ...context, output: { error: "unavailable" } },
    ]).facts.localDate,
    undefined
  );
});
