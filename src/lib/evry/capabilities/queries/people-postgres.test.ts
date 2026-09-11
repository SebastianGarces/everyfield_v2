import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import {
  churches,
  persons,
  households,
  interviews,
  assessments,
  commitments,
  personActivities,
  tasks,
  tags,
  personTags,
  skillsInventory,
  teamMemberships,
  ministryTeams,
  churchMeetings,
  meetingAttendance,
  meetingResponses,
  users,
} from "@/db/schema";
import type { SQL } from "drizzle-orm";
import { z } from "zod";
import {
  peopleQuerySchema,
  peopleGetManySchema,
  peopleHistoryQuerySchema,
  attendanceQuerySchema,
  buildPeopleQuery,
  buildPeopleGetManyQuery,
  buildPeopleHistoryQuery,
  buildAttendanceQuery,
} from "./people-query-sql";

// Opt-in, isolated Docker fixture. No DATABASE_URL is used for this test.
const container = process.env.EVRY_PEOPLE_PROOF_CONTAINER;
const enabled = container === "evry-758-people-query-proof";
const plant = "10000000-0000-4000-8000-000000000001";
const person = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const foreign = "10000000-0000-4000-8000-000000000002";
// Read proof uses the actual schema's column names and SQL types. Constraints
// are intentionally absent so corrupt cross-tenant relation fixtures can test
// the readers' application-level isolation, which must hold without RLS.
const fixtureSchema = [
  churches,
  persons,
  households,
  interviews,
  assessments,
  commitments,
  personActivities,
  tasks,
  tags,
  personTags,
  skillsInventory,
  teamMemberships,
  ministryTeams,
  churchMeetings,
  meetingAttendance,
  meetingResponses,
  users,
]
  .map((table) => {
    const config = getTableConfig(table);
    return `create temp table "${config.name}" (${config.columns.map((column) => `"${column.name}" ${column.getSQLType()}`).join(",")});`;
  })
  .join("\n");
const fixture = `
${fixtureSchema}
insert into churches (id,time_zone) values ('${plant}', 'America/New_York'), ('${foreign}', 'UTC');
insert into persons (id,church_id,first_name,last_name,email,phone,status,source,household_id,created_at,deleted_at,background_check_status,notes) select ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '${plant}', 'Person', n::text, null, null, 'prospect', 'other', null, '2026-09-01 03:59:59'::timestamp, null, 'not_started', null from generate_series(1,70) n;
insert into persons (id,church_id,first_name,last_name,email,phone,status,source,household_id,created_at,deleted_at,background_check_status,notes) values ('${person(71)}', '${foreign}', 'Foreign', 'Person', null,null,'prospect',null,null,now(),null,'not_started',null);
update persons set deleted_at=now() where id='${person(70)}';
update persons set created_at='2026-09-01 04:00:00' where id='${person(40)}';
insert into interviews (id, church_id, person_id, interviewed_by, interview_date, created_at, overall_result) values ('${person(81)}','${plant}','${person(41)}','${person(91)}','2026-09-01','2026-09-01','qualified'), ('${person(82)}','${plant}','${person(41)}','${person(91)}','2026-09-02','2026-09-02','qualified'), ('${person(83)}','${foreign}','${person(40)}',null,'2026-09-01','2026-09-01','qualified');
insert into tasks (id,church_id,related_id,related_type,category,status,created_at) values ('${person(84)}','${plant}','${person(40)}','person','follow_up','complete',now()), ('${person(85)}','${plant}','${person(41)}','person','follow_up','complete',now()), ('${person(86)}','${plant}','${person(42)}','person','follow_up','not_started',now());
insert into tags (id,church_id) values ('${person(92)}','${plant}'), ('${person(93)}','${plant}');
insert into person_tags (church_id,person_id,tag_id) values ('${plant}','${person(40)}','${person(92)}'), ('${plant}','${person(40)}','${person(93)}'), ('${plant}','${person(41)}','${person(92)}');
insert into church_meetings (id,church_id,title,datetime,type) values ('${person(95)}','${plant}','First meeting','2026-09-01 00:30:00','vision_meeting'), ('${person(96)}','${plant}','Orientation','2026-09-02 18:00:00','orientation');
insert into meeting_attendance (id,church_id,meeting_id,person_id,status,attendance_type,response_status,notes) values ('${person(87)}','${plant}','${person(95)}','${person(40)}','attended','first_time','confirmed',null), ('${person(88)}','${plant}','${person(96)}','${person(40)}','attended','returning',null,null), ('${person(89)}','${plant}','${person(95)}','${person(42)}','absent',null,'confirmed',null);
insert into users (id,church_id,name) values ('${person(91)}','${plant}','Interviewer');
`;
const scalar = (value: unknown): string =>
  typeof value === "number"
    ? String(value)
    : typeof value === "boolean"
      ? value
        ? "true"
        : "false"
      : value === null
        ? "null"
        : `'${String(value).replaceAll("'", "''")}'`;
