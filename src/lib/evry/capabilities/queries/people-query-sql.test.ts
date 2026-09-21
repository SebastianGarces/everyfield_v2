import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
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
import { PEOPLE_QUERY_READS, peopleQueryArtifact } from "./people";
import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import {
  personStatuses,
  personSources,
  interviewResults,
  activityTypes,
  attendanceTypes,
  attendanceStatuses,
  responseStatuses,
} from "@/db/schema";

const plant = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const dialect = new PgDialect();

test("person creation timestamp windows preserve exact half-open instants and existing local-date filters", () => {
  const createdWindow = {
    from: "2026-09-01T00:00:00-04:00",
    until: "2026-09-20T16:00:00Z",
  };
  const query = dialect.sqlToQuery(
    buildPeopleQuery(
      plant,
      peopleQuerySchema.parse({
        cohort: { all: { createdWindow } },
        result: { mode: "list" },
      })
    )
  );
  assert.match(
    query.sql,
    /persons\.created_at >= \(\$\d+::timestamptz at time zone 'UTC'\)/
  );
  assert.match(
    query.sql,
    /persons\.created_at < \(\$\d+::timestamptz at time zone 'UTC'\)/
  );
  assert.ok(query.params.includes(createdWindow.from));
  assert.ok(query.params.includes(createdWindow.until));
  assert.doesNotMatch(
    query.sql,
    /persons\.created_at at time zone 'UTC' at time zone/
  );
  const both = dialect.sqlToQuery(
    buildPeopleQuery(
      plant,
      peopleQuerySchema.parse({
        cohort: {
          all: {
            createdWindow,
            created: { from: "2026-09-01", through: "2026-09-20" },
          },
        },
        result: { mode: "count" },
      })
    )
  );
  assert.match(both.sql, /persons\.created_at at time zone 'UTC' at time zone/);
  assert.match(both.sql, /persons\.created_at < \(\$\d+::timestamptz/);
});

test("person timestamp windows reject ambiguous clocks and reversed or empty ranges", () => {
  for (const createdWindow of [
    { from: "2026-09-01T00:00:00", until: "2026-09-20T16:00:00Z" },
    { from: "2026-09-20T16:00:00Z", until: "2026-09-20T16:00:00Z" },
    { from: "2026-09-20T16:00:01Z", until: "2026-09-20T16:00:00Z" },
    {
      from: "2026-09-01T00:00:00Z",
      until: "2026-09-20T16:00:00Z",
      churchId: plant,
    },
  ])
    assert.equal(
      peopleQuerySchema.safeParse({
        cohort: { all: { createdWindow } },
        result: { mode: "list" },
      }).success,
      false
    );
});

test("named core-team reads include advanced Core Group statuses without changing exact stage filters", () => {
  const named = dialect.sqlToQuery(
    buildPeopleQuery(
      plant,
      peopleQuerySchema.parse({
        cohort: { all: { audience: "core_team" } },
        result: { mode: "list" },
      })
    )
  );
  for (const status of ["core_group", "launch_team", "leader"])
    assert.ok(named.params.includes(status));
  assert.match(named.sql, /persons.church_id/);
  assert.match(named.sql, /persons.deleted_at is null/);
  assert.doesNotMatch(named.sql, /from commitments/);
  const exact = dialect.sqlToQuery(
    buildPeopleQuery(
      plant,
      peopleQuerySchema.parse({
        cohort: { all: { stages: ["core_group"] } },
        result: { mode: "list" },
      })
    )
  );
  assert.ok(exact.params.includes("core_group"));
  assert.ok(!exact.params.includes("launch_team"));
  assert.ok(!exact.params.includes("leader"));
  assert.equal(
    peopleQuerySchema.safeParse({
      cohort: { all: { audience: "all_accounts" } },
      result: { mode: "list" },
    }).success,
    false
  );
});

test("named tags remain exact parameterized plant-scoped matches and bulk details include skills", () => {
  const query = dialect.sqlToQuery(
    buildPeopleQuery(
      plant,
      peopleQuerySchema.parse({
        cohort: { all: { tags: { names: ["Worship", "x' OR true --"] } } },
        result: { mode: "list" },
      })
    )
  );
  assert.ok(query.params.includes("worship"));
  assert.ok(query.params.includes("x' or true --"));
  assert.doesNotMatch(query.sql, /OR true --/);
  assert.match(query.sql, /tag.church_id/);
  assert.match(query.sql, /pt.church_id/);
  const details = dialect.sqlToQuery(
    buildPeopleGetManyQuery(
      plant,
      peopleGetManySchema.parse({
        resource: "person",
        ids: [id, plant],
        fields: ["tags", "skills"],
      })
    )
  );
  assert.match(details.sql, /string_agg\(tag.name/);
  assert.match(details.sql, /skills_inventory s where s.church_id/);
  assert.ok(details.params.includes(plant));
  assert.ok(details.params.includes(id));
});

test("every persisted People and attendance enum has a human-facing label", () => {
  for (const [field, values] of [
    ["stage", personStatuses],
    ["source", personSources],
    ["outcome", interviewResults],
    ["outcome", activityTypes],
    ["attendance_type", attendanceTypes],
    ["status", attendanceStatuses],
    ["rsvp", responseStatuses],
  ] as const) {
    for (const value of values) {
      const artifact = peopleQueryArtifact(
        "People",
        {
          total: 1,
          people: 1,
          households: 0,
          without_household: 1,
          rows: [{ id, label: "Ada", [field]: value }],
          groups: [],
          group_total: 0,
          has_more: false,
        },
        "list",
        "people",
        {},
        new Date("2026-09-10T12:00:00Z")
      );
      assert.notEqual(
        artifact.items[0]?.facts[0]?.value,
        value,
        `${field}=${value} must not display the database enum`
      );
    }
  }
});

test("named tag all/none predicates intersect with legacy names and ID filters before pagination", () => {
  const input = peopleQuerySchema.parse({
    cohort: {
      all: {
        tags: {
          any: [id],
          all: [id],
          none: [plant],
          names: ["Worship", "Hospitality"],
          allNames: ["Volunteer", "VOLUNTEER"],
          noneNames: ["Inactive", "x' OR true --"],
        },
      },
    },
    result: { mode: "list", limit: 2 },
  });
  const compiled = dialect.sqlToQuery(buildPeopleQuery(plant, input));
  assert.equal(
    compiled.params.filter((value) => value === "volunteer").length,
    1
  );
  assert.ok(compiled.params.includes("inactive"));
  assert.ok(compiled.params.includes("x' or true --"));
  assert.doesNotMatch(compiled.sql, /OR true --/);
  assert.equal(
    (compiled.sql.match(/not exists \(select 1 from person_tags/g) ?? [])
      .length,
    2
  );
  assert.equal((compiled.sql.match(/lower\(tag.name\)/g) ?? []).length, 3);
  assert.ok(
    compiled.sql.indexOf("not exists") < compiled.sql.indexOf("result_page as")
  );
  for (const key of ["names", "allNames", "noneNames"]) {
    for (const value of [[], [" "], Array(51).fill("tag")])
      assert.equal(
        peopleQuerySchema.safeParse({
          cohort: { all: { tags: { [key]: value } } },
          result: { mode: "count" },
        }).success,
        false
      );
  }
});

test("People public projection uses domain labels and calendar dates without rewriting note text", () => {
  const note = "Keep snake_case and user_first_name exactly as recorded.";
  const artifact = peopleQueryArtifact(
    "Recorded people history",
    {
      total: 1,
      people: 1,
      households: 0,
      without_household: 1,
      rows: [
        {
          id,
          person_id: id,
          author_id: plant,
          label: "Ada",
          stage: "following_up",
          date: "2026-09-10",
          outcome: "qualified_with_notes",
          source: "personal_referral",
          content: note,
          background_check: "in_progress",
        },
      ],
      groups: [],
      group_total: 0,
      has_more: false,
    },
    "list",
    "people",
    {},
    new Date("2026-09-10T03:30:00Z"),
    "America/New_York"
  );
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(artifact));
  const projected = publicEvryArtifact(artifact);
  assert.equal(projected.kind, "read");
  if (projected.kind !== "read") return;
  const facts = projected.items[0]!.facts;
  assert.equal(
    facts.find((fact) => fact.label === "Stage")?.value,
    "Following Up"
  );
  assert.equal(
    facts.find((fact) => fact.label === "Date")?.value,
    "Sep 10, 2026"
  );
  assert.equal(
    facts.find((fact) => fact.label === "Recorded outcome")?.value,
    "Qualified with Notes"
  );
  assert.equal(
    facts.find((fact) => fact.label === "Recorded notes")?.value,
    note
  );
  assert.equal(
    facts.find((fact) => fact.label === "Background check")?.value,
    "In progress"
  );
  assert.ok(
    artifact.items[0]!.facts.some(
      (fact) => fact.label === "author_id" && fact.modelOnly
    )
  );
  assert.ok(
    !facts.some(
      (fact) => fact.label === "author_id" || fact.label === "person_id"
    )
  );
  assert.match(
    projected.filters.find((filter) => filter.label === "Read at")?.value ?? "",
    /September 9, 2026.*11:30 PM EDT/
  );
});

test("stage history has typed previous/new stages and preserves the reason verbatim", () => {
  const content = "Asked for follow_up, not an inferred current_status.";
  const artifact = peopleQueryArtifact(
    "Recorded people history",
    {
      total: 1,
      people: 1,
      households: 0,
      without_household: 1,
      rows: [
        {
          id,
          label: "Alex",
          person_id: id,
          outcome: "status_changed",
          old_stage: "prospect",
          new_stage: "following_up",
          content,
        },
      ],
      groups: [],
      group_total: 0,
      has_more: false,
    },
    "list",
    "people",
    {},
    new Date("2026-09-20T16:00:00Z")
  );
  assert.deepEqual(
    artifact.items[0].facts.filter((f) =>
      ["Previous stage", "New stage", "Change reason"].includes(f.label)
    ),
    [
      { label: "Previous stage", value: "Prospect" },
      { label: "New stage", value: "Following Up" },
      { label: "Change reason", value: content },
    ]
  );
  const query = new PgDialect().sqlToQuery(
    buildPeopleHistoryQuery(
      plant,
      peopleHistoryQuerySchema.parse({
        resource: { kind: "activities" },
        result: { mode: "list" },
      })
    )
  );
  assert.match(query.sql, /jsonb_typeof\(a\.metadata->'reason'\) = 'string'/);
  assert.match(query.sql, /a\.activity_type = 'status_changed'/);
  assert.doesNotMatch(query.sql, /a\.metadata\s+as/);
  for (const value of personStatuses) assert.ok(query.params.includes(value));
});

test("attendance public projection retains the wall-clock date and hides group IDs", () => {
  const base = {
    total: 1,
    people: 1,
    households: 0,
    without_household: 1,
    rows: [
      {
        id,
        person_id: id,
        meeting_id: plant,
        label: "Ada",
        date: "2026-09-10",
        status: "attended",
        attendance_type: "first_time",
        rsvp: "ready_commit",
        content: "not_an_enum",
      },
    ],
    groups: [],
    group_total: 0,
    has_more: false,
  };
  const projected = publicEvryArtifact(
    peopleQueryArtifact(
      "Attendance",
      base,
      "list",
      "attendance",
      {},
      new Date("2026-09-10T12:00:00Z"),
      "America/New_York"
    )
  );
  assert.equal(projected.kind, "read");
  if (projected.kind !== "read") return;
  const facts = projected.items[0]!.facts;
  assert.equal(
    facts.find((fact) => fact.label === "Date")?.value,
    "Sep 10, 2026"
  );
  assert.equal(
    facts.find((fact) => fact.label === "Attendance type")?.value,
    "First-time guest"
  );
  assert.equal(
    facts.find((fact) => fact.label === "RSVP")?.value,
    "Ready to commit"
  );
  assert.equal(
    facts.find((fact) => fact.label === "Recorded notes")?.value,
    "not_an_enum"
  );
  const grouped = peopleQueryArtifact(
    "Attendance",
    {
      ...base,
      rows: [],
      groups: [{ label: `Ada [${id}]`, count: 1, people: 1, households: 0 }],
      group_total: 1,
    },
    "group",
    "attendance",
    { result: { by: "person" } },
    new Date("2026-09-10T12:00:00Z"),
    "America/New_York"
  );
  const publicGroup = publicEvryArtifact(grouped);
  assert.equal(publicGroup.kind, "read");
  if (publicGroup.kind !== "read") return;
  assert.equal(publicGroup.items[0]?.label, "Ada");
  assert.ok(
    !publicGroup.items[0]?.facts.some((fact) => fact.label === "Group key")
  );
});

test("the four advertised tools expose strict, bounded inputs", () => {
  assert.deepEqual(
    PEOPLE_QUERY_READS.map((r) => r.id),
    [
      "people.query",
      "people.get_many",
      "people.history.query",
      "attendance.query",
    ]
  );
  assert.equal(
    peopleQuerySchema.safeParse({
      cohort: {},
      result: { mode: "list" },
      plantId: plant,
    }).success,
    false
  );
  assert.equal(
    peopleQuerySchema.safeParse({
      cohort: { all: { arbitrarySql: "true" } },
      result: { mode: "count" },
    }).success,
    false
  );
  assert.equal(
    peopleGetManySchema.safeParse({ resource: "person", ids: [] }).success,
    false
  );
  assert.equal(
    peopleGetManySchema.safeParse({
      resource: "person",
      ids: Array(51).fill(id),
    }).success,
    false
  );
  assert.equal(
    peopleGetManySchema.safeParse({
      resource: "person",
      ids: [id],
      fields: ["password_hash"],
    }).success,
    false
  );
  assert.equal(
    peopleQuerySchema.safeParse({
      cohort: {
        all: { created: { from: "2026-09-30", through: "2026-09-01" } },
      },
      result: { mode: "count" },
    }).success,
    false
  );
});

test("prospect follow-up without interviews filters the whole cohort before paging", () => {
  const query = dialect.sqlToQuery(
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
  );
  assert.match(query.sql, /not exists \(select 1 from interviews/);
  assert.match(query.sql, /t\.status = 'complete'/);
  assert.match(query.sql, /t\.parent_task_id is null/);
  assert.match(query.sql, /count\(distinct ma\.meeting_id\)/);
  assert.ok(
    query.sql.indexOf("not exists") < query.sql.indexOf("result_page as")
  );
  assert.ok(query.params.filter((p) => p === plant).length >= 4);
  assert.match(query.sql, /persons\.deleted_at is null/);
});

test("tag any/all/none and OR groups are explicit and values are parameters", () => {
  const query = dialect.sqlToQuery(
    buildPeopleQuery(
      plant,
      peopleQuerySchema.parse({
        cohort: {
          all: { tags: { any: [id], all: [id, id], none: [id] } },
          anyOf: [
            { stages: ["prospect"] },
            { search: "Robert'); drop table persons; --" },
          ],
        },
        result: { mode: "count" },
      })
    )
  );
  assert.match(query.sql, /not exists \(select 1 from person_tags/);
  assert.match(query.sql, / or /);
  assert.doesNotMatch(query.sql, /drop table/);
  assert.ok(query.params.includes("%Robert'); drop table persons; --%"));
});

test("history kinds keep their own outcome vocabularies", () => {
  assert.equal(
    peopleHistoryQuerySchema.safeParse({
      resource: { kind: "notes", outcomes: ["pass"] },
      result: { mode: "count" },
    }).success,
    false
  );
  const query = dialect.sqlToQuery(
    buildPeopleHistoryQuery(
      plant,
      peopleHistoryQuerySchema.parse({
        resource: { kind: "interviews" },
        latestPerPerson: true,
        dates: { from: "2026-09-01", through: "2026-09-30" },
        result: { mode: "group", by: "author" },
      })
    )
  );
  assert.match(
    query.sql,
    /row_number\(\) over \(partition by h\.person_id order by h\.date desc, h\.created_at desc, h\.id desc\)/
  );
  assert.match(query.sql, /position = 1/);
  assert.match(
    query.sql,
    /left join users u on u\.id = h\.author_id and u\.church_id =/
  );
  assert.doesNotMatch(query.sql, /persons\.id = h\.author_id/);
});

test("attendance keeps RSVP separate, scopes both relations, and counts distinct people", () => {
  const query = dialect.sqlToQuery(
    buildAttendanceQuery(
      plant,
      attendanceQuerySchema.parse({
        meetingIds: [id],
        statuses: ["absent"],
        rsvp: ["confirmed"],
        responseCard: { existence: "not_recorded" },
        result: { mode: "count" },
      })
    )
  );
  assert.match(query.sql, /ma\.status in/);
  assert.match(query.sql, /ma\.response_status in/);
  assert.match(query.sql, /not exists \(select 1 from meeting_responses/);
  assert.match(query.sql, /count\(distinct person_id\)/);
  assert.match(query.sql, /m\.church_id =/);
  assert.match(query.sql, /ma\.church_id =/);
  assert.match(query.sql, /persons\.church_id =/);
});

test("one and many person reads share tenant scoping and a safe projection", () => {
  const query = dialect.sqlToQuery(
    buildPeopleGetManyQuery(
      plant,
      peopleGetManySchema.parse({ resource: "person", ids: [id] })
    )
  );
  assert.match(query.sql, /persons\.church_id =/);
  assert.match(query.sql, /persons\.deleted_at is null/);
  assert.doesNotMatch(query.sql, /photo_url|user_id|password_hash/);
  assert.match(query.sql, /null::text as notes/);
});

test("exact filtered totals do not become page counts in the artifact", () => {
  const artifact = peopleQueryArtifact(
    "People",
    {
      total: 200,
      people: 200,
      households: 80,
      without_household: 10,
      rows: [{ id, person_id: id, label: "Alex" }],
      groups: [],
      group_total: 0,
      has_more: true,
    },
    "list",
    "people",
    {},
    new Date("2026-09-10T12:00:00Z")
  );
  assert.equal(artifact.counts.matched, 200);
  assert.equal(artifact.counts.returned, 1);
  assert.equal(artifact.counts.excluded, 0);
  assert.equal(artifact.resultMode, "list");
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(artifact));
  assert.equal(
    artifact.filters.find((f) => f.label === "Next page cursor")?.value,
    id
  );
});

test("empty pages retain the database total and unknown is not absence", () => {
  const artifact = peopleQueryArtifact(
    "Attendance",
    {
      total: 22,
      people: 10,
      households: 4,
      without_household: 5,
      rows: [],
      groups: [],
      group_total: 0,
      has_more: false,
    },
    "list",
    "attendance",
    {},
    new Date("2026-09-10T12:00:00Z")
  );
  assert.equal(artifact.counts.matched, 22);
  assert.match(
    artifact.filters.find((f) => f.label === "Evidence limits")?.value ?? "",
    /not proof an event never happened/
  );
});
test("maximum batch IDs and content survive the real stored artifact boundary", () => {
  const artifact = peopleQueryArtifact(
    "People",
    {
      total: 50,
      people: 50,
      households: 0,
      without_household: 50,
      rows: Array.from({ length: 50 }, (_, index) => ({
        id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        label: "Name".repeat(120),
        content: "Recorded note ".repeat(500),
        meeting: "Meeting".repeat(60),
      })),
      groups: [],
      group_total: 0,
      has_more: false,
    },
    "list",
    "people",
    {
      cohort: {
        all: {
          personIds: Array(50).fill(id),
          stages: ["prospect"],
          interview: "not_recorded",
        },
      },
    },
    new Date("2026-09-10T12:00:00Z")
  );
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(artifact));
  assert.match(
    artifact.filters.find((entry) => entry.label === "Criteria")?.value ?? "",
    /50 selected records/
  );
  assert.match(
    artifact.items[0]?.facts.find((entry) => entry.label === "Recorded notes")
      ?.value ?? "",
    /excerpt/
  );
});

test("zero population counts and paged groups retain their declared result semantics", () => {
  const empty = {
    total: 0,
    people: 0,
    households: 0,
    without_household: 0,
    rows: [],
    groups: [],
    group_total: 0,
    has_more: false,
  };
  const count = peopleQueryArtifact(
    "People",
    empty,
    "count",
    "people",
    {},
    new Date("2026-09-10T12:00:00Z")
  );
  assert.equal(count.counts.matched, 0);
  assert.equal(count.counts.returned, 1);
  assert.equal(count.resultMode, "count");
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(count));
  const grouped = peopleQueryArtifact(
    "Attendance",
    {
      ...empty,
      total: 250,
      people: 70,
      group_total: 70,
      group_offset: 0,
      has_more: true,
      groups: Array.from({ length: 50 }, (_, index) => ({
        label: `Person ${index}`,
        count: 2,
        people: 1,
        households: 0,
      })),
    },
    "group",
    "attendance",
    {},
    new Date("2026-09-10T12:00:00Z")
  );
  assert.equal(grouped.counts.matched, 250);
  assert.equal(
    grouped.filters.find((entry) => entry.label === "Next page cursor")?.value,
    "50"
  );
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(grouped));
});
