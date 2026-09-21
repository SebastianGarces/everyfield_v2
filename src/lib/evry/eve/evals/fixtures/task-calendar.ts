import { z } from "zod";
import type { Expectations } from "../contract";
import { fixtureId, FIXTURE_NOW, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";

export const taskCalendarFixtureIds = [
  "regression-multi-assignee",
  "edges-02",
  "regression-today-midnight",
] as const;
const owns = (id: string) => taskCalendarFixtureIds.some((v) => v === id);
export const taskCalendarId = (m: FixtureManifest, key: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `task-calendar:${key}`);

/** Fixture server clock, never a model argument or browser timezone. */
export function taskCalendarReferenceInstant(caseId: string): Date {
  return new Date(
    caseId === "edges-02" || caseId === "regression-today-midnight"
      ? "2026-09-20T00:30:00.000Z"
      : FIXTURE_NOW
  );
}

export function seedTaskCalendarFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  if (!owns(m.caseId)) return;
  const i = m.ids;
  const add = (
    name: string,
    due: string,
    owner = i.actor,
    status = "not_started",
    parent: string | null = null,
    deleted = false
  ) => {
    const id = taskCalendarId(m, name);
    store.sql(
      `insert into tasks(id,church_id,title,status,due_date,assigned_to_id,parent_task_id,deleted_at,created_by_id) values ('${id}','${i.plant}','Calendar ${name}','${status}','${due}','${owner}',${parent ? `'${parent}'` : "null"},${deleted ? "'2026-09-01'" : "null"},'${i.actor}');`
    );
    return id;
  };
  if (m.caseId === "regression-multi-assignee") {
    for (const [name, person] of [
      ["Alex", i["core-alex"]],
      ["Jordan", i["core-jordan"]],
    ] as const) {
      const account = taskCalendarId(m, name);
      store.sql(
        `insert into users(id,email,password_hash,name,seat,church_id) values ('${account}','${account}@example.test','unusable-fixture-password','${name} Rivera','member','${i.plant}'); update persons set first_name='${name}',last_name='Rivera',user_id='${account}' where id='${person}' and church_id='${i.plant}';`
      );
    }
    store.sql(
      `update users set name='Alex Foreign' where id='${i["foreign-actor"]}'; update persons set first_name='Jordan',last_name='Unlinked' where id='${i["prospect-new"]}';`
    );
    const alex = taskCalendarId(m, "Alex"),
      jordan = taskCalendarId(m, "Jordan");
    const parent = add("alex-monday", "2026-09-14", alex);
    add("jordan-sunday", "2026-09-20", jordan, "blocked");
    add("alex-progress", "2026-09-17", alex, "in_progress");
    add("alex-before-week", "2026-09-13", alex);
    add("jordan-next-week", "2026-09-21", jordan);
    add("alex-complete", "2026-09-15", alex, "complete");
    add("jordan-deleted", "2026-09-15", jordan, "not_started", null, true);
    add("alex-child", "2026-09-15", alex, "not_started", parent);
  } else {
    // All statuses are intentional: neither original says "pending". A date
    // query must not silently omit completed tasks or other people's work.
    for (const day of [
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]) {
      add(`open-${day}`, day);
      add(`complete-${day}`, day, i.actor, "complete");
      add(`other-${day}`, day, i["other-actor"], "in_progress");
    }
    add("deleted-local-day", "2026-09-19", i.actor, "not_started", null, true);
    add(
      "child-local-day",
      "2026-09-19",
      i.actor,
      "not_started",
      i["task-overdue"]
    );
  }
}

