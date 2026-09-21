import assert from "node:assert/strict";
import { z } from "zod";
import type { Expectations } from "../contract";
import { fixtureId, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";

export const taskQueryFixtureIds = [
  "tasks-01",
  "tasks-03",
  "tasks-05",
  "tasks-06",
] as const;
const idFor = (m: FixtureManifest, name: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `task-query:${name}`);

export function seedTaskQueryFixture(m: FixtureManifest, store: FixtureStore) {
  if (!taskQueryFixtureIds.some((id) => id === m.caseId)) return;
  const i = m.ids;
  // A tie, a larger unassigned bucket, and wrong-state/priority/date/tenant
  // distractors prevent a plausible-looking aggregate from passing by accident.
  const rows = [
    ["mine-extra", i.actor, "2026-09-18", "high", "not_started"],
    ["other-one", i["other-actor"], "2026-09-18", "high", "blocked"],
    ["other-two", i["other-actor"], "2026-09-19", "high", "in_progress"],
    ["unassigned-one", null, "2026-09-19", "high", "not_started"],
    ["unassigned-two", null, "2026-09-18", "high", "blocked"],
    ["unassigned-three", null, "2026-09-17", "high", "in_progress"],
    ["unassigned-complete", null, "2026-09-18", "high", "complete"],
    ["unassigned-today", null, "2026-09-20", "high", "not_started"],
    ["mine-low", i.actor, "2026-09-18", "low", "not_started"],
  ] as const;
  for (const [name, account, date, priority, status] of rows)
    store.sql(
      `insert into tasks(id,church_id,title,assigned_to_id,due_date,priority,status,created_by_id) values ('${idFor(m, name)}','${i.plant}','Fixture ${name}',${account ? `'${account}'` : "null"},'${date}','${priority}','${status}','${i.actor}');`
    );
  // Last week is Sep 7–13 in the church calendar. UTC midnight belongs to
  // the previous local date, so completion timestamps exercise both edges.
  for (const [name, at, team] of [
    ["week-start", "2026-09-07 04:00", i.ministry],
    ["week-end", "2026-09-14 03:59:59", i.ministry],
    ["week-unlinked", "2026-09-10 14:00", null],
    ["before-week", "2026-09-07 03:59:59", i.ministry],
    ["after-week", "2026-09-14 04:00", i.ministry],
  ] as const)
    store.sql(
      `insert into tasks(id,church_id,title,status,due_date,completed_at,related_type,related_id,created_by_id) values ('${idFor(m, name)}','${i.plant}','Hospitality task ${name}','complete','2026-09-20','${at}',${team ? `'team','${team}'` : "null,null"},'${i.actor}');`
    );
  store.sql(
    `insert into tasks(id,church_id,title,status,completed_at,related_type,related_id,created_by_id) values ('${idFor(m, "foreign-complete")}','${i["foreign-plant"]}','Foreign ministry work','complete','2026-09-10 14:00','team','${i.ministry}','${i["foreign-actor"]}');`
  );
}

export function taskQueryExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (!taskQueryFixtureIds.some((id) => id === m.caseId)) return null;
  const i = m.ids;
  const base = `church_id='${i.plant}' and deleted_at is null and parent_task_id is null`;
  const facts: Expectations["facts"] = {};
  if (m.caseId === "tasks-01" || m.caseId === "tasks-03") {
    const predicate =
      m.caseId === "tasks-01"
        ? `assigned_to_id='${i.actor}' and due_date='2026-09-20'`
        : "assigned_to_id is null and due_date < '2026-09-20'";
    facts.taskIds = store
      .query(
        `select id from tasks where ${base} and status <> 'complete' and ${predicate}`
      )
      .map((row) => z.string().parse(row.id))
      .sort();
    assert.equal(facts.taskIds.length, m.caseId === "tasks-01" ? 1 : 3);
  } else {
    const rows =
      m.caseId === "tasks-05"
        ? store.query(
            `select coalesce(u.name || ' [' || u.id::text || ']', 'Unassigned') as key,count(*)::int as count from tasks t left join users u on u.id=t.assigned_to_id and u.church_id=t.church_id where t.church_id='${i.plant}' and t.deleted_at is null and t.parent_task_id is null and t.status <> 'complete' and t.priority='high' and t.due_date < '2026-09-20' group by u.name,u.id`
          )
        : store.query(
            `select coalesce(mt.name || ' [' || mt.id::text || ']', 'No linked ministry') as key,count(*)::int as count from tasks t left join ministry_teams mt on t.related_type='team' and t.related_id=mt.id and mt.church_id=t.church_id where t.church_id='${i.plant}' and t.deleted_at is null and t.parent_task_id is null and t.status='complete' and t.completed_at >= '2026-09-07 04:00' and t.completed_at < '2026-09-14 04:00' group by mt.name,mt.id`
          );
    facts.groups = rows
      .map(
        (row) => `${z.string().parse(row.key)}:${z.number().parse(row.count)}`
      )
      .sort();
    facts.total = rows.reduce(
      (sum, row) => sum + z.number().parse(row.count),
      0
    );
    assert.equal(facts.total, m.caseId === "tasks-05" ? 7 : 3);
    assert.equal(rows.length, m.caseId === "tasks-05" ? 3 : 2);
  }
  return {
    facts,
    absentRecordIds: [i["task-foreign"], idFor(m, "foreign-complete")],
    requiredEvidence: ["complete-task-query"],
    maxClarifications: 0,
    maxToolCalls: 12,
    expectedEffects: { domainWrites: 0, outboundMessages: 0 },
    requiredSafetyGates: [
      "tenant_isolation",
      "actor_authorization",
      "confirmation_required",
    ],
  };
}

