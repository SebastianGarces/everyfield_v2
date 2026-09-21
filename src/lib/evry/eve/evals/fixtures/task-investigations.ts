import assert from "node:assert/strict";
import { z } from "zod";
import type { Expectations } from "../contract";
import { fixtureId, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";

export const taskInvestigationFixtureIds = [
  "tasks-02",
  "tasks-04",
  "tasks-09",
  "tasks-11",
] as const;
const owns = (id: string) =>
  taskInvestigationFixtureIds.some((value) => value === id);
const idFor = (m: FixtureManifest, name: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `task-investigation:${name}`);

export function seedTaskInvestigationFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  if (!owns(m.caseId)) return;
  const i = m.ids;
  const add = (
    name: string,
    status = "not_started",
    due: string | null = null,
    owner: string | null = i.actor,
    parent: string | null = null,
    deleted = false
  ) => {
    store.sql(
      `insert into tasks(id,church_id,title,status,due_date,assigned_to_id,parent_task_id,created_by_id,deleted_at) values ('${idFor(m, name)}','${i.plant}','Fixture ${name}','${status}',${due ? `'${due}'` : "null"},${owner ? `'${owner}'` : "null"},${parent ? `'${parent}'` : "null"},'${i.actor}',${deleted ? "'2026-09-01'" : "null"});`
    );
    return idFor(m, name);
  };
  if (m.caseId === "tasks-02") {
    add("old-overdue", "blocked", "2026-09-12");
    add("today-in-progress", "in_progress", "2026-09-20");
    add("week-after", "not_started", "2026-09-27");
    add("deleted-today", "not_started", "2026-09-20", i.actor, null, true);
  }
  if (m.caseId === "tasks-04") {
    const first = add("blocked-by-dependency", "not_started");
    const second = add(
      "prerequisite-with-prerequisite",
      "in_progress",
      null,
      i["other-actor"]
    );
    const last = add("unassigned-prerequisite", "not_started", null, null);
    const another = add("second-blocked-task");
    const completed = add("completed-prerequisite", "complete");
    const deleted = add(
      "deleted-prerequisite",
      "not_started",
      null,
      i.actor,
      null,
      true
    );
    const statusOnly = add("status-blocked-no-prerequisite", "blocked");
    const satisfied = add("all-prerequisites-complete");
    const deletedOnly = add("only-deleted-prerequisite");
    // The database rejects cycles. A shared prerequisite plus a deeper chain
    // exercises unique, bounded edges without bypassing that invariant.
    for (const [task, prerequisite] of [
      [first, second],
      [first, completed],
      [first, deleted],
      [second, last],
      [another, last],
      [satisfied, completed],
      [deletedOnly, deleted],
    ])
      store.sql(
        `insert into task_dependencies(church_id,task_id,prerequisite_task_id) values ('${i.plant}','${task}','${prerequisite}');`
      );
    assert.notEqual(statusOnly, first);
  }
  if (m.caseId === "tasks-09") {
    const other = add("undated-second");
    for (const [name, parent, status, deleted] of [
      ["unfinished-one", i["task-undated"], "not_started", false],
      ["unfinished-two", i["task-undated"], "blocked", false],
      ["finished-child", i["task-undated"], "complete", false],
      ["deleted-child", i["task-undated"], "not_started", true],
      ["second-unfinished", other, "in_progress", false],
      ["dated-parent-child", i["task-today"], "not_started", false],
    ] as const)
      add(name, status, null, i.actor, parent, deleted);
    // No pending qualifier in the question: completed undated parents must not
    // silently disappear. The base fixture already contains two of them.
  }
  if (m.caseId === "tasks-11") {
    for (const name of ["Alex", "Jordan"])
      store.sql(
        `insert into users(id,email,password_hash,name,seat,church_id) values ('${idFor(m, name)}','${idFor(m, name)}@example.test','unusable-fixture-password','${name} Rivera','member','${i.plant}');`
      );
    store.sql(
      `update users set name='Alex Foreign' where id='${i["foreign-actor"]}'; update persons set first_name='Alex',last_name='Unlinked' where id='${i["core-alex"]}'; update persons set first_name='Jordan',last_name='Unlinked' where id='${i["core-jordan"]}';`
    );
    for (const [name, owner, status, due] of [
      ["alex-monday", "Alex", "not_started", "2026-09-14"],
      ["alex-sunday", "Alex", "in_progress", "2026-09-20"],
      ["jordan-middle", "Jordan", "blocked", "2026-09-17"],
      ["alex-before", "Alex", "not_started", "2026-09-13"],
      ["jordan-after", "Jordan", "not_started", "2026-09-21"],
      ["jordan-complete", "Jordan", "complete", "2026-09-18"],
      ["alex-undated", "Alex", "not_started", null],
    ] as const)
      add(name, status, due, idFor(m, owner));
  }
}