function execute(query: SQL): unknown[] {
  assert.ok(
    enabled && container,
    "Only the explicitly disposable proof container may be used"
  );
  const compiled = new PgDialect().sqlToQuery(query);
  const output = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "people_query_proof",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `begin; ${fixture} prepare proof_query as select row_to_json(proof_result) from (${compiled.sql}) proof_result; execute proof_query(${compiled.params.map(scalar).join(",")}); rollback;`,
      encoding: "utf8",
    }
  );
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const resultSchema = z.object({
  total: z.number(),
  people: z.number(),
  rows: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()),
  has_more: z.boolean(),
  groups: z.array(
    z.object({ label: z.string(), count: z.number() }).passthrough()
  ),
});

test(
  "Postgres filters a cohort beyond the first 24 records and ignores foreign interview evidence",
  { skip: !enabled },
  () => {
    const result = resultSchema.parse(
      execute(
        buildPeopleQuery(
          plant,
          peopleQuerySchema.parse({
            cohort: {
              all: {
                stages: ["prospect"],
                followUp: "recorded",
                interview: "not_recorded",
                attendance: { minimumMeetings: 2 },
              },
            },
            result: { mode: "list", limit: 5 },
          })
        )
      )[0]
    );
    assert.equal(result.total, 1);
    assert.equal(result.rows[0]?.id, person(40));
  }
);
test(
  "Postgres counts the full cohort and pages without duplicates",
  { skip: !enabled },
  () => {
    const result = resultSchema.parse(
      execute(
        buildPeopleQuery(
          plant,
          peopleQuerySchema.parse({
            result: { mode: "list", limit: 5, afterId: person(5) },
          })
        )
      )[0]
    );
    assert.equal(result.total, 69);
    assert.equal(result.rows.length, 5);
    assert.equal(result.rows[0]?.id, person(6));
    assert.equal(result.has_more, true);
  }
);
test("Postgres AND/OR tags do not duplicate people", { skip: !enabled }, () => {
  const result = resultSchema.parse(
    execute(
      buildPeopleQuery(
        plant,
        peopleQuerySchema.parse({
          cohort: {
            all: {
              tags: { any: [person(92), person(93)], none: [person(93)] },
            },
          },
          result: { mode: "list" },
        })
      )
    )[0]
  );
  assert.equal(result.total, 1);
  assert.equal(result.rows[0]?.id, person(41));
});
test(
  "Postgres midnight boundaries use the plant's calendar day",
  { skip: !enabled },
  () => {
    const result = resultSchema.parse(
      execute(
        buildPeopleQuery(
          plant,
          peopleQuerySchema.parse({
            cohort: {
              all: { created: { from: "2026-09-01", through: "2026-09-01" } },
            },
            result: { mode: "list" },
          })
        )
      )[0]
    );
    assert.equal(result.total, 1);
    assert.equal(result.rows[0]?.id, person(40));
  }
);
test(
  "Postgres latest history deduplicates records before aggregates",
  { skip: !enabled },
  () => {
    const result = resultSchema.parse(
      execute(
        buildPeopleHistoryQuery(
          plant,
          peopleHistoryQuerySchema.parse({
            resource: { kind: "interviews" },
            latestPerPerson: true,
            result: { mode: "group", by: "author" },
          })
        )
      )[0]
    );
    assert.equal(result.total, 1);
    assert.equal(result.people, 1);
    assert.equal(result.groups[0]?.count, 1);
    assert.match(result.groups[0]?.label ?? "", /Interviewer/);
  }
);
test(
  "Postgres RSVP is not attendance, and repeat attendance counts people once",
  { skip: !enabled },
  () => {
    const attended = resultSchema.parse(
      execute(
        buildAttendanceQuery(
          plant,
          attendanceQuerySchema.parse({
            statuses: ["attended"],
            result: { mode: "count" },
          })
        )
      )[0]
    );
    assert.equal(attended.total, 2);
    assert.equal(attended.people, 1);
    const absent = resultSchema.parse(
      execute(
        buildAttendanceQuery(
          plant,
          attendanceQuerySchema.parse({
            statuses: ["absent"],
            rsvp: ["confirmed"],
            result: { mode: "list" },
          })
        )
      )[0]
    );
    assert.equal(absent.total, 1);
    assert.equal(absent.rows[0]?.label, "Person 42");
  }
);
test(
  "Postgres batch lookup omits foreign and nonexistent IDs equally",
  { skip: !enabled },
  () => {
    const rows = execute(
      buildPeopleGetManyQuery(
        plant,
        peopleGetManySchema.parse({
          resource: "person",
          ids: [person(40), person(71), person(999)],
        })
      )
    );
    assert.equal(rows.length, 1);
    assert.equal(z.object({ id: z.string() }).parse(rows[0]).id, person(40));
  }
);
test(
  "Postgres meeting midnight retains its stored local day, unlike created_at instants",
  { skip: !enabled },
  () => {
    const result = resultSchema.parse(
      execute(
        buildAttendanceQuery(
          plant,
          attendanceQuerySchema.parse({
            dates: { from: "2026-09-01", through: "2026-09-01" },
            statuses: ["attended"],
            result: { mode: "list" },
          })
        )
      )[0]
    );
    assert.equal(result.total, 1);
    assert.equal(result.rows[0]?.label, "Person 40");
    const cohort = resultSchema.parse(
      execute(
        buildPeopleQuery(
          plant,
          peopleQuerySchema.parse({
            cohort: {
              all: {
                attendance: {
                  minimumMeetings: 1,
                  dates: { from: "2026-09-01", through: "2026-09-01" },
                },
              },
            },
            result: { mode: "list" },
          })
        )
      )[0]
    );
    assert.equal(cohort.total, 1);
    assert.equal(cohort.rows[0]?.id, person(40));
  }
);