/** PostgreSQL owns expected calendar arithmetic; no production date helper is reused. */
export function taskCalendarTruth(
  m: FixtureManifest,
  store: FixtureStore,
  now = taskCalendarReferenceInstant(m.caseId)
) {
  const calendar = z
    .object({
      day: z.string(),
      from: z.string(),
      through: z.string(),
      zone: z.string(),
    })
    .parse(
      store.query(
        `select time_zone as zone, ('${now.toISOString()}'::timestamptz at time zone time_zone)::date::text as day, date_trunc('week','${now.toISOString()}'::timestamptz at time zone time_zone)::date::text as "from", (date_trunc('week','${now.toISOString()}'::timestamptz at time zone time_zone)::date + 6)::text as through from churches where id='${m.ids.plant}'`
      )[0]
    );
  const multi = m.caseId === "regression-multi-assignee";
  const predicate = multi
    ? `and t.status <> 'complete' and t.due_date between '${calendar.from}' and '${calendar.through}' and t.assigned_to_id in (select u.id from users u join persons p on p.user_id=u.id and p.church_id=u.church_id and p.deleted_at is null where u.church_id='${m.ids.plant}' and u.sending_church_id is null and u.sending_network_id is null and p.id in ('${m.ids["core-alex"]}','${m.ids["core-jordan"]}'))`
    : `and t.due_date='${calendar.day}'`;
  const taskIds = store
    .query(
      `select t.id from tasks t where t.church_id='${m.ids.plant}' and t.deleted_at is null and t.parent_task_id is null ${predicate} order by t.id`
    )
    .map((r) => z.uuid().parse(r.id));
  const links = multi
    ? store
        .query(
          `select p.id as person,u.id as account from persons p join users u on p.user_id=u.id and p.church_id=u.church_id where p.church_id='${m.ids.plant}' and p.deleted_at is null and p.id in ('${m.ids["core-alex"]}','${m.ids["core-jordan"]}')`
        )
        .map((r) => `${z.uuid().parse(r.person)}:${z.uuid().parse(r.account)}`)
        .sort()
    : [];
  return { ...calendar, taskIds, links };
}