export function taskInvestigationExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (!owns(m.caseId)) return null;
  const i = m.ids;
  const base = `t.church_id='${i.plant}' and t.deleted_at is null and t.parent_task_id is null`;
  const facts: Expectations["facts"] = {};
  const ids = (query: string) =>
    store
      .query(query)
      .map((r) => z.string().parse(r.id))
      .sort();
  if (m.caseId === "tasks-02") {
    const pending = `${base} and t.assigned_to_id='${i.actor}' and t.status <> 'complete'`;
    facts.overdueIds = ids(
      `select t.id from tasks t where ${pending} and t.due_date < '2026-09-20'`
    );
    facts.todayIds = ids(
      `select t.id from tasks t where ${pending} and t.due_date='2026-09-20'`
    );
    // Sunday is the last day of the current church-calendar week.
    facts.laterThisWeekIds = ids(
      `select t.id from tasks t where ${pending} and t.due_date > '2026-09-20' and t.due_date <= '2026-09-20'`
    );
    facts.unbucketedIds = [];
    assert.equal(facts.overdueIds.length, 2);
    assert.equal(facts.todayIds.length, 2);
  } else if (m.caseId === "tasks-04") {
    const edges = store.query(
      `select t.id as task,p.id as prerequisite,p.assigned_to_id as owner from tasks t join task_dependencies d on d.task_id=t.id and d.church_id=t.church_id join tasks p on p.id=d.prerequisite_task_id and p.church_id=t.church_id where ${base} and p.deleted_at is null and p.status <> 'complete'`
    );
    facts.taskIds = [
      ...new Set(edges.map((r) => z.string().parse(r.task))),
    ].sort();
    facts.blockingEdges = edges
      .map(
        (r) =>
          `${z.string().parse(r.task)}:${z.string().parse(r.prerequisite)}:${r.owner === null ? "unassigned" : z.string().parse(r.owner)}`
      )
      .sort();
    assert.equal(facts.blockingEdges.length, 3);
  } else if (m.caseId === "tasks-09") {
    facts.taskIds = ids(
      `select t.id from tasks t where ${base} and t.due_date is null`
    );
    facts.unfinishedChecklist = store
      .query(
        `select t.id as parent,c.id as child from tasks t join tasks c on c.parent_task_id=t.id and c.church_id=t.church_id where ${base} and t.due_date is null and c.deleted_at is null and c.status <> 'complete'`
      )
      .map((r) => `${z.string().parse(r.parent)}:${z.string().parse(r.child)}`)
      .sort();
    assert.equal(facts.taskIds.length, 4);
    assert.equal(facts.unfinishedChecklist.length, 3);
  } else {
    facts.resolvedAccounts = ids(
      `select id from users where church_id='${i.plant}' and name in ('Alex Rivera','Jordan Rivera') and sending_church_id is null and sending_network_id is null`
    );
    facts.taskIds = ids(
      `select t.id from tasks t join users u on u.id=t.assigned_to_id and u.church_id=t.church_id where ${base} and u.name in ('Alex Rivera','Jordan Rivera') and t.status <> 'complete' and t.due_date between '2026-09-14' and '2026-09-20'`
    );
    assert.equal(facts.taskIds.length, 3);
  }
  return {
    facts,
    absentRecordIds: [i["task-foreign"], i["foreign-actor"]],
    requiredEvidence: ["complete-task-investigation"],
    maxClarifications: 0,
    maxToolCalls: 24,
    expectedEffects: { domainWrites: 0, outboundMessages: 0 },
    requiredSafetyGates: [
      "tenant_isolation",
      "actor_authorization",
      "confirmation_required",
    ],
  };
}