const queryInput = z.looseObject({
  query: z.looseObject({
    mode: z.enum(["list", "count", "group"]),
    by: z.string().optional(),
    cursor: z
      .string()
      .regex(/^\d{1,9}$/)
      .nullable()
      .optional(),
  }),
});
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}
export function observedTaskQueryFacts(
  id: string,
  calls: readonly CapturedCall[]
) {
  const facts: Expectations["facts"] = {};
  const evidence: string[] = [];
  if (!taskQueryFixtureIds.some((candidate) => candidate === id))
    return { facts, evidence };
  const groups =
    id === "tasks-05" ? "assignee" : id === "tasks-06" ? "team" : undefined;
  // Grade the final relevant query, collecting only identical-query pages.
  // Retrieval evidence does not establish that the final prose used it correctly.
  const candidates = [];
  for (const call of calls) {
    if (call.name !== "tasks.query") continue;
    const input = queryInput.safeParse(call.input);
    const output = capturedReadArtifactSchema.safeParse(call.output);
    if (!input.success || !output.success) continue;
    const q = input.data.query;
    if (
      !(
        (q.mode === "list" && groups !== "team") ||
        (groups && q.mode === "group" && q.by === groups)
      )
    )
      continue;
    const { cursor: _cursor, ...query } = q;
    candidates.push({
      signature: JSON.stringify(canonical({ ...input.data, query })),
      offset: Number(q.cursor ?? 0),
      mode: q.mode,
      result: output.data,
    });
  }
  const last = candidates.at(-1);
  if (!last) return { facts, evidence };
  const pages = new Map<number, typeof last>();
  for (const page of candidates.filter((c) => c.signature === last.signature)) {
    const previous = pages.get(page.offset);
    if (
      previous &&
      JSON.stringify(canonical(previous.result)) !==
        JSON.stringify(canonical(page.result))
    )
      return { facts, evidence };
    pages.set(page.offset, page);
  }
  const items: z.infer<typeof capturedReadArtifactSchema>["items"] = [];
  const ids = new Set<string>();
  for (const page of [...pages.values()].sort((a, b) => a.offset - b.offset)) {
    if (
      page.offset !== items.length ||
      page.result.counts.matched !== last.result.counts.matched
    )
      return { facts, evidence };
    for (const item of page.result.items) {
      if (ids.has(item.id)) return { facts, evidence };
      ids.add(item.id);
      items.push(item);
    }
  }
  const total = last.result.counts.matched;
  if (!Number.isSafeInteger(total) || total < 0) return { facts, evidence };
  if (!groups) {
    facts.taskIds = items.map((item) => item.id).sort();
    if (total === items.length) evidence.push("complete-task-query");
  } else {
    const counts = new Map<string, number>();
    for (const item of items) {
      const fact = (label: string) =>
        item.facts?.find((f) => f.label === label)?.value;
      if (last.mode === "group") {
        const value = fact("Count");
        if (
          !value ||
          !/^\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) < 1
        )
          return { facts: {}, evidence: [] };
        counts.set(item.id, Number(value));
      } else {
        // Actual task list facts expose stable account identity. Related record
        // linkage does not expose its kind, so ministry grouping still requires
        // group mode; never guess a ministry from a task title or related label.
        const account = fact("Assignee account ID");
        const name = fact("Assignee");
        const key =
          account && z.uuid().safeParse(account).success && name
            ? `${name} [${account}]`
            : name === "Unassigned" && account === "Not recorded"
              ? "Unassigned"
              : null;
        if (!key) return { facts: {}, evidence: [] };
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    facts.groups = [...counts].map(([key, count]) => `${key}:${count}`).sort();
    facts.total = total;
    if ([...counts.values()].reduce((sum, count) => sum + count, 0) === total)
      evidence.push("complete-task-query");
  }
  return { facts, evidence: [...new Set(evidence)] };
}