export function taskCalendarExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (!owns(m.caseId)) return null;
  const truth = taskCalendarTruth(m, store);
  return {
    facts:
      m.caseId === "regression-multi-assignee"
        ? {
            taskIds: truth.taskIds,
            assigneeAccounts: [
              ...new Set(truth.links.map((link) => link.split(":")[1]!)),
            ].sort(),
          }
        : {
            taskIds: truth.taskIds,
            localDate: truth.day,
            timeZone: truth.zone,
          },
    absentRecordIds: [m.ids["task-foreign"], m.ids["foreign-actor"]],
    requiredEvidence: [
      "complete-calendar-task-query",
      ...(m.caseId === "regression-multi-assignee"
        ? ["resolved-task-assignees"]
        : ["church-local-calendar"]),
    ],
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

const inputSchema = z.looseObject({
  query: z.looseObject({
    mode: z.literal("list"),
    cursor: z.string().regex(/^\d+$/).nullable().optional(),
  }),
});
const contextSchema = z.object({
  today: z.string().date(),
  timeZone: z.string(),
  referenceInstant: z.string().datetime(),
});
const calendarTodayInput = z.object({
  date: z.object({
    kind: z.literal("relative_day"),
    daysFromToday: z.literal(0),
  }),
});
const calendarTodayOutput = z.object({
  status: z.literal("resolved"),
  calendarDate: z.string().date(),
  timeZone: z.string(),
  referenceInstant: z.string().datetime(),
});
const assignmentSchema = z.object({
  kind: z.enum(["people", "accounts"]),
  ids: z.array(z.uuid()).min(1),
});
const assignmentsInput = z.object({
  where: z.object({
    all: z
      .array(z.looseObject({ assignment: assignmentSchema.optional() }))
      .optional(),
    any: z
      .array(z.looseObject({ assignment: assignmentSchema.optional() }))
      .optional(),
  }),
});
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
}
export function observedTaskCalendarFacts(
  id: string,
  calls: readonly CapturedCall[]
) {
  const facts: Expectations["facts"] = {},
    evidence: string[] = [];
  if (!owns(id)) return { facts, evidence };
  const runs: {
    call: CapturedCall;
    signature: string;
    offset: number;
    output: z.infer<typeof capturedReadArtifactSchema>;
  }[] = [];
  for (const call of calls) {
    if (call.name !== "tasks.query") continue;
    const input = inputSchema.safeParse(call.input),
      output = capturedReadArtifactSchema.safeParse(call.output);
    if (!input.success || !output.success) continue;
    const { cursor, ...query } = input.data.query;
    const page = {
      call,
      signature: JSON.stringify(canonical({ ...input.data, query })),
      offset: Number(cursor ?? 0),
      output: output.data,
    };
    if (page.offset === 0 || runs.at(-1)?.signature !== page.signature)
      runs.length = 0;
    runs.push(page);
  }
  let completeRows:
    | z.infer<typeof capturedReadArtifactSchema>["items"]
    | undefined;
  if (runs.length) {
    const rows = runs.flatMap((p) => p.output.items);
    let offset = 0;
    const total = runs.at(-1)!.output.counts.matched;
    const contiguous = runs.every((page) => {
      const valid =
        page.offset === offset && page.output.counts.matched === total;
      offset += page.output.items.length;
      return valid;
    });
    if (
      contiguous &&
      total === rows.length &&
      new Set(rows.map((r) => r.id)).size === rows.length
    ) {
      facts.taskIds = rows.map((r) => r.id).sort();
      completeRows = rows;
      evidence.push("complete-calendar-task-query");
    }
  }
  if (id === "regression-multi-assignee") {
    const accounts = new Set<string>(),
      persons = new Set<string>();
    // Resolution must precede the final query; later unrelated lookups cannot
    // retroactively establish the identities used by that query.
    const firstQuery = runs[0]?.call;
    for (const call of calls.slice(
      0,
      firstQuery ? calls.indexOf(firstQuery) : 0
    )) {
      if (
        !["tasks.assignees.search", "people.query", "people.get_many"].includes(
          call.name
        )
      )
        continue;
      const output = capturedReadArtifactSchema.safeParse(call.output);
      if (!output.success) continue;
      for (const row of output.data.items) {
        const field = (label: string) =>
          row.facts?.find((f) => f.label === label)?.value;
        if (
          call.name === "tasks.assignees.search" &&
          z.uuid().safeParse(row.id).success &&
          field("Account ID") === row.id
        )
          accounts.add(row.id);
        if (
          call.name !== "tasks.assignees.search" &&
          z.uuid().safeParse(row.id).success &&
          field("person_id") === row.id
        )
          persons.add(row.id);
      }
    }
    const owners = completeRows?.map(
      (row) => row.facts?.find((f) => f.label === "Assignee account ID")?.value
    );
    if (owners && owners.every((owner) => z.uuid().safeParse(owner).success))
      facts.assigneeAccounts = [
        ...new Set(owners.map((owner) => z.uuid().parse(owner))),
      ].sort();
    const input = assignmentsInput.safeParse(firstQuery?.input);
    if (input.success) {
      const selections = [
        ...(input.data.where.all ?? []),
        ...(input.data.where.any ?? []),
      ].flatMap((filter) => (filter.assignment ? [filter.assignment] : []));
      if (
        completeRows &&
        selections.length &&
        selections.every((selection) =>
          selection.ids.every((id) =>
            (selection.kind === "people" ? persons : accounts).has(id)
          )
        )
      )
        evidence.push("resolved-task-assignees");
    }
  } else {
    const clocks = calls.flatMap((call) => {
      if (call.name === "context.get") {
        const result = contextSchema.safeParse(call.output);
        return result.success
          ? [{ day: result.data.today, zone: result.data.timeZone }]
          : [];
      }
      if (
        call.name === "calendar.resolve" &&
        calendarTodayInput.safeParse(call.input).success
      ) {
        const result = calendarTodayOutput.safeParse(call.output);
        return result.success
          ? [{ day: result.data.calendarDate, zone: result.data.timeZone }]
          : [];
      }
      return [];
    });
    const clock = clocks.at(-1);
    if (clock) {
      facts.localDate = clock.day;
      facts.timeZone = clock.zone;
      evidence.push("church-local-calendar");
    }
  }
  return { facts, evidence };
}
