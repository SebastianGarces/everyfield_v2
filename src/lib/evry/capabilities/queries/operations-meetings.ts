import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { meetingTypes, meetingStatuses } from "@/db/schema";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { evryDateRangeSchema } from "@/lib/evry/reads/date-range";
import {
  datePredicate,
  executeOperations,
  fact,
  relatedFact,
  displayLabel,
  facts,
  inValues,
  operationIds,
  operationSearch,
  operationsArtifact,
  operationsMode,
  operationsStatement,
  operationsTimeZone,
  operationsWhere,
  predicateSet,
} from "./operations-core";

const filterSchema = z.strictObject({
  date: evryDateRangeSchema.optional(),
  types: z.array(z.enum(meetingTypes)).min(1).optional(),
  statuses: z.array(z.enum(meetingStatuses)).min(1).optional(),
  teamIds: operationIds.optional(),
  search: operationSearch.optional(),
  location: operationSearch.optional(),
  locationIds: operationIds.optional(),
  checklist: z.enum(["incomplete", "complete", "none"]).optional(),
  evaluated: z.boolean().optional(),
});
export const meetingsQueryShape = {
  where: operationsWhere(filterSchema),
  query: operationsMode(
    ["date", "title"],
    ["type", "status", "team", "date", "month", "location"]
  ),
};

function checklistPredicate(
  plantId: string,
  kind: "incomplete" | "complete" | "none"
) {
  const any = sql`exists (select 1 from meeting_checklist_items c where c.meeting_id = m.id and c.church_id = ${plantId})`;
  const incomplete = sql`exists (select 1 from meeting_checklist_items c where c.meeting_id = m.id and c.church_id = ${plantId} and not c.is_checked)`;
  return kind === "none"
    ? sql`not ${any}`
    : kind === "incomplete"
      ? incomplete
      : sql`${any} and not ${incomplete}`;
}

export function meetingsQueryStatement(
  input: z.infer<z.ZodObject<typeof meetingsQueryShape>>,
  plantId: string,
  now: Date,
  timeZone: string
): SQL {
  const where = predicateSet(input.where, (f) => {
    const clauses: SQL[] = [];
    // Meeting datetime is the stored church wall clock, not a UTC instant.
    if (f.date)
      clauses.push(datePredicate(sql`m.datetime::date`, f.date, now, timeZone));
    if (f.types) clauses.push(inValues(sql`m.type`, f.types));
    if (f.statuses) clauses.push(inValues(sql`m.status`, f.statuses));
    if (f.teamIds) clauses.push(inValues(sql`mt.id::text`, f.teamIds));
    if (f.locationIds) clauses.push(inValues(sql`l.id::text`, f.locationIds));
    if (f.search) clauses.push(sql`m.title ilike ${`%${f.search}%`}`);
    if (f.location)
      clauses.push(
        sql`(coalesce(l.name, m.location_name) ilike ${`%${f.location}%`} or m.location_address ilike ${`%${f.location}%`})`
      );
    if (f.checklist) clauses.push(checklistPredicate(plantId, f.checklist));
    if (f.evaluated !== undefined) {
      const recorded = sql`exists (select 1 from meeting_evaluations e where e.meeting_id = m.id and e.church_id = ${plantId})`;
      clauses.push(f.evaluated ? recorded : sql`not ${recorded}`);
    }
    return clauses.length ? sql`(${sql.join(clauses, sql` and `)})` : sql`true`;
  });
  const source = sql`select m.id::text as id, coalesce(m.title, ${displayLabel(sql`m.type`, "meeting_type")}) as label, '/meetings/' || m.id as href,
    ${facts(fact("When", sql`m.datetime`, { format: "meeting_time" }), fact("Type", sql`m.type`, { format: "meeting_type" }), fact("Status", sql`m.status`, { format: "meeting_status" }), fact("Location", sql`coalesce(l.name, m.location_name)`), fact("Ministry", sql`mt.name`), fact("Actual attendance", sql`m.actual_attendance`), fact("Unchecked preparation items", sql`(select count(*) from meeting_checklist_items c where c.church_id = ${plantId} and c.meeting_id = m.id and not c.is_checked)`))} as facts,
    m.datetime as date, m.title, m.type, m.status, coalesce(mt.name || ' [' || mt.id::text || ']', 'No linked ministry') as team,
    to_char(m.datetime, 'YYYY-MM') as month, coalesce(l.name, m.location_name, 'No location') as location
    from church_meetings m left join ministry_teams mt on mt.id = m.team_id and mt.church_id = ${plantId} left join locations l on l.id = m.location_id and l.church_id = ${plantId}
    where m.church_id = ${plantId} and ${where}`;
  return operationsStatement(
    source,
    input.query,
    {
      type: sql`type`,
      status: sql`status`,
      team: sql`team`,
      date: sql`date::date`,
      month: sql`month`,
      location: sql`location`,
    },
    { date: sql`date`, title: sql`title` },
    {
      type: "meeting_type",
      status: "meeting_status",
      team: "record_label",
      date: "calendar",
      month: "month",
    }
  );
}

