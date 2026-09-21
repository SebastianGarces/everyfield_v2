import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test, mock } from "node:test";
import { is, sql, type SQL } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import {
  communicationFilteredQuery,
  communicationQuerySchema,
} from "./content-communication";
import {
  generatedDocumentQuery,
  documentQuerySchema,
} from "./content-documents";
import {
  intelligenceFilteredQuery,
  intelligenceQuerySchema,
  launchFilteredQuery,
  launchQuerySchema,
  LAUNCH_QUERY,
} from "./content-platform";
import { projectLaunchStatus } from "./launch-projection";
import { wikiSearchQuery, wikiSearchSchema } from "./content-wiki";
import {
  contentPageQuery,
  contentRange,
  contentWindow,
  runContentQuery,
} from "./content-core";
import { db } from "@/db";
import { getTemplateById } from "@/lib/documents/templates";
import {
  storedEvryReadArtifactDocument,
  hydrateStoredEvryConversationArtifact,
} from "@/lib/evry/conversations/artifacts";
import {
  publicEvryArtifact,
  publicReadArtifactSchema,
} from "@/lib/evry/artifacts/public";

const container = process.env.EVRY_CONTENT_SQL_CONTAINER;
const database = `content_query_proof_${process.pid}`;
const plant = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const account = "20000000-0000-4000-8000-000000000001";
const person = "30000000-0000-4000-8000-000000000001";
const message = "40000000-0000-4000-8000-000000000001";
const dialect = new PgDialect();
function postgres(query: string, name = database) {
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
      name,
    ],
    { input: query, encoding: "utf8" }
  );
}
function literal(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (typeof value !== "string")
    throw new Error("Unsupported fixture parameter");
  return `'${value.replaceAll("'", "''")}'`;
}
function execute(
  statement: SQL,
  timeZone: "UTC" | "America/Los_Angeles" = "UTC"
) {
  const compiled = dialect.sqlToQuery(statement);
  const expanded = compiled.sql.replace(/\$(\d+)/g, (_, n) =>
    literal(compiled.params[Number(n) - 1])
  );
  return JSON.parse(
    postgres(
      `begin; set local time zone ${literal(timeZone)}; select coalesce(json_agg(answer), '[]') from (${expanded}) answer; rollback;`
    )
  );
}
before(() => {
  if (!container) return;
  postgres(`create database ${database};`, "postgres");
  // Real schema column names/types, with constraints omitted for isolated minimal fixtures.
  const seen = new Set<string>();
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    if (seen.has(config.name)) continue;
    seen.add(config.name);
    const columns = config.columns.map((column) => {
      const raw = column.getSQLType();
      const type =
        /^(uuid|text|varchar|char|boolean|integer|smallint|bigint|serial|bigserial|real|double precision|numeric|decimal|jsonb?|date|timestamp|time|bytea|vector)/.test(
          raw
        )
          ? raw
          : raw.endsWith("[]")
            ? "text[]"
            : "text";
      return `"${column.name}" ${type.startsWith("vector") ? "text" : type}`;
    });
    postgres(`create table "${config.name}" (${columns.join(",")});`);
  }
  postgres(`
    insert into users (id,church_id,name) values ('${account}','${plant}','Alex');
    insert into persons (id,church_id,first_name,last_name,email) values ('${person}','${plant}','Alex','Example','alex@example.test');
    insert into communications (id,church_id,subject,body,status,channel,created_at,sent_at) values ('${message}','${plant}','Orientation','Welcome','sent','email','2026-09-09','2026-09-09'), ('${other}','${other}','Foreign','Private','sent','email','2026-09-09','2026-09-09');
    insert into communication_recipients (id,church_id,communication_id,person_id,status,channel) values ('${person}','${plant}','${message}','${person}','failed','email'), ('${message}','${plant}','${message}','${person}','delivered','email');
    insert into generated_documents (id,church_id,user_id,template_id,format,created_at) values ('${message}','${plant}','${account}','commitment-card','pdf','2026-09-10'), ('${other}','${other}','${account}','commitment-card','pdf','2026-09-10');
    insert into wiki_articles (id,church_id,slug,title,content,status,content_type,phase,updated_at) values ('${message}',null,'orientation','Orientation','Orientation with guests','published','guide',2,'2026-09-09'), ('${other}','${other}','private','Orientation','Private orientation','published','guide',2,'2026-09-09');
    insert into launches (id,church_id,status,target_date,updated_at) values ('${message}','${plant}','planning','2026-09-20','2026-09-09');
    insert into launch_milestones (id,church_id,launch_id,title,area,sort_order) values ('${message}','${plant}','${message}','Ready','operations',1);
    insert into launch_milestones (id,church_id,launch_id,title,area,sort_order,completed_at) select gen_random_uuid(),'${plant}','${message}','Milestone ' || n,'operations',n + 1,case when n <= 4 then '2026-09-01'::timestamp else null end from generate_series(1,8) n;
    insert into launch_milestones (id,church_id,launch_id,title,area,sort_order) values (gen_random_uuid(),'${other}','${message}','Foreign','operations',1), (gen_random_uuid(),'${plant}','${other}','Other launch','operations',1);
    insert into tasks(id,church_id,title,status,assigned_to_id,due_date) values ('${message}','${plant}','Prepare launch','not_started','${account}','2026-09-19');
    insert into launch_milestone_tasks(id,church_id,milestone_id,task_id) values ('${message}','${plant}','${message}','${message}');
    insert into tasks(id,church_id,title,status,assigned_to_id,due_date) values ('${person}','${plant}','Completed launch preparation','complete','${account}','2026-09-18');
    insert into launch_milestone_tasks(id,church_id,milestone_id,task_id) values ('${person}','${plant}','${message}','${person}');
    insert into plant_assessments (id,church_id,status,generated_at,phase,rubric_version) values ('${message}','${plant}','complete','2026-09-09',2,'v1'), ('${other}','${other}','complete','2026-09-09',2,'v1');
  `);
});
after(() => {
  if (container) postgres(`drop database if exists ${database};`, "postgres");
});
test(
  "launch task completion is distinct from milestone completion before pagination and aggregation",
  { skip: !container },
  () => {
    for (const mode of ["list", "count", "group"] as const) {
      const run = (taskStatuses?: string[]) =>
        execute(
          contentPageQuery(
            launchFilteredQuery(
              plant,
              "2026-09-10",
              launchQuerySchema.parse({
                resource: "milestone_tasks",
                completion: "open",
                ...(taskStatuses ? { taskStatuses } : {}),
              })
            ),
            mode,
            1,
            0
          )
        )[0];
      assert.equal(
        run().total,
        2,
        "An open milestone includes its completed task unless task status is filtered"
      );
      const open = run(["not_started", "in_progress", "blocked"]);
      assert.equal(open.total, 1);
      if (mode === "list") assert.equal(open.rows[0].facts["Task ID"], message);
      assert.equal(run(["complete"]).total, 1);
    }
    assert.equal(
      LAUNCH_QUERY.inputSchema.safeParse({
        query: {
          resource: "milestones",
          taskStatuses: ["complete"],
        },
      }).success,
      false
    );
  }
);

