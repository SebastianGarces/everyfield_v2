import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  users,
  persons,
  tasks,
  taskDependencies,
  launchMilestoneTasks,
  ministryTeams,
  teamRoles,
  teamMemberships,
  teamResponsibilities,
  trainingPrograms,
  trainingCompletions,
  churchMeetings,
  locations,
  meetingChecklistItems,
  meetingEvaluations,
} from "@/db/schema";
import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import { formatOperationValue } from "./operations-display";
import { OPERATIONS_QUERY_READS } from "./operations";
import {
  executeOperations,
  operationsArtifact,
  operationsStatement,
  withOperationsBoundaries,
} from "./operations-core";
import {
  assigneesStatement,
  tasksGetManyStatement,
  tasksQueryShape,
  tasksQueryStatement,
} from "./operations-tasks";
import {
  meetingsGetManyStatement,
  meetingsQueryShape,
  meetingsQueryStatement,
} from "./operations-meetings";
import {
  teamsGetManyStatement,
  teamsQueryShape,
  teamsQueryStatement,
  trainingQueryShape,
  trainingQueryStatement,
} from "./operations-teams";

const PLANT = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const ACCOUNT = "20000000-0000-4000-8000-000000000001";
const PERSON = "30000000-0000-4000-8000-000000000001";
const TASK = "40000000-0000-4000-8000-000000000001";
const TEAM = "50000000-0000-4000-8000-000000000001";
const ROLE = "60000000-0000-4000-8000-000000000001";
const MEETING = "70000000-0000-4000-8000-000000000001";
const PROGRAM = "80000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-11T02:00:00Z");
const ZONE = "America/New_York";
const dialect = new PgDialect();
const taskInput = (input: unknown) =>
  z.object(tasksQueryShape).strict().parse(input);
const meetingInput = (input: unknown) =>
  z.object(meetingsQueryShape).strict().parse(input);
const teamInput = (input: unknown) =>
  z.object(teamsQueryShape).strict().parse(input);
const trainingInput = (input: unknown) =>
  z.object(trainingQueryShape).strict().parse(input);

test("eight public contracts reject unsupported filters and tenant input", () => {
  assert.equal(OPERATIONS_QUERY_READS.length, 8);
  assert.equal(new Set(OPERATIONS_QUERY_READS.map((r) => r.id)).size, 8);
  const get = OPERATIONS_QUERY_READS.find((r) => r.id === "tasks.get_many")!;
  assert.equal(get.inputSchema.safeParse({ ids: [] }).success, false);
  assert.equal(
    get.inputSchema.safeParse({ ids: Array(51).fill(TASK) }).success,
    false
  );
  assert.equal(
    get.inputSchema.safeParse({ ids: [TASK], plantId: OTHER }).success,
    false
  );
  assert.throws(() => taskInput({ query: { mode: "count", cursor: "1" } }));
  assert.throws(() =>
    taskInput({
      query: { mode: "list" },
      where: { all: [{ arbitrarySql: "true" }] },
    })
  );
  assert.throws(() =>
    trainingInput({
      request: {
        resource: "requirements",
        query: { mode: "count" },
        where: { all: [{ expired: true }] },
      },
    })
  );
  assert.throws(() =>
    teamInput({
      request: {
        resource: "roles",
        query: { mode: "count" },
        where: { all: [{ seat: "owner" }] },
      },
    })
  );
});

test("task dates retain plant-local today and completion windows", () => {
  const statement = tasksQueryStatement(
    taskInput({
      query: { mode: "list" },
      where: {
        all: [
          {
            assignment: { kind: "mine" },
            due: { kind: "relative", period: "today" },
          },
        ],
      },
    }),
    PLANT,
    ACCOUNT,
    NOW,
    ZONE
  );
  const compiled = dialect.sqlToQuery(statement);
  assert(compiled.params.includes("2026-09-10"));
  assert(!compiled.params.includes("2026-09-11"));
  assert.match(compiled.sql, /t\.church_id =/);
  assert.match(compiled.sql, /t\.deleted_at is null/);
  assert.match(
    compiled.sql,
    /row_number\(\) over\(order by due asc nulls last, id asc\)/
  );
});