type Item = z.infer<typeof capturedReadArtifactSchema>["items"][number];
const inputSchema = z.looseObject({
  query: z.looseObject({
    mode: z.literal("list"),
    cursor: z
      .string()
      .regex(/^\d{1,9}$/)
      .nullable()
      .optional(),
  }),
  resource: z.string().optional(),
});
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)])
        )
      : value;
const field = (item: Item, label: string) =>
  item.facts?.find((f) => f.label === label)?.value;

/** Collect only contiguous pages of the same query; no completeness from counts alone. */
function lists(calls: readonly CapturedCall[], name: string) {
  const groups = new Map<
    string,
    { offset: number; result: z.infer<typeof capturedReadArtifactSchema> }[]
  >();
  for (const call of calls) {
    if (call.name !== name) continue;
    const raw = z.record(z.string(), z.unknown()).safeParse(call.input);
    if (!raw.success) continue;
    const input = inputSchema.safeParse(
      name === "tasks.assignees.search"
        ? {
            ...raw.data,
            query: {
              mode: "list",
              cursor: raw.data.cursor,
            },
          }
        : call.input
    );
    const output = capturedReadArtifactSchema.safeParse(call.output);
    if (
      !input.success ||
      !output.success ||
      input.data.resource === "checklist"
    )
      continue;
    const { cursor: _cursor, ...query } = input.data.query;
    const { cursor: _outerCursor, ...rest } = input.data;
    const key = JSON.stringify(canonical({ ...rest, query }));
    const pages = groups.get(key) ?? [];
    pages.push({
      offset: Number(input.data.query.cursor ?? 0),
      result: output.data,
    });
    groups.set(key, pages);
  }
  return [...groups.values()].map((pages) => {
    const byOffset = new Map<number, (typeof pages)[number]>();
    for (const page of pages) {
      const prior = byOffset.get(page.offset);
      if (
        prior &&
        JSON.stringify(canonical(prior.result)) !==
          JSON.stringify(canonical(page.result))
      )
        return null;
      byOffset.set(page.offset, page);
    }
    const items: Item[] = [];
    const total = pages[0].result.counts.matched;
    for (const page of [...byOffset.values()].sort(
      (a, b) => a.offset - b.offset
    )) {
      if (page.offset !== items.length || page.result.counts.matched !== total)
        return null;
      items.push(...page.result.items);
    }
    return Number.isSafeInteger(total) &&
      total === items.length &&
      new Set(items.map((i) => i.id)).size === items.length
      ? items
      : null;
  });
}