test(
  "Postgres resolves every history resource and aggregate dimension against actual schema columns",
  { skip: !enabled },
  () => {
    for (const kind of [
      "interviews",
      "assessments",
      "commitments",
      "notes",
      "activities",
      "follow_up",
    ] as const) {
      for (const by of ["person", "author", "outcome", "date"] as const) {
        const result = resultSchema.parse(
          execute(
            buildPeopleHistoryQuery(
              plant,
              peopleHistoryQuerySchema.parse({
                resource: { kind },
                result: { mode: "group", by },
              })
            )
          )[0]
        );
        assert.equal(
          result.total,
          kind === "interviews" || kind === "follow_up" ? 2 : 0,
          `${kind}/${by}`
        );
      }
    }
  }
);

test(
  "Postgres resolves every attendance and people aggregate dimension",
  { skip: !enabled },
  () => {
    for (const by of [
      "person",
      "meeting",
      "status",
      "rsvp",
      "attendance_type",
    ] as const) {
      const result = resultSchema.parse(
        execute(
          buildAttendanceQuery(
            plant,
            attendanceQuerySchema.parse({ result: { mode: "group", by } })
          )
        )[0]
      );
      assert.equal(result.total, 3, by);
      assert.equal(
        result.groups.reduce((total, row) => total + row.count, 0),
        3,
        by
      );
    }
    for (const by of ["stage", "source", "household"] as const) {
      const result = resultSchema.parse(
        execute(
          buildPeopleQuery(
            plant,
            peopleQuerySchema.parse({ result: { mode: "group", by } })
          )
        )[0]
      );
      assert.equal(result.total, 69, by);
      assert.equal(
        result.groups.reduce((total, row) => total + row.count, 0),
        69,
        by
      );
    }
  }
);

test(
  "Postgres group pages preserve exact full-population totals",
  { skip: !enabled },
  () => {
    const first = resultSchema.parse(
      execute(
        buildAttendanceQuery(
          plant,
          attendanceQuerySchema.parse({
            result: { mode: "group", by: "person" },
          })
        )
      )[0]
    );
    const second = resultSchema.parse(
      execute(
        buildAttendanceQuery(
          plant,
          attendanceQuerySchema.parse({
            result: { mode: "group", by: "person", offset: 1 },
          })
        )
      )[0]
    );
    assert.equal(second.total, first.total);
    assert.deepEqual(second.groups, first.groups.slice(1));
    assert.equal(second.has_more, false);
  }
);

test(
  "Postgres household batch lookup uses authorized schema fields",
  { skip: !enabled },
  () => {
    assert.deepEqual(
      execute(
        buildPeopleGetManyQuery(
          plant,
          peopleGetManySchema.parse({
            resource: "household",
            ids: [person(40)],
            fields: ["contact", "notes"],
          })
        )
      ),
      []
    );
  }
);