const getShape = {
  ids: operationIds,
  sections: z
    .array(z.enum(["details", "agenda", "checklist", "evaluation"]))
    .min(1)
    .default(["details"]),
  relatedLimit: z.number().int().min(1).max(20).default(10),
};
export function meetingsGetManyStatement(
  input: z.infer<z.ZodObject<typeof getShape>>,
  plantId: string,
  _timeZone: string
) {
  const detail = [
    fact("When", sql`m.datetime`, { format: "meeting_time" }),
    fact("Status", sql`m.status`, { format: "meeting_status" }),
    fact("Location", sql`coalesce(l.name, m.location_name)`),
    fact("Address", sql`m.location_address`),
    fact("Duration in minutes", sql`m.duration_minutes`),
  ];
  if (input.sections.includes("details"))
    detail.push(
      fact("Notes", sql`m.notes`),
      fact("Actual attendance", sql`m.actual_attendance`),
      fact("Expected attendance", sql`m.estimated_attendance`)
    );
  let evidence = facts(...detail);
  if (input.sections.includes("agenda")) {
    const agenda = sql`case when jsonb_typeof(m.agenda) = 'array' then m.agenda else '[]'::jsonb end`;
    evidence = sql`${evidence} || ${facts(fact("Agenda total", sql`jsonb_array_length(${agenda})`), fact("Agenda coverage", sql`case when m.agenda is null then 'No agenda recorded' when jsonb_typeof(m.agenda) <> 'array' then 'Stored agenda format is not readable' else 'Requested first items; see agenda total' end`))} || coalesce((select jsonb_agg(${fact("Agenda item", sql`coalesce(entry ->> 'title', entry ->> 'name', entry ->> 'topic', 'Untitled agenda item') || coalesce(': ' || (entry ->> 'description'), '')`)} order by ordinal) from (select entry, ordinal from jsonb_array_elements(${agenda}) with ordinality as a(entry, ordinal) limit ${input.relatedLimit}) a), '[]'::jsonb)`;
  }
  if (input.sections.includes("checklist"))
    evidence = sql`${evidence} || ${facts(fact("Checklist total", sql`(select count(*) from meeting_checklist_items c where c.church_id = ${plantId} and c.meeting_id = m.id)`))} || coalesce((select jsonb_agg(${relatedFact("Preparation item", sql`c.item_name || ' · ' || case when c.is_checked then 'Complete' else 'Incomplete' end || coalesce(' · ' || c.notes, '')`, sql`c.item_name || ' [' || c.id || ']'`)} order by c.id) from (select c.id, c.item_name, c.is_checked, c.notes from meeting_checklist_items c where c.church_id = ${plantId} and c.meeting_id = m.id order by c.id limit ${input.relatedLimit}) c), '[]'::jsonb)`;
  if (input.sections.includes("evaluation"))
    evidence = sql`${evidence} || ${facts(fact("Evaluation score", sql`e.total_score`), fact("Evaluation notes", sql`e.notes`), fact("Evaluated at", sql`e.created_at`, { format: "instant" }))}`;
  const source = sql`select m.id::text as id, coalesce(m.title, ${displayLabel(sql`m.type`, "meeting_type")}) as label, '/meetings/' || m.id as href, ${evidence} || ${facts(fact("Related evidence limit per section", sql`${input.relatedLimit}::int`))} as facts from church_meetings m left join locations l on l.id = m.location_id and l.church_id = ${plantId} left join meeting_evaluations e on e.meeting_id = m.id and e.church_id = ${plantId} where m.church_id = ${plantId} and ${inValues(sql`m.id::text`, input.ids)}`;
  return operationsStatement(
    source,
    { mode: "list", limit: 50, sort: "id", direction: "asc" },
    {},
    { id: sql`id` }
  );
}

export const MEETING_QUERY_READS = [
  defineEvryReadRegistration({
    id: "meetings.query",
    capabilityIdentity: "meetings.read.list",
    inputShape: meetingsQueryShape,
    async run({ authorization, now = new Date() }, input) {
      const zone = await operationsTimeZone(authorization.actor.plantId);
      return operationsArtifact(
        "Meetings",
        "/meetings",
        await executeOperations(
          meetingsQueryStatement(input, authorization.actor.plantId, now, zone)
        ),
        input,
        now,
        zone,
        undefined,
        input.query.mode
      );
    },
  }),
  defineEvryReadRegistration({
    id: "meetings.get_many",
    capabilityIdentity: "meetings.read.detail",
    inputShape: getShape,
    async run({ authorization, now = new Date() }, input) {
      const zone = await operationsTimeZone(authorization.actor.plantId);
      return operationsArtifact(
        "Meetings",
        "/meetings",
        await executeOperations(
          meetingsGetManyStatement(input, authorization.actor.plantId, zone)
        ),
        input,
        now,
        zone,
        input.ids
      );
    },
  }),
] as const;