test("count and groups run against filtered population without page truncation", () => {
  const compiled = dialect.sqlToQuery(
    operationsStatement(
      sql`select 'a' as id`,
      { mode: "group", by: "id", limit: 1, cursor: null },
      { id: sql`id` },
      {}
    )
  ).sql;
  assert.match(compiled, /from filtered group by/);
  assert.match(compiled, /select count\(\*\)::int from filtered/);
  assert(compiled.indexOf("group by") < compiled.indexOf("limit"));
  const count = dialect.sqlToQuery(
    tasksQueryStatement(
      taskInput({ query: { mode: "count" } }),
      PLANT,
      ACCOUNT,
      NOW,
      ZONE
    )
  ).sql;
  assert(!count.includes("limit"));
});

test("negative relations and account-person links stay scoped and use real IDs", () => {
  const task = dialect.sqlToQuery(
    tasksQueryStatement(
      taskInput({
        query: { mode: "count" },
        where: {
          all: [
            {
              assignment: { kind: "people", ids: [PERSON] },
              incompletePrerequisites: false,
              launchMilestone: false,
            },
          ],
        },
      }),
      PLANT,
      ACCOUNT,
      NOW,
      ZONE
    )
  ).sql;
  assert.match(task, /p\.user_id = a\.id/);
  assert.match(task, /not exists \(select 1 from task_dependencies/);
  assert.match(task, /dep\.church_id =/);
  const requirements = dialect.sqlToQuery(
    trainingQueryStatement(
      trainingInput({
        request: {
          resource: "requirements",
          query: { mode: "count" },
          where: { all: [{ completed: false }] },
        },
      }),
      PLANT,
      NOW,
      ZONE
    )
  ).sql;
  assert.match(requirements, /program\.is_required and exists/);
  assert.match(requirements, /completion\.id is null/);
  assert.match(requirements, /current_seat\.status = 'active'/);
  assert(!requirements.includes("join team_memberships current_seat"));
});

test("runtime boundary preserves exact totals, missing IDs and read failures", async () => {
  const result = {
    total: 22,
    rows: [{ id: TASK, label: "Task", facts: [], href: "/tasks" }],
    next_cursor: "1",
  };
  await withOperationsBoundaries({ execute: async () => result }, async () => {
    const data = await executeOperations(sql`select 1`);
    const artifact = operationsArtifact("Tasks", "/tasks", data, {}, NOW, ZONE);
    assert.deepEqual(artifact.counts, {
      matched: 22,
      returned: 1,
      excluded: 0,
    });
    storedEvryReadArtifactDocument(artifact);
    publicEvryArtifact(artifact);
    const zero = operationsArtifact(
      "Tasks",
      "/tasks",
      { total: 0, rows: [], next_cursor: null },
      {},
      NOW,
      ZONE,
      undefined,
      "count"
    );
    storedEvryReadArtifactDocument(zero);
    publicEvryArtifact(zero);
    const batch = operationsArtifact(
      "Tasks",
      "/tasks",
      { ...data, total: 1 },
      {},
      NOW,
      ZONE,
      [TASK, OTHER]
    );
    assert.equal(batch.items[1].label, "Record unavailable");
  });
  await withOperationsBoundaries(
    {
      execute: async () => {
        throw new Error("Database unavailable");
      },
    },
    async () => {
      await assert.rejects(
        executeOperations(sql`select 1`),
        /Database unavailable/
      );
    }
  );
});

test("cards format explicit domain fields without rewriting user content or exposing model linkage", async () => {
  const result = {
    total: 1,
    next_cursor: null,
    rows: [
      {
        id: TASK,
        label: "A user's not_started document",
        facts: [
          {
            label: "Status",
            value: "not_started",
            format: "task_status" as const,
          },
          {
            label: "Due date",
            value: "2026-09-10",
            format: "calendar" as const,
          },
          {
            label: "When",
            value: "2026-09-10 10:00:00",
            format: "meeting_time" as const,
          },
          {
            label: "Completed",
            value: "2026-09-11 02:00:00",
            format: "instant" as const,
          },
          { label: "Person ID", value: PERSON, modelOnly: true as const },
          {
            label: "Role",
            value: "Greeter",
            modelFact: {
              label: "Role linkage",
              value: ROLE,
              modelOnly: true as const,
            },
          },
        ],
      },
    ],
  };
  await withOperationsBoundaries({ execute: async () => result }, async () => {
    const model = operationsArtifact(
      "Tasks",
      "/tasks",
      await executeOperations(sql`select 1`),
      {},
      NOW,
      ZONE
    );
    const stored = storedEvryReadArtifactDocument(model);
    assert.equal(stored.kind, "read");
    if (stored.kind === "read")
      assert(
        stored.items[0].facts.some(
          (fact) => fact.modelOnly && fact.value === ROLE
        )
      );
    assert(
      model.items[0].facts.some(
        (fact) => fact.modelOnly && fact.value === PERSON
      )
    );
    const projected = publicEvryArtifact(model);
    assert.equal(projected.kind, "read");
    if (projected.kind !== "read") return;
    assert.equal(projected.items[0].label, "A user's not_started document");
    assert.deepEqual(
      projected.items[0].facts.map((fact) => fact.value),
      [
        "Not Started",
        "Sep 10, 2026",
        "Thursday, September 10, 2026 at 10:00 AM EDT",
        "Thursday, September 10, 2026 at 10:00 PM EDT",
        "Greeter",
      ]
    );
  });
  assert.match(
    formatOperationValue("2026-01-10 10:00:00", "meeting_time", ZONE),
    /10:00 AM EST$/
  );
  assert.equal(
    formatOperationValue(`A role [${ROLE}]`, undefined, ZONE),
    `A role [${ROLE}]`
  );
});

test("maximum batch artifacts retain long text and disclose detail preview limits", () => {
  const ids = Array.from(
    { length: 50 },
    (_, i) => `40000000-0000-4000-8000-${String(i).padStart(12, "0")}`
  );
  const rows = ids.map((id) => ({
    id,
    label: "Long task title ".repeat(30),
    href: "/tasks",
    facts: Array.from({ length: 45 }, (_, i) => ({
      label: `Detail ${i}`,
      value: "x".repeat(2000),
    })),
  }));
  const artifact = operationsArtifact(
    "Tasks",
    "/tasks",
    { rows, total: 50, next_cursor: null },
    { ids },
    NOW,
    ZONE,
    ids
  );
  storedEvryReadArtifactDocument(artifact);
  publicEvryArtifact(artifact);
  assert.equal(artifact.items.length, 50);
  for (const item of artifact.items) {
    assert.equal(item.facts.length, 32);
    assert(
      item.facts.every(
        (fact) => fact.value.length <= 500 && fact.label.length <= 120
      )
    );
    assert.match(item.facts.at(-1)!.value, /characters remain/);
  }
  assert(!artifact.filters.some((filter) => filter.label === "Applied query"));
  const full = operationsArtifact(
    "Tasks",
    "/tasks",
    {
      rows: [
        {
          id: TASK,
          label: "Task",
          facts: [{ label: "Description", value: "a".repeat(2400) }],
        },
      ],
      total: 1,
      next_cursor: null,
    },
    {},
    NOW,
    ZONE
  );
  assert.equal(
    full.items[0].facts.map((fact) => fact.value).join(""),
    "a".repeat(2400)
  );
});

// Opt-in disposable PostgreSQL proof. This creates its own database only.
const container =
  process.env.EVRY_OPERATIONS_SQL_CONTAINER === "evry-758-people-query-proof"
    ? process.env.EVRY_OPERATIONS_SQL_CONTAINER
    : undefined;
// Actual schema names/types; constraints omitted to prove isolation even for corrupt relations.
const fixtureSchema = [
  users,
  persons,
  tasks,
  taskDependencies,
  launchMilestoneTasks,
  ministryTeams,
  teamRoles,
  teamMemberships,
  teamResponsibilities,
  trainingPrograms,
  trainingCompletions,
  churchMeetings,
  locations,
  meetingChecklistItems,
  meetingEvaluations,
]
  .map((table) => {
    const config = getTableConfig(table);
    return `create table "${config.name}" (${config.columns.map((column) => `"${column.name}" ${column.getSQLType()}`).join(",")});`;
  })
  .join("\n");
const database = `evry_operations_${process.pid}`;
function postgres(query: string, dbName = database) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container!,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      dbName,
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );
}
function literal(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (typeof value !== "string")
    throw new Error("Unsupported SQL proof parameter");
  return `'${value.replaceAll("'", "''")}'`;
}
function runSql(statement: SQL) {
  const compiled = dialect.sqlToQuery(statement);
  const expanded = compiled.sql.replace(/\$(\d+)/g, (_, n) =>
    literal(compiled.params[Number(n) - 1])
  );
  const result = JSON.parse(
    postgres(`select row_to_json(answer) from (${expanded}) answer;`)
  );
  const artifact = operationsArtifact(
    "Operations proof",
    "/tasks",
    result,
    {},
    NOW,
    ZONE
  );
  storedEvryReadArtifactDocument(artifact);
  const projected = publicEvryArtifact(artifact);
  assert.equal(projected.kind, "read");
  if (projected.kind === "read") {
    const visible = projected.items
      .flatMap((item) => [item.label, ...item.facts.map((fact) => fact.value)])
      .join("\n");
    assert.doesNotMatch(
      visible,
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    assert.doesNotMatch(
      visible,
      /\b(?:not_started|in_progress|follow_up|vision_meeting|core_group|following_up)\b/
    );
    assert.doesNotMatch(visible, /\b\d{4}-\d{2}-\d{2}(?:T|\b)/);
  }
  return result;
}

before(() => {
  if (!container) return;
  postgres(`create database ${database};`, "postgres");
  postgres(`
    ${fixtureSchema}
    insert into users (id, church_id, sending_church_id, sending_network_id, name, email) values ('${ACCOUNT}', '${PLANT}', null, null, 'Alex', 'alex@example.test');
    insert into persons (id, church_id, user_id, first_name, last_name, deleted_at, status) values ('${PERSON}', '${PLANT}', '${ACCOUNT}', 'Alex', 'Example', null, 'prospect');
    insert into persons (id, church_id, user_id, first_name, last_name, deleted_at, status) values ('${OTHER}', '${OTHER}', null, 'Foreign', 'Person', null, 'prospect');
    insert into ministry_teams (id, church_id, name, description, leader_id, status) values ('${TEAM}', '${PLANT}', 'Welcome', 'Welcoming guests', '${PERSON}', 'active');
    insert into team_roles (id, church_id, team_id, name, description, is_leadership_role, desired_skills, time_commitment, status) values ('${ROLE}', '${PLANT}', '${TEAM}', 'Greeter', 'Welcome guests', false, 'Hospitality', 'low', 'filled');
    insert into team_roles (id, church_id, team_id, name, description, is_leadership_role, desired_skills, time_commitment, status) values ('${OTHER}', '${PLANT}', '${TEAM}', 'Leader', null, true, null, 'high', 'open');
    insert into team_memberships (id, church_id, team_id, role_id, person_id, status, start_date, end_date) values ('${ROLE}', '${PLANT}', '${TEAM}', '${ROLE}', '${PERSON}', 'active', '2026-01-01', null);
    insert into team_memberships (id, church_id, team_id, role_id, person_id, status, start_date, end_date) values ('${OTHER}', '${PLANT}', '${TEAM}', '${OTHER}', '${PERSON}', 'inactive', '2025-01-01', '2025-02-01');
    insert into tasks (id, church_id, title, description, status, priority, due_date, assigned_to_id, category, related_type, related_id, completed_at, parent_task_id, deleted_at) values ('${TASK}', '${PLANT}', 'Due today', 'Call Alex', 'not_started', 'high', '2026-09-10', '${ACCOUNT}', 'follow_up', 'person', '${PERSON}', null, null, null);
    insert into tasks (id, church_id, title, description, status, priority, due_date, assigned_to_id, category, related_type, related_id, completed_at, parent_task_id, deleted_at) values ('${OTHER}', '${PLANT}', 'Overdue', null, 'in_progress', 'high', '2026-09-09', null, 'general', null, null, null, null, null);
    insert into tasks (id, church_id, title, description, status, priority, due_date, assigned_to_id, category, related_type, related_id, completed_at, parent_task_id, deleted_at) values ('${ROLE}', '${PLANT}', 'Undated child', null, 'not_started', 'low', null, null, 'general', null, null, null, '${TASK}', null);
    insert into task_dependencies (church_id, task_id, prerequisite_task_id) values ('${PLANT}', '${TASK}', '${OTHER}');
    insert into training_programs (id, church_id, team_id, name, description, is_required) values ('${PROGRAM}', '${PLANT}', '${TEAM}', 'Welcome basics', 'Required orientation', true);
    insert into church_meetings (id, church_id, title, type, status, datetime, location_id, location_name, location_address, team_id, actual_attendance, estimated_attendance, duration_minutes, notes, agenda) values ('${MEETING}', '${PLANT}', 'Orientation', 'orientation', 'planning', '2026-09-10 10:00:00', null, 'Church', 'Main street', '${TEAM}', null, 10, 60, 'Bring notebook', '[{"title":"Welcome"},{"title":"Next steps"}]');
    insert into meeting_checklist_items (id, church_id, meeting_id, item_name, is_checked, notes) values ('${MEETING}', '${PLANT}', '${MEETING}', 'Prepare room', false, null);
    insert into team_responsibilities (id, church_id, team_id, title, completed_at) values ('${TEAM}', '${PLANT}', '${TEAM}', 'Welcome every guest', null);
  `);
});
after(() => {
  if (container) postgres(`drop database if exists ${database};`, "postgres");
});

test(
  "PostgreSQL proof: all eight readers execute, filter and aggregate real fixtures",
  { skip: !container },
  () => {
    const today = runSql(
      tasksQueryStatement(
        taskInput({
          query: { mode: "list" },
          where: {
            all: [
              {
                assignment: { kind: "mine" },
                due: { kind: "relative", period: "today" },
              },
            ],
          },
        }),
        PLANT,
        ACCOUNT,
        NOW,
        ZONE
      )
    );
    assert.equal(today.total, 1);
    assert.equal(today.rows[0].id, TASK);
    const count = runSql(
      tasksQueryStatement(
        taskInput({ query: { mode: "count" } }),
        PLANT,
        ACCOUNT,
        NOW,
        ZONE
      )
    );
    assert.equal(count.total, 2);
    const group = runSql(
      tasksQueryStatement(
        taskInput({ query: { mode: "group", by: "due_bucket", limit: 1 } }),
        PLANT,
        ACCOUNT,
        NOW,
        ZONE
      )
    );
    assert.equal(group.total, 2);
    assert.equal(group.rows.length, 1);
    assert.equal(group.next_cursor, "1");
    const block = runSql(
      tasksQueryStatement(
        taskInput({
          query: { mode: "list" },
          where: { all: [{ incompletePrerequisites: true }] },
        }),
        PLANT,
        ACCOUNT,
        NOW,
        ZONE
      )
    );
    assert.equal(block.rows[0].id, TASK);
    assert.equal(
      runSql(
        tasksGetManyStatement(
          {
            ids: [TASK, OTHER],
            sections: ["details", "checklist", "dependencies"],
            relatedLimit: 1,
          },
          PLANT
        )
      ).rows.length,
      2
    );
    const assignees = runSql(
      assigneesStatement({ search: "Alex", limit: 25 }, PLANT)
    );
    assert.equal(assignees.rows[0].id, ACCOUNT);
    assert(
      assignees.rows[0].facts.some((f: { value: string }) => f.value === PERSON)
    );
    assert.equal(
      runSql(
        meetingsQueryStatement(
          meetingInput({
            query: { mode: "list" },
            where: {
              all: [
                {
                  date: { kind: "relative", period: "today" },
                  checklist: "incomplete",
                },
              ],
            },
          }),
          PLANT,
          NOW,
          ZONE
        )
      ).total,
      1
    );
    assert.equal(
      runSql(
        meetingsGetManyStatement(
          {
            ids: [MEETING],
            sections: ["details", "agenda", "checklist", "evaluation"],
            relatedLimit: 1,
          },
          PLANT,
          ZONE
        )
      ).rows.length,
      1
    );
    for (const resource of [
      "teams",
      "roles",
      "assignments",
      "people",
      "responsibilities",
    ]) {
      assert(
        runSql(
          teamsQueryStatement(
            teamInput({ request: { resource, query: { mode: "list" } } }),
            PLANT
          )
        ).total > 0
      );
    }
    assert.equal(
      runSql(
        teamsQueryStatement(
          teamInput({
            request: {
              resource: "roles",
              where: { all: [{ vacant: true }] },
              query: { mode: "count" },
            },
          }),
          PLANT
        )
      ).total,
      1
    );
    assert.equal(
      runSql(
        teamsQueryStatement(
          teamInput({
            request: {
              resource: "people",
              where: { all: [{ assigned: false }] },
              query: { mode: "count" },
            },
          }),
          PLANT
        )
      ).total,
      0
    );
    for (const resource of ["teams", "roles"] as const)
      assert.equal(
        runSql(
          teamsGetManyStatement(
            {
              resource,
              ids: [resource === "teams" ? TEAM : ROLE],
              sections: [
                "details",
                "roles",
                "roster",
                "responsibilities",
                "requirements",
              ],
              relatedLimit: 1,
            },
            PLANT
          )
        ).rows.length,
        1
      );
    assert.equal(
      runSql(
        trainingQueryStatement(
          trainingInput({
            request: { resource: "programs", query: { mode: "list" } },
          }),
          PLANT,
          NOW,
          ZONE
        )
      ).total,
      1
    );
    const required = trainingInput({
      request: {
        resource: "requirements",
        where: { all: [{ completed: false }] },
        query: { mode: "list" },
      },
    });
    assert.equal(
      runSql(trainingQueryStatement(required, PLANT, NOW, ZONE)).total,
      1
    );
    postgres(
      `insert into training_completions (id, church_id, person_id, training_program_id, completed_at) values ('${PROGRAM}', '${PLANT}', '${PERSON}', '${PROGRAM}', '2026-09-10 14:00:00');`
    );
    assert.equal(
      runSql(trainingQueryStatement(required, PLANT, NOW, ZONE)).total,
      0
    );
    assert.equal(
      runSql(
        trainingQueryStatement(
          trainingInput({
            request: { resource: "completions", query: { mode: "list" } },
          }),
          PLANT,
          NOW,
          ZONE
        )
      ).total,
      1
    );
    assert.equal(
      runSql(
        tasksGetManyStatement(
          { ids: [TASK], sections: ["details"], relatedLimit: 1 },
          OTHER
        )
      ).total,
      0
    );
    for (const by of [
      "status",
      "priority",
      "category",
      "assignee",
      "team",
      "due_bucket",
    ])
      assert.equal(
        runSql(
          tasksQueryStatement(
            taskInput({ query: { mode: "group", by } }),
            PLANT,
            ACCOUNT,
            NOW,
            ZONE
          )
        ).total,
        2
      );
    for (const by of ["type", "status", "team", "date", "month", "location"])
      assert.equal(
        runSql(
          meetingsQueryStatement(
            meetingInput({ query: { mode: "group", by } }),
            PLANT,
            NOW,
            ZONE
          )
        ).total,
        1
      );
    for (const by of ["person", "program", "team", "completion"])
      assert.equal(
        runSql(
          trainingQueryStatement(
            trainingInput({
              request: {
                resource: "completions",
                query: { mode: "group", by },
              },
            }),
            PLANT,
            NOW,
            ZONE
          )
        ).total,
        1
      );
    postgres(
      `update team_memberships set status = 'active' where id = '${OTHER}';`
    );
    assert.equal(
      runSql(
        trainingQueryStatement(
          trainingInput({
            request: { resource: "requirements", query: { mode: "count" } },
          }),
          PLANT,
          NOW,
          ZONE
        )
      ).total,
      1,
      "Two active roles must not duplicate a person's requirement"
    );
    assert.equal(
      runSql(
        teamsQueryStatement(
          teamInput({
            request: { resource: "people", query: { mode: "count" } },
          }),
          PLANT
        )
      ).total,
      1,
      "Person count differs from assignment count"
    );
    assert.equal(
      runSql(
        teamsQueryStatement(
          teamInput({
            request: { resource: "assignments", query: { mode: "count" } },
          }),
          PLANT
        )
      ).total,
      2
    );
    const midnight = new Date("2026-09-10T00:30:00Z");
    assert.equal(
      runSql(
        meetingsQueryStatement(
          meetingInput({
            query: { mode: "count" },
            where: { all: [{ date: { kind: "relative", period: "today" } }] },
          }),
          PLANT,
          midnight,
          ZONE
        )
      ).total,
      0,
      "Plant-local September 9 must not return a September 10 wall-clock meeting"
    );
    postgres(
      `update tasks set related_type='person',related_id='${OTHER}' where id='${OTHER}';`
    );
    assert.equal(
      runSql(
        tasksQueryStatement(
          taskInput({
            query: { mode: "count" },
            where: { all: [{ linked: { kind: "person", ids: [OTHER] } }] },
          }),
          PLANT,
          ACCOUNT,
          NOW,
          ZONE
        )
      ).total,
      0,
      "Foreign related IDs never identify an authorized person"
    );
    postgres(`
    update tasks set description=repeat('Detailed note ',600) where id='${TASK}';
    insert into tasks (id,church_id,title,status,parent_task_id) select ('90000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '${PLANT}', repeat('Checklist title ',20), 'not_started', '${TASK}' from generate_series(1,20) n;
    insert into task_dependencies (church_id,task_id,prerequisite_task_id) select '${PLANT}', '${TASK}', ('90000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,20) n;
    update church_meetings set notes=repeat('Meeting note ',600), agenda=(select jsonb_agg(jsonb_build_object('title', repeat('Topic ',20), 'description',repeat('Agenda detail ',80))) from generate_series(1,20)) where id='${MEETING}';
    insert into meeting_checklist_items (id,church_id,meeting_id,item_name,is_checked,notes) select ('90000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '${PLANT}', '${MEETING}', 'Preparation item',false,repeat('Preparation note ',100) from generate_series(1,20) n;
    update ministry_teams set description=repeat('Ministry description ',100) where id='${TEAM}';
    insert into team_roles (id,church_id,team_id,name,status) select ('90000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'${PLANT}','${TEAM}',repeat('Role name ',20),'open' from generate_series(1,20) n;
    insert into team_responsibilities (id,church_id,team_id,title) select ('90000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'${PLANT}','${TEAM}',repeat('Responsibility ',15) from generate_series(1,20) n;
  `);
    for (const statement of [
      tasksGetManyStatement(
        {
          ids: [TASK],
          sections: ["details", "checklist", "dependencies"],
          relatedLimit: 20,
        },
        PLANT
      ),
      meetingsGetManyStatement(
        {
          ids: [MEETING],
          sections: ["details", "agenda", "checklist", "evaluation"],
          relatedLimit: 20,
        },
        PLANT,
        ZONE
      ),
      teamsGetManyStatement(
        {
          resource: "teams",
          ids: [TEAM],
          sections: [
            "details",
            "roles",
            "roster",
            "responsibilities",
            "requirements",
          ],
          relatedLimit: 20,
        },
        PLANT
      ),
    ]) {
      const result = runSql(statement);
      const artifact = operationsArtifact(
        "Details",
        "/tasks",
        result,
        {},
        NOW,
        ZONE
      );
      assert.equal(artifact.items[0].facts.length, 32);
      assert.equal(artifact.items[0].facts.at(-1)?.label, "Preview coverage");
    }
  }
);
