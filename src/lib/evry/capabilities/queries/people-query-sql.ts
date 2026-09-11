import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  personStatuses,
  personSources,
  interviewResults,
  commitmentTypes,
  activityTypes,
  skillCategories,
} from "@/db/schema/people";
import {
  meetingTypes,
  attendanceStatuses,
  attendanceTypes,
  responseStatuses,
  responseCardTypes,
} from "@/db/schema/meetings";
import { peopleTextSearch } from "@/lib/people/service";

const ids = z.array(z.string().uuid()).min(1).max(50);
const dateRange = z
  .strictObject({
    from: z.iso.date().optional(),
    through: z.iso.date().optional(),
  })
  .refine(
    (v) => !v.from || !v.through || v.from <= v.through,
    "Date range must be ordered"
  );
const existence = z.enum(["recorded", "not_recorded"]);
const attendanceCondition = z
  .strictObject({
    minimumMeetings: z.number().int().min(0).max(10000).optional(),
    maximumMeetings: z.number().int().min(0).max(10000).optional(),
    meetingIds: ids.optional(),
    meetingTypes: z.array(z.enum(meetingTypes)).min(1).max(3).optional(),
    dates: dateRange.optional(),
  })
  .refine(
    (v) =>
      v.minimumMeetings === undefined ||
      v.maximumMeetings === undefined ||
      v.minimumMeetings <= v.maximumMeetings,
    "Attendance range must be ordered"
  );

/** One conjunction. anyOf below is an explicit OR of these bounded groups. */
const peopleCondition = z.strictObject({
  search: z.string().trim().min(1).max(160).optional(),
  personIds: ids.optional(),
  stages: z
    .array(z.enum(personStatuses))
    .min(1)
    .max(personStatuses.length)
    .optional(),
  sources: z
    .array(z.enum(personSources))
    .min(1)
    .max(personSources.length)
    .optional(),
  tags: z
    .strictObject({
      any: ids.optional(),
      all: ids.optional(),
      none: ids.optional(),
    })
    .optional(),
  created: dateRange.optional(),
  householdIds: ids.optional(),
  household: z.enum(["assigned", "unassigned"]).optional(),
  hasEmail: z.boolean().optional(),
  skill: z
    .strictObject({
      search: z.string().trim().min(1).max(100).optional(),
      categories: z
        .array(z.enum(skillCategories))
        .min(1)
        .max(skillCategories.length)
        .optional(),
    })
    .optional(),
  interview: existence.optional(),
  assessment: existence.optional(),
  commitment: z
    .strictObject({
      existence,
      types: z.array(z.enum(commitmentTypes)).min(1).max(2).optional(),
    })
    .optional(),
  followUp: existence
    .optional()
    .describe(
      "Recorded means a completed, non-deleted top-level follow-up task linked to this person. It is not inferred from a stage, invitation or free-text note."
    ),
  attendance: attendanceCondition.optional(),
  membership: z.strictObject({ existence, teamIds: ids.optional() }).optional(),
});

export const peopleCohortSchema = z.strictObject({
  all: peopleCondition.optional(),
  anyOf: z.array(peopleCondition).min(1).max(5).optional(),
});
export type PeopleCohort = z.infer<typeof peopleCohortSchema>;
const pageShape = {
  limit: z.number().int().min(1).max(50).default(20),
  afterId: z.string().uuid().optional(),
};
const groupPageShape = {
  offset: z
    .number()
    .int()
    .nonnegative()
    .max(100000)
    .default(0)
    .describe(
      "Use the returned next page cursor to load the next group page with the same filters."
    ),
};
export const peopleQuerySchema = z.strictObject({
  cohort: peopleCohortSchema.default({}),
  result: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("list"), ...pageShape }),
    z.strictObject({ mode: z.literal("count") }),
    z.strictObject({
      mode: z.literal("group"),
      by: z.enum(["stage", "source", "household"]),
      ...groupPageShape,
    }),
  ]),
});
export const peopleGetManySchema = z.strictObject({
  resource: z.enum(["person", "household"]),
  ids,
  fields: z
    .array(
      z.enum(["contact", "stage", "household", "background_check", "notes"])
    )
    .max(5)
    .default(["contact", "stage", "household"]),
});

const historyResourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("interviews"),
    outcomes: z
      .array(z.enum(interviewResults))
      .min(1)
      .max(interviewResults.length)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("assessments"),
    maximumScore: z.number().int().min(0).max(100).optional(),
  }),
  z.strictObject({
    kind: z.literal("commitments"),
    types: z.array(z.enum(commitmentTypes)).min(1).max(2).optional(),
  }),
  z.strictObject({ kind: z.literal("notes") }),
  z.strictObject({
    kind: z.literal("activities"),
    types: z
      .array(z.enum(activityTypes))
      .min(1)
      .max(activityTypes.length)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("follow_up"),
    state: z.enum(["open", "completed", "any"]).default("completed"),
  }),
]);
export const peopleHistoryQuerySchema = z.strictObject({
  resource: historyResourceSchema,
  cohort: peopleCohortSchema.default({}),
  dates: dateRange.optional(),
  authorIds: ids
    .optional()
    .describe(
      "Account IDs, not person IDs. Returned author labels are already resolved."
    ),
  text: z.string().trim().min(1).max(160).optional(),
  latestPerPerson: z
    .boolean()
    .default(false)
    .describe(
      "Latest matching record for each person, ordered by record date, creation time and ID."
    ),
  result: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("list"), ...pageShape }),
    z.strictObject({ mode: z.literal("count") }),
    z.strictObject({
      mode: z.literal("group"),
      by: z.enum(["person", "author", "outcome", "date"]),
      ...groupPageShape,
    }),
  ]),
});
export const attendanceQuerySchema = z.strictObject({
  cohort: peopleCohortSchema.default({}),
  meetingIds: ids.optional(),
  meetingTypes: z.array(z.enum(meetingTypes)).min(1).max(3).optional(),
  dates: dateRange.optional(),
  statuses: z.array(z.enum(attendanceStatuses)).min(1).max(3).optional(),
  attendanceTypes: z.array(z.enum(attendanceTypes)).min(1).max(3).optional(),
  rsvp: z
    .array(z.enum(responseStatuses))
    .min(1)
    .max(responseStatuses.length)
    .optional(),
  responseCard: z
    .strictObject({
      existence,
      types: z
        .array(z.enum(responseCardTypes))
        .min(1)
        .max(responseCardTypes.length)
        .optional(),
    })
    .optional(),
  result: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("list"), ...pageShape }),
    z.strictObject({ mode: z.literal("count") }),
    z.strictObject({
      mode: z.literal("group"),
      by: z.enum(["person", "meeting", "status", "rsvp", "attendance_type"]),
      ...groupPageShape,
    }),
  ]),
});