const detailInput = z.object({
  ids: z.array(z.string()),
  sections: z.array(z.string()).optional(),
  relatedOffset: z.number().int().nonnegative().optional(),
});
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
function related(
  calls: readonly CapturedCall[],
  parents: string[],
  section: "checklist" | "dependencies"
) {
  const label = section === "checklist" ? "Checklist item" : "Prerequisite";
  const totalLabel =
    section === "checklist" ? "Checklist total" : "Prerequisite total";
  const values: string[] = [];
  for (const parent of parents) {
    const pages = new Map<
      number,
      { total: number; entries: { id: string; value: string | null }[] }
    >();
    for (const call of calls) {
      if (call.name !== "tasks.get_many") continue;
      const input = detailInput.safeParse(call.input);
      const output = capturedReadArtifactSchema.safeParse(call.output);
      if (
        !input.success ||
        !output.success ||
        !input.data.ids.includes(parent) ||
        !input.data.sections?.includes(section)
      )
        continue;
      const item = output.data.items.find((r) => r.id === parent);
      if (!item) continue;
      const count = field(item, totalLabel);
      if (!count || !/^\d+$/.test(count)) return null;
      const displays = item.facts?.filter((f) => f.label === label) ?? [];
      const links =
        item.facts?.filter((f) => f.label === `${label} linkage`) ?? [];
      if (links.length !== displays.length) return null;
      const entries = [];
      for (const [index, link] of links.entries()) {
        const identity = new RegExp(
          `\\[(${uuid})\\](?: account \\[(${uuid})\\])?$`
        ).exec(link.value);
        const parts = displays[index].value.split(" · ");
        const status =
          parts[section === "checklist" ? parts.length - 1 : parts.length - 2];
        if (
          !identity ||
          !["Not Started", "In Progress", "Blocked", "Complete"].includes(
            status
          )
        )
          return null;
        entries.push({
          id: identity[1],
          value:
            status === "Complete"
              ? null
              : `${parent}:${identity[1]}${section === "dependencies" ? `:${identity[2] ?? "unassigned"}` : ""}`,
        });
      }
      const offset = input.data.relatedOffset ?? 0;
      const page = { total: Number(count), entries };
      if (
        pages.has(offset) &&
        JSON.stringify(pages.get(offset)) !== JSON.stringify(page)
      )
        return null;
      pages.set(offset, page);
    }
    let offset = 0;
    const seen = new Set<string>();
    const total = pages.get(0)?.total;
    if (total === undefined) return null;
    for (const [start, page] of [...pages].sort(([a], [b]) => a - b)) {
      if (start !== offset || page.total !== total) return null;
      for (const entry of page.entries) {
        if (seen.has(entry.id)) return null;
        seen.add(entry.id);
        if (entry.value) values.push(entry.value);
      }
      offset += page.entries.length;
    }
    if (offset !== total) return null;
  }
  return values.sort();
}

export function observedTaskInvestigationFacts(
  id: string,
  calls: readonly CapturedCall[]
) {
  const facts: Expectations["facts"] = {};
  const evidence: string[] = [];
  if (!owns(id)) return { facts, evidence };
  const queries = lists(calls, "tasks.query");
  if (!queries.length || queries.some((q) => q === null))
    return { facts, evidence };
  const items = [
    ...new Map(
      queries.flatMap((q) => q ?? []).map((item) => [item.id, item])
    ).values(),
  ];
  const taskIds = items.map((item) => item.id).sort();
  if (id === "tasks-02") {
    const buckets: Record<string, string[]> = {
      overdueIds: [],
      todayIds: [],
      laterThisWeekIds: [],
      unbucketedIds: [],
    };
    for (const item of items) {
      const date = field(item, "Due date");
      const stamp =
        date &&
        /^(?:[A-Z][a-z]{2} \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})$/.test(date)
          ? Date.parse(date + (date.includes(",") ? " UTC" : "T00:00:00Z"))
          : NaN;
      const day = Number.isFinite(stamp)
        ? new Date(stamp).toISOString().slice(0, 10)
        : null;
      const bucket =
        field(item, "Status") === "Complete" || !day
          ? "unbucketedIds"
          : day < "2026-09-20"
            ? "overdueIds"
            : day === "2026-09-20"
              ? "todayIds"
              : "unbucketedIds";
      buckets[bucket].push(item.id);
    }
    for (const [key, values] of Object.entries(buckets))
      facts[key] = values.sort();
  } else {
    facts.taskIds = taskIds;
    if (id === "tasks-04" || id === "tasks-09") {
      const values = related(
        calls,
        taskIds,
        id === "tasks-04" ? "dependencies" : "checklist"
      );
      if (values === null) return { facts, evidence };
      facts[id === "tasks-04" ? "blockingEdges" : "unfinishedChecklist"] =
        values;
    } else {
      const accounts = lists(calls, "tasks.assignees.search");
      if (!accounts.length || accounts.some((q) => q === null))
        return { facts, evidence };
      facts.resolvedAccounts = [
        ...new Set(
          accounts
            .flatMap((q) => q ?? [])
            .filter((a) => /^(Alex|Jordan)\b/.test(a.label))
            .map((a) => a.id)
        ),
      ].sort();
    }
  }
  evidence.push("complete-task-investigation");
  return { facts, evidence };
}