test(
  "launch status separates future preparation from post-event outcomes without losing recorded values",
  { skip: !container },
  async () => {
    const read = (today: string) =>
      execute(
        contentPageQuery(
          launchFilteredQuery(
            plant,
            today,
            launchQuerySchema.parse({ resource: "status" })
          ),
          "list",
          1,
          0
        )
      )[0].rows[0].facts;
    const future = read("2026-09-10");
    assert.equal(future.Attendance, undefined);
    assert.equal(future.Decisions, undefined);
    assert.equal(future["Outcome notes"], undefined);
    assert.match(future["Launch-day results"], /not preparation requirements/);
    const past = read("2026-09-21");
    assert.equal(
      past.Attendance,
      null,
      "No record after launch is not zero attendance"
    );
    assert.equal(past["Launch-day memories"], null);
    assert.equal(past["Launch-day results"], undefined);
    postgres(
      `update launches set attendance_count=0,capture_the_day='Our launch-day memories' where id='${message}' and church_id='${plant}';`
    );
    try {
      assert.equal(
        read("2026-09-10").Attendance,
        0,
        "A recorded value remains visible even if the target date changes"
      );
      assert.equal(
        read("2026-09-21")["Launch-day memories"],
        "Our launch-day memories"
      );
    } finally {
      postgres(
        `update launches set attendance_count=null,capture_the_day=null where id='${message}' and church_id='${plant}';`
      );
    }
    const reader = mock.method(db, "execute", async (statement: SQL) => ({
      rows: execute(statement),
    }));
    try {
      const artifact = projectLaunchStatus(
        await runContentQuery({
          title: "Launch status",
          href: "/launch",
          filtered: launchFilteredQuery(
            plant,
            "2026-09-10",
            launchQuerySchema.parse({ resource: "status" })
          ),
          mode: "list",
          limit: 1,
          offset: 0,
          now: new Date("2026-09-10T16:00:00Z"),
          timeZone: "America/New_York",
        })
      );
      const visible = publicReadArtifactSchema.parse(
        publicEvryArtifact(artifact)
      );
      assert.deepEqual(visible.items[0].facts.slice(0, 2), [
        { label: "Launch date", value: "Sep 20, 2026" },
        { label: "Milestone progress", value: "4 of 9 complete" },
      ]);
    } finally {
      reader.mock.restore();
    }
  }
);
test(
  "SQL-backed document cards project canonical titles, scoped creator groups and local dates",
  { skip: !container },
  async () => {
    const reader = mock.method(db, "execute", async (statement: SQL) => ({
      rows: execute(statement),
    }));
    try {
      for (const mode of ["list", "group"] as const) {
        const artifact = await runContentQuery({
          title: "Documents",
          href: "/documents",
          filtered: generatedDocumentQuery(
            plant,
            documentQuerySchema.parse({
              resource: "generated",
              mode,
              groupBy: "creator",
            })
          ),
          mode,
          limit: 10,
          offset: 0,
          now: new Date("2026-09-10T00:00:00Z"),
          timeZone: "America/New_York",
        });
        const card = publicReadArtifactSchema.parse(
          publicEvryArtifact(
            hydrateStoredEvryConversationArtifact(
              storedEvryReadArtifactDocument(artifact)
            )
          )
        );
        assert.equal(
          card.items[0]!.label,
          mode === "group" ? "Alex" : getTemplateById("commitment-card")!.name
        );
        assert.ok(
          card.items.every((item) =>
            item.facts.every((fact) => !fact.label.endsWith("ID"))
          )
        );
        if (mode === "list")
          assert.match(
            card.items[0]!.facts.find((fact) => fact.label === "Generated at")!
              .value,
            /September 9, 2026 at 8:00 PM EDT/
          );
        assert.equal(card.counts.matched, 1);
      }
    } finally {
      reader.mock.restore();
    }
  }
);
test(
  "UTC-naive timestamp windows preserve instant and half-open boundaries in non-UTC sessions",
  { skip: !container },
  () => {
    const window = contentWindow.parse({
      from: "2026-09-09T20:00:00-04:00",
      until: "2026-09-09T21:00:00-04:00",
    });
    const statement = sql`select id from (values
    ('before', timestamp '2026-09-09 23:59:59.999999'),
    ('start', timestamp '2026-09-10 00:00:00'),
    ('inside', timestamp '2026-09-10 00:59:59.999999'),
    ('end', timestamp '2026-09-10 01:00:00'),
    ('missing', null::timestamp)
  ) as fixture(id, created_at) where ${contentRange(sql`created_at`, window)} order by id`;
    for (const zone of ["UTC", "America/Los_Angeles"] as const) {
      assert.deepEqual(
        execute(statement, zone),
        [{ id: "inside" }, { id: "start" }],
        zone
      );
      const document = execute(
        contentPageQuery(
          generatedDocumentQuery(
            plant,
            documentQuerySchema.parse({ resource: "generated", window })
          ),
          "list",
          10,
          0
        ),
        zone
      )[0];
      assert.equal(document.total, 1, zone);
      assert.equal(document.rows[0].id, message);
    }
  }
);
test(
  "real PostgreSQL executes every query resource and supported mode",
  { skip: !container },
  () => {
    for (const resource of [
      "messages",
      "recipients",
      "templates",
      "distinct_recipients",
    ] as const) {
      for (const mode of ["list", "count", "group"] as const) {
        if (resource === "distinct_recipients" && mode === "group") continue;
        const result = execute(
          contentPageQuery(
            communicationFilteredQuery(
              plant,
              communicationQuerySchema.parse({ resource, mode })
            ),
            mode,
            1,
            0
          )
        )[0];
        assert.equal(
          result.total,
          resource === "templates" ? 0 : resource === "recipients" ? 2 : 1
        );
      }
    }
    const failed = execute(
      contentPageQuery(
        communicationFilteredQuery(
          plant,
          communicationQuerySchema.parse({
            resource: "messages",
            personIds: [person],
            deliveryStatuses: ["failed"],
          })
        ),
        "list",
        1,
        0
      )
    )[0];
    assert.equal(failed.total, 1);
    assert.equal(failed.rows[0].id, message);
    for (const mode of ["list", "count", "group"] as const) {
      assert.equal(
        execute(
          contentPageQuery(
            generatedDocumentQuery(
              plant,
              documentQuerySchema.parse({
                resource: "generated",
                creatorIds: [account],
                formats: ["pdf"],
              })
            ),
            mode,
            1,
            0
          )
        )[0].total,
        1
      );
      for (const resource of [
        "status",
        "milestones",
        "milestone_tasks",
        "journal",
      ] as const)
        execute(
          contentPageQuery(
            launchFilteredQuery(
              plant,
              "2026-09-10",
              launchQuerySchema.parse({ resource })
            ),
            mode,
            1,
            0
          )
        );
    }
    const launch = execute(
      contentPageQuery(
        launchFilteredQuery(
          plant,
          "2026-09-10",
          launchQuerySchema.parse({ resource: "status" })
        ),
        "list",
        1,
        0
      )
    )[0];
    assert.equal(launch.rows[0].facts["Days until launch"], 10);
    assert.equal(launch.rows[0].facts["Milestones total"], 9);
    assert.equal(launch.rows[0].facts["Milestones complete"], 4);
    assert.equal(launch.rows[0].facts["Milestones remaining"], 5);
    const launchTasks = execute(
      contentPageQuery(
        launchFilteredQuery(
          plant,
          "2026-09-10",
          launchQuerySchema.parse({ resource: "milestone_tasks" })
        ),
        "list",
        10,
        0
      )
    )[0];
    assert.equal(launchTasks.rows.length, 2);
    assert.equal(launchTasks.rows[0].facts.Assigned, true);
    assert.equal(launchTasks.rows[0].facts.Assignee, "Alex");
    assert.equal(launchTasks.rows[0].facts["Due date"], "2026-09-19");
    for (const resource of [
      "assessments",
      "insights",
      "attestations",
      "transitions",
    ] as const)
      execute(
        contentPageQuery(
          intelligenceFilteredQuery(
            plant,
            intelligenceQuerySchema.parse({ resource })
          ),
          "list",
          1,
          0
        )
      );
    const wiki = wikiSearchQuery(
      plant,
      account,
      wikiSearchSchema.parse({
        queries: ["orientation"],
        readingStatuses: ["not_started"],
      }),
      "orientation"
    );
    const rows = execute(sql`${wiki}`);
    assert.equal(rows.length, 1);
    assert.match(rows[0].ts_headline, /Orientation/);
    assert.equal(rows[0].content_type, "guide");
    const exhausted = execute(
      contentPageQuery(
        generatedDocumentQuery(
          plant,
          documentQuerySchema.parse({ resource: "generated" })
        ),
        "list",
        1,
        10
      )
    )[0];
    assert.equal(exhausted.total, 1);
    assert.deepEqual(exhausted.rows, []);
  }
);