function joined(conditions: SQL[], separator = " and "): SQL {
  return conditions.length
    ? sql`(${sql.join(conditions, sql.raw(separator))})`
    : sql`true`;
}
function inValues(column: SQL, values: readonly string[]): SQL {
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )})`;
}
function dateConditions(column: SQL, range?: z.infer<typeof dateRange>): SQL[] {
  return [
    ...(range?.from ? [sql`${column} >= ${range.from}::date`] : []),
    ...(range?.through ? [sql`${column} <= ${range.through}::date`] : []),
  ];
}
function localDate(column: SQL, plantId: string): SQL {
  // Existing timestamp columns store UTC without a zone. Zone is server-owned.
  return sql`(${column} at time zone 'UTC' at time zone (select time_zone from churches where id = ${plantId}::uuid))::date`;
}
function existencePredicate(query: SQL, mode: z.infer<typeof existence>): SQL {
  return mode === "recorded"
    ? sql`exists (${query})`
    : sql`not exists (${query})`;
}
function completedFollowUp(plantId: string): SQL {
  return sql`select 1 from tasks t where t.church_id = ${plantId}::uuid and t.related_type = 'person' and t.related_id = persons.id and t.category = 'follow_up' and t.status = 'complete' and t.deleted_at is null and t.parent_task_id is null`;
}
function conditionSql(
  plantId: string,
  condition: z.infer<typeof peopleCondition>
): SQL {
  const clauses: SQL[] = [];
  if (condition.search) {
    const search = peopleTextSearch(condition.search);
    if (search) clauses.push(search);
  }
  if (condition.personIds)
    clauses.push(inValues(sql`persons.id`, condition.personIds));
  if (condition.stages)
    clauses.push(inValues(sql`persons.status`, condition.stages));
  if (condition.sources)
    clauses.push(inValues(sql`persons.source`, condition.sources));
  if (condition.householdIds)
    clauses.push(inValues(sql`persons.household_id`, condition.householdIds));
  if (condition.household)
    clauses.push(
      condition.household === "assigned"
        ? sql`persons.household_id is not null`
        : sql`persons.household_id is null`
    );
  if (condition.hasEmail !== undefined)
    clauses.push(
      condition.hasEmail
        ? sql`nullif(trim(persons.email), '') is not null`
        : sql`nullif(trim(persons.email), '') is null`
    );
  clauses.push(
    ...dateConditions(
      localDate(sql`persons.created_at`, plantId),
      condition.created
    )
  );
  if (condition.tags) {
    const tagExists = (values: string[]) =>
      sql`select 1 from person_tags pt join tags tag on tag.id = pt.tag_id and tag.church_id = ${plantId}::uuid where pt.church_id = ${plantId}::uuid and pt.person_id = persons.id and ${inValues(sql`pt.tag_id`, values)}`;
    if (condition.tags.any)
      clauses.push(sql`exists (${tagExists(condition.tags.any)})`);
    if (condition.tags.none)
      clauses.push(sql`not exists (${tagExists(condition.tags.none)})`);
    for (const id of new Set(condition.tags.all))
      clauses.push(sql`exists (${tagExists([id])})`);
  }
  if (condition.skill) {
    clauses.push(
      sql`exists (select 1 from skills_inventory s where s.church_id = ${plantId}::uuid and s.person_id = persons.id and ${joined(
        [
          ...(condition.skill.search
            ? [sql`s.skill_name ilike ${`%${condition.skill.search}%`}`]
            : []),
          ...(condition.skill.categories
            ? [inValues(sql`s.skill_category`, condition.skill.categories)]
            : []),
        ]
      )})`
    );
  }
  if (condition.interview)
    clauses.push(
      existencePredicate(
        sql`select 1 from interviews i where i.church_id = ${plantId}::uuid and i.person_id = persons.id`,
        condition.interview
      )
    );
  if (condition.assessment)
    clauses.push(
      existencePredicate(
        sql`select 1 from assessments a where a.church_id = ${plantId}::uuid and a.person_id = persons.id`,
        condition.assessment
      )
    );
  if (condition.commitment)
    clauses.push(
      existencePredicate(
        sql`select 1 from commitments c where c.church_id = ${plantId}::uuid and c.person_id = persons.id and ${condition.commitment.types ? inValues(sql`c.commitment_type`, condition.commitment.types) : sql`true`}`,
        condition.commitment.existence
      )
    );
  if (condition.followUp)
    clauses.push(
      existencePredicate(completedFollowUp(plantId), condition.followUp)
    );
  if (condition.membership)
    clauses.push(
      existencePredicate(
        sql`select 1 from team_memberships tm join ministry_teams mt on mt.id = tm.team_id and mt.church_id = ${plantId}::uuid where tm.church_id = ${plantId}::uuid and tm.person_id = persons.id and tm.status = 'active' and ${condition.membership.teamIds ? inValues(sql`tm.team_id`, condition.membership.teamIds) : sql`true`}`,
        condition.membership.existence
      )
    );
  if (condition.attendance) {
    const filter = condition.attendance;
    const count = sql`(select count(distinct ma.meeting_id) from meeting_attendance ma join church_meetings m on m.id = ma.meeting_id and m.church_id = ${plantId}::uuid where ma.church_id = ${plantId}::uuid and ma.person_id = persons.id and ma.status = 'attended' and ${joined(
      [
        ...(filter.meetingIds ? [inValues(sql`m.id`, filter.meetingIds)] : []),
        ...(filter.meetingTypes
          ? [inValues(sql`m.type`, filter.meetingTypes)]
          : []),
        ...dateConditions(sql`m.datetime::date`, filter.dates),
      ]
    )})`;
    if (filter.minimumMeetings !== undefined)
      clauses.push(sql`${count} >= ${filter.minimumMeetings}`);
    if (filter.maximumMeetings !== undefined)
      clauses.push(sql`${count} <= ${filter.maximumMeetings}`);
    if (
      filter.minimumMeetings === undefined &&
      filter.maximumMeetings === undefined
    )
      clauses.push(sql`${count} > 0`);
  }
  return joined(clauses);
}
export function peopleCohortSql(plantId: string, cohort: PeopleCohort): SQL {
  return joined([
    sql`persons.church_id = ${plantId}::uuid`,
    sql`persons.deleted_at is null`,
    ...(cohort.all ? [conditionSql(plantId, cohort.all)] : []),
    ...(cohort.anyOf
      ? [
          joined(
            cohort.anyOf.map((part) => conditionSql(plantId, part)),
            " or "
          ),
        ]
      : []),
  ]);
}

type ResultMode =
  | { mode: "list"; limit: number; afterId?: string }
  | { mode: "count" }
  | { mode: "group"; by: string; offset: number };

/** One statement gives the total and page the same database snapshot. */
function queryResult(
  base: SQL,
  result: ResultMode,
  groupExpression?: SQL
): SQL {
  const groups =
    result.mode === "group" && groupExpression
      ? sql`select ${groupExpression} as label, count(*)::int as count, count(distinct person_id)::int as people, count(distinct household_id)::int as households from filtered group by ${groupExpression}`
      : sql`select ''::text as label, 0::int as count, 0::int as people, 0::int as households where false`;
  const page =
    result.mode === "list"
      ? sql`select * from filtered where ${result.afterId ? sql`id > ${result.afterId}::uuid` : sql`true`} order by id limit ${result.limit}`
      : sql`select * from filtered where false`;
  return sql`with filtered as (${base}), result_groups as (${groups}), result_page as (${page}) select
    (select count(*)::int from filtered) as total,
    (select count(distinct person_id)::int from filtered) as people,
    (select count(distinct household_id)::int from filtered) as households,
    (select count(*)::int from filtered where household_id is null) as without_household,
    coalesce((select jsonb_agg(to_jsonb(result_page) order by id) from result_page), '[]'::jsonb) as rows,
    coalesce((select jsonb_agg(to_jsonb(g) order by label) from (select * from result_groups order by label limit 50 offset ${result.mode === "group" ? result.offset : 0}) g), '[]'::jsonb) as groups,
    ${result.mode === "group" ? result.offset : 0}::int as group_offset,
    (select count(*)::int from result_groups) as group_total,
    ${result.mode === "list" ? sql`exists (select 1 from filtered where id > (select max(id::text)::uuid from result_page))` : result.mode === "group" ? sql`(select count(*) from result_groups) > ${result.offset + 50}` : sql`false`} as has_more`;
}

export function buildPeopleQuery(
  plantId: string,
  input: z.infer<typeof peopleQuerySchema>
): SQL {
  const base = sql`select persons.id, persons.id as person_id, persons.household_id, h.name as household, concat_ws(' ', persons.first_name, persons.last_name) as label, persons.status as stage, persons.source, persons.email, persons.phone from persons left join households h on h.id = persons.household_id and h.church_id = ${plantId}::uuid where ${peopleCohortSql(plantId, input.cohort)}`;
  const group =
    input.result.mode === "group"
      ? {
          stage: sql`coalesce(stage, 'Unknown')`,
          source: sql`coalesce(source, 'Unknown')`,
          household: sql`case when household_id is null then 'No household' else concat(coalesce(household, 'Unavailable household'), ' [', household_id, ']') end`,
        }[input.result.by]
      : undefined;
  return queryResult(base, input.result, group);
}

export function buildPeopleGetManyQuery(
  plantId: string,
  input: z.infer<typeof peopleGetManySchema>
): SQL {
  const fields = new Set(input.fields);
  if (input.resource === "household")
    return sql`select h.id, h.name as label, ${fields.has("contact") ? sql`concat_ws(', ', h.address_line1, h.address_line2, h.city, h.state, h.postal_code)` : sql`null::text`} as address,
    (select count(*)::int from persons where persons.church_id = ${plantId}::uuid and persons.household_id = h.id and persons.deleted_at is null) as members
    from households h where h.church_id = ${plantId}::uuid and ${inValues(sql`h.id`, input.ids)} order by h.id`;
  return sql`select persons.id, concat_ws(' ', persons.first_name, persons.last_name) as label,
    ${fields.has("contact") ? sql`persons.email` : sql`null::text`} as email,
    ${fields.has("contact") ? sql`persons.phone` : sql`null::text`} as phone,
    ${fields.has("stage") ? sql`persons.status` : sql`null::text`} as stage,
    ${fields.has("household") ? sql`h.name` : sql`null::text`} as household,
    ${fields.has("background_check") ? sql`persons.background_check_status` : sql`null::text`} as background_check,
    ${fields.has("notes") ? sql`left(persons.notes, 2000)` : sql`null::text`} as notes
    from persons left join households h on h.id = persons.household_id and h.church_id = ${plantId}::uuid
    where ${peopleCohortSql(plantId, { all: { personIds: input.ids } })} order by persons.id`;
}

function historySource(
  plantId: string,
  resource: z.infer<typeof historyResourceSchema>
): SQL {
  switch (resource.kind) {
    case "interviews":
      return sql`select i.id, i.person_id, i.interviewed_by as author_id, i.interview_date as date, i.created_at, i.overall_result::text as outcome, concat_ws(E'\n', concat('Maturity: ', i.maturity_status, '. ', i.maturity_notes), concat('Gifted: ', i.gifted_status, '. ', i.gifted_notes), concat('Chemistry: ', i.chemistry_status, '. ', i.chemistry_notes), concat('Right reasons: ', i.right_reasons_status, '. ', i.right_reasons_notes), concat('Season: ', i.season_status, '. ', i.season_notes), i.next_steps) as content from interviews i where i.church_id = ${plantId}::uuid and ${resource.outcomes ? inValues(sql`i.overall_result`, resource.outcomes) : sql`true`}`;
    case "assessments":
      return sql`select a.id, a.person_id, a.assessed_by as author_id, a.assessment_date as date, a.created_at, a.total_score::text as outcome, concat_ws(E'\n', concat('Committed: ', a.committed_score, '. ', a.committed_notes), concat('Compelled: ', a.compelled_score, '. ', a.compelled_notes), concat('Contagious: ', a.contagious_score, '. ', a.contagious_notes), concat('Courageous: ', a.courageous_score, '. ', a.courageous_notes)) as content from assessments a where a.church_id = ${plantId}::uuid and ${resource.maximumScore === undefined ? sql`true` : sql`a.total_score <= ${resource.maximumScore}`}`;
    case "commitments":
      return sql`select c.id, c.person_id, c.witnessed_by as author_id, c.signed_date as date, c.created_at, c.commitment_type::text as outcome, c.notes as content from commitments c where c.church_id = ${plantId}::uuid and ${resource.types ? inValues(sql`c.commitment_type`, resource.types) : sql`true`}`;
    case "notes":
      return sql`select a.id, a.person_id, a.performed_by as author_id, ${localDate(sql`a.created_at`, plantId)} as date, a.created_at, a.activity_type::text as outcome, a.metadata->>'note' as content from person_activities a where a.church_id = ${plantId}::uuid and a.activity_type = 'note_added'`;
    case "activities":
      return sql`select a.id, a.person_id, a.performed_by as author_id, ${localDate(sql`a.created_at`, plantId)} as date, a.created_at, a.activity_type::text as outcome, coalesce(a.metadata->>'note', a.metadata->>'description') as content from person_activities a where a.church_id = ${plantId}::uuid and ${resource.types ? inValues(sql`a.activity_type`, resource.types) : sql`true`}`;
    case "follow_up":
      return sql`select t.id, t.related_id as person_id, coalesce(t.completed_by_id, t.assigned_to_id) as author_id, ${localDate(sql`coalesce(t.completed_at, t.created_at)`, plantId)} as date, t.created_at, t.status::text as outcome, concat_ws(E'\n', t.title, t.description) as content from tasks t where t.church_id = ${plantId}::uuid and t.related_type = 'person' and t.category = 'follow_up' and t.deleted_at is null and t.parent_task_id is null and ${resource.state === "completed" ? sql`t.status = 'complete'` : resource.state === "open" ? sql`t.status <> 'complete'` : sql`true`}`;
  }
}
export function buildPeopleHistoryQuery(
  plantId: string,
  input: z.infer<typeof peopleHistoryQuerySchema>
): SQL {
  const source = historySource(plantId, input.resource);
  const conditions = joined([
    peopleCohortSql(plantId, input.cohort),
    ...dateConditions(sql`h.date`, input.dates),
    ...(input.authorIds ? [inValues(sql`h.author_id`, input.authorIds)] : []),
    ...(input.text ? [sql`h.content ilike ${`%${input.text}%`}`] : []),
  ]);
  const base = sql`select id, person_id, household_id, label, author_id, author, date, outcome, left(content, 2000) as content from (
    select h.*, persons.household_id, concat_ws(' ', persons.first_name, persons.last_name) as label,
    coalesce(u.name, 'Unknown author') as author,
    row_number() over (partition by h.person_id order by h.date desc, h.created_at desc, h.id desc) as position
    from (${source}) h join persons on persons.id = h.person_id
    left join users u on u.id = h.author_id and u.church_id = ${plantId}::uuid
    where ${conditions}
  ) ranked where ${input.latestPerPerson ? sql`position = 1` : sql`true`}`;
  const group =
    input.result.mode === "group"
      ? {
          person: sql`concat(label, ' [', person_id, ']')`,
          author: sql`concat(author, ' [', coalesce(author_id::text, 'unknown'), ']')`,
          outcome: sql`coalesce(outcome, 'Unknown')`,
          date: sql`date::text`,
        }[input.result.by]
      : undefined;
  return queryResult(base, input.result, group);
}

export function buildAttendanceQuery(
  plantId: string,
  input: z.infer<typeof attendanceQuerySchema>
): SQL {
  const card = input.responseCard;
  const base = sql`select ma.id, ma.person_id, persons.household_id, concat_ws(' ', persons.first_name, persons.last_name) as label,
    m.id as meeting_id, coalesce(m.title, 'Untitled meeting') as meeting, m.datetime::date as date, ma.status, ma.attendance_type, ma.response_status as rsvp,
    left(ma.notes, 2000) as content, rc.response_type as response_card, left(rc.notes, 2000) as response_notes,
    exists (${completedFollowUp(plantId)}) as person_follow_up_recorded
    from meeting_attendance ma
    join persons on persons.id = ma.person_id
    join church_meetings m on m.id = ma.meeting_id and m.church_id = ${plantId}::uuid
    left join meeting_responses rc on rc.meeting_id = ma.meeting_id and rc.person_id = ma.person_id and rc.church_id = ${plantId}::uuid
    where ${joined([
      sql`ma.church_id = ${plantId}::uuid`,
      peopleCohortSql(plantId, input.cohort),
      ...(input.meetingIds ? [inValues(sql`m.id`, input.meetingIds)] : []),
      ...(input.meetingTypes
        ? [inValues(sql`m.type`, input.meetingTypes)]
        : []),
      ...dateConditions(sql`m.datetime::date`, input.dates),
      ...(input.statuses ? [inValues(sql`ma.status`, input.statuses)] : []),
      ...(input.attendanceTypes
        ? [inValues(sql`ma.attendance_type`, input.attendanceTypes)]
        : []),
      ...(input.rsvp ? [inValues(sql`ma.response_status`, input.rsvp)] : []),
      ...(card
        ? [
            existencePredicate(
              sql`select 1 from meeting_responses r where r.church_id = ${plantId}::uuid and r.meeting_id = ma.meeting_id and r.person_id = ma.person_id and ${card.types ? inValues(sql`r.response_type`, card.types) : sql`true`}`,
              card.existence
            ),
          ]
        : []),
    ])}`;
  const group =
    input.result.mode === "group"
      ? {
          person: sql`concat(label, ' [', person_id, ']')`,
          meeting: sql`concat(meeting, ' [', meeting_id, ']')`,
          status: sql`status`,
          rsvp: sql`coalesce(rsvp, 'No RSVP recorded')`,
          attendance_type: sql`coalesce(attendance_type, 'Unknown')`,
        }[input.result.by]
      : undefined;
  return queryResult(base, input.result, group);
}
