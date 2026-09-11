import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  notificationCategories,
  notificationEntityTypes,
  phaseTransitionKinds,
} from "@/db/schema";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { readEvryPlantTimeZone } from "@/lib/evry/reads/plant-time-zone";
import { toCalendarDate } from "@/lib/datetime";
import { MANUAL_SIGNALS } from "@/lib/phase-engine/manual-signals";
import { LAUNCH_MILESTONE_AREA_LABELS } from "@/lib/launch/milestone-areas";
import {
  notificationViewer,
  dbNotificationFeedDeps,
} from "@/lib/notifications/feed";
import { feedScopedWhere, feedVisibility } from "@/lib/notifications/queries";
import {
  PEOPLE_FILE_READ_IDENTITIES,
  readPeopleImportPreviewArtifact,
} from "../people/file-reads";
import { EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH } from "../people/attachment-contract";
import {
  contentPage,
  contentMode,
  contentWindow,
  contentRange,
  contentIds,
  contentIn,
  runContentQuery,
} from "./content-core";

export const launchQuerySchema = z.strictObject({
  resource: z.enum(["status", "milestones", "milestone_tasks", "journal"]),
  mode: contentMode,
  ...contentPage,
  completion: z.enum(["any", "complete", "open"]).default("any"),
  area: z.enum(["operations", "launch_team", "promotion"]).optional(),
  milestoneIds: contentIds.optional(),
  taskIds: contentIds.optional(),
  window: contentWindow.optional(),
  blockedByOverdueTask: z.boolean().default(false),
  groupBy: z.enum(["status", "area"]).default("status"),
});
export function launchFilteredQuery(
  plantId: string,
  today: string,
  input: z.infer<typeof launchQuerySchema>
) {
  const source = launchSourceQuery(plantId, today, input);
  if (input.mode !== "group") return source;
  const groupLabel =
    input.groupBy === "area"
      ? sql`case f.group_key ${sql.join(
          Object.entries(LAUNCH_MILESTONE_AREA_LABELS).map(
            ([key, label]) => sql`when ${key} then ${label}`
          ),
          sql` `
        )} else 'Area unavailable' end`
      : sql`upper(left(replace(f.group_key, '_', ' '), 1)) || substring(replace(f.group_key, '_', ' ') from 2)`;
  return sql`select f.*, ${groupLabel} as group_label from (${source}) f`;
}
function launchSourceQuery(
  plantId: string,
  today: string,
  input: z.infer<typeof launchQuerySchema>
) {
  if (input.resource === "status")
    return sql`select id::text as id, 'Launch Sunday'::text as label, jsonb_build_object('Status', status, 'Launch date', target_date, 'Days until launch', target_date - ${today}::date, 'Attendance', attendance_count, 'Decisions', decisions_count, 'Outcome recorded at', outcome_recorded_at, 'Outcome notes', outcome_notes, 'Capture the day', capture_the_day) as facts, '/launch'::text as href, status::text as group_key, updated_at::text as sort_key from launches where church_id = ${plantId}`;
  if (input.resource === "journal")
    return sql`select id::text as id, event as label, jsonb_build_object('Previous date', previous_target_date, 'Date', target_date, 'Previous status', previous_status, 'Status', status, 'Note', note, 'Recorded at', created_at) as facts, '/launch'::text as href, status::text as group_key, created_at::text as sort_key from launch_events where church_id = ${plantId} and ${contentRange(sql`created_at`, input.window)}`;
  const complete =
    input.completion === "complete"
      ? sql`m.completed_at is not null`
      : input.completion === "open"
        ? sql`m.completed_at is null`
        : sql`true`;
  const blocked = sql`exists (select 1 from launch_milestone_tasks link join tasks t on t.id = link.task_id and t.church_id = ${plantId} and t.deleted_at is null join task_dependencies dep on dep.task_id = t.id and dep.church_id = ${plantId} join tasks prerequisite on prerequisite.id = dep.prerequisite_task_id and prerequisite.church_id = ${plantId} and prerequisite.deleted_at is null where link.church_id = ${plantId} and link.milestone_id = m.id and t.status <> 'complete' and prerequisite.status <> 'complete' and prerequisite.due_date < ${today}::date)`;
  const filter = sql`m.church_id = ${plantId} and ${complete} and ${input.area ? sql`m.area = ${input.area}` : sql`true`} and ${contentIn(sql`m.id`, input.milestoneIds)} and ${contentRange(sql`m.completed_at`, input.window)} and ${input.blockedByOverdueTask ? blocked : sql`true`}`;
  if (input.resource === "milestone_tasks")
    return sql`select link.id::text as id, t.title as label, jsonb_build_object('Task ID', t.id, 'Milestone ID', m.id, 'Milestone', m.title, 'Status', t.status, 'Due date', t.due_date, 'Assignee account ID', t.assigned_to_id) as facts, '/tasks/' || t.id as href, ${input.groupBy === "area" ? sql`m.area` : sql`t.status`}::text as group_key, coalesce(t.due_date::text, '') as sort_key from launch_milestones m join launch_milestone_tasks link on link.milestone_id = m.id and link.church_id = ${plantId} join tasks t on t.id = link.task_id and t.church_id = ${plantId} and t.deleted_at is null where ${filter} and ${contentIn(sql`t.id`, input.taskIds)}`;
  return sql`select m.id::text as id, m.title as label, jsonb_build_object('Area', m.area, 'Description', m.description, 'Completed at', m.completed_at, 'Blocked by overdue prerequisite', ${blocked}, 'Linked tasks', (select count(*)::int from launch_milestone_tasks link join tasks t on t.id = link.task_id and t.church_id = ${plantId} and t.deleted_at is null where link.church_id = ${plantId} and link.milestone_id = m.id)) as facts, '/launch'::text as href, ${input.groupBy === "area" ? sql`m.area` : sql`case when m.completed_at is null then 'Open' else 'Complete' end`} as group_key, m.sort_order::text as sort_key from launch_milestones m where ${filter} and ${input.taskIds ? sql`exists (select 1 from launch_milestone_tasks link where link.church_id = ${plantId} and link.milestone_id = m.id and ${contentIn(sql`link.task_id`, input.taskIds)})` : sql`true`}`;
}
export const LAUNCH_QUERY = defineEvryReadRegistration({
  id: "launch.query",
  capabilityIdentity: "launch.read.readiness",
  inputShape: {
    query: launchQuerySchema.superRefine((v, ctx) => {
      if (
        (v.resource === "status" || v.resource === "journal") &&
        (v.area ||
          v.milestoneIds ||
          v.taskIds ||
          v.blockedByOverdueTask ||
          v.completion !== "any" ||
          v.groupBy === "area" ||
          (v.resource === "status" && v.window))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Milestone filters apply only to milestones and linked tasks; status is a current snapshot",
        });
    }),
  },
  async run({ authorization, now }, { query: input }) {
    const instant = now ?? new Date();
    const zone = await readEvryPlantTimeZone(authorization.actor.plantId);
    return runContentQuery({
      title: `Launch ${input.resource.replaceAll("_", " ")}`,
      href: "/launch",
      filtered: launchFilteredQuery(
        authorization.actor.plantId,
        toCalendarDate(instant, input.resource === "status" ? "UTC" : zone),
        input
      ),
      mode: input.mode,
      limit: input.limit,
      offset: input.offset,
      now: instant,
      timeZone: zone,
      notes: [
        "Current milestones are not historical readiness snapshots. The journal records date/status events only. Team coverage must be read through teams.query; no milestone-to-team relationship is recorded.",
      ],
    });
  },
});

export const intelligenceQuerySchema = z.strictObject({
  resource: z.enum(["assessments", "insights", "attestations", "transitions"]),
  ...contentPage,
  assessmentIds: contentIds.optional(),
  window: contentWindow.optional(),
  transitionKind: z.enum(phaseTransitionKinds).optional(),
  category: z.string().min(1).max(100).optional(),
  includeFactSnapshot: z.boolean().default(false),
});
export function intelligenceFilteredQuery(
  plantId: string,
  input: z.infer<typeof intelligenceQuerySchema>
) {
  const source = intelligenceSourceQuery(plantId, input);
  if (input.resource !== "attestations" && input.resource !== "transitions")
    return source;
  const label =
    input.resource === "attestations"
      ? sql`case f.label ${sql.join(
          MANUAL_SIGNALS.map(
            (signal) => sql`when ${signal.key} then ${signal.label}`
          ),
          sql` `
        )} else 'Recorded attestation' end`
      : sql`case f.label when 'initial_declaration' then 'Initial phase declaration' else 'Phase transition' end`;
  return sql`select f.id, ${label} as label, f.facts, f.href, f.group_key, f.sort_key from (${source}) f`;
}
function intelligenceSourceQuery(
  plantId: string,
  input: z.infer<typeof intelligenceQuerySchema>
) {
  if (input.resource === "assessments")
    return sql`select id::text as id, 'Stored assessment'::text as label, jsonb_build_object('Generated at', generated_at, 'Phase', phase, 'Rubric version', rubric_version, 'Status', status, 'Fact snapshot', ${input.includeFactSnapshot ? sql`fact_snapshot` : sql`null`}, 'Snapshot note', ${input.includeFactSnapshot ? "Stored report-time facts, which can differ from current records" : "Request includeFactSnapshot to read the stored evidence"}) as facts, '/phase'::text as href, status::text as group_key, generated_at::text as sort_key from plant_assessments where church_id = ${plantId} and status = 'complete' and ${contentIn(sql`id`, input.assessmentIds)} and ${contentRange(sql`generated_at`, input.window)}`;
  if (input.resource === "insights")
    return sql`select i.id::text as id, i.title as label, jsonb_build_object('Assessment ID', a.id, 'Generated at', a.generated_at, 'Rubric version', a.rubric_version, 'Category', i.category, 'Severity', i.severity, 'Stored finding', i.body, 'Cited facts', i.cited_facts) as facts, '/phase'::text as href, i.category::text as group_key, a.generated_at::text || ':' || (10000 - i.rank)::text as sort_key from plant_insights i join plant_assessments a on a.id = i.assessment_id and a.church_id = ${plantId} and a.status = 'complete' where i.church_id = ${plantId} and i.audience = 'planter' and ${contentIn(sql`a.id`, input.assessmentIds)} and ${contentRange(sql`a.generated_at`, input.window)} and ${input.category ? sql`i.category = ${input.category}` : sql`true`}`;
  if (input.resource === "attestations")
    return sql`select id::text as id, signal_key as label, jsonb_build_object('Evidence kind', 'Self-attested, not independently measured', 'Value', value, 'Attested at', attested_at) as facts, '/phase'::text as href, signal_key::text as group_key, attested_at::text as sort_key from plant_signals where church_id = ${plantId} and ${contentRange(sql`attested_at`, input.window)}`;
  return sql`select id::text as id, kind as label, jsonb_build_object('From phase', from_phase, 'To phase', to_phase, 'Kind', kind, 'Reason', reason, 'Recorded at', created_at, 'Rubric version', rubric_version) as facts, '/phase'::text as href, kind::text as group_key, created_at::text as sort_key from phase_transitions where church_id = ${plantId} and ${input.transitionKind ? sql`kind = ${input.transitionKind}` : sql`true`} and ${contentRange(sql`created_at`, input.window)}`;
}
export const INTELLIGENCE_QUERY = defineEvryReadRegistration({
  id: "intelligence.query",
  capabilityIdentity: "plant-intelligence.assessments.read",
  inputShape: {
    query: intelligenceQuerySchema.superRefine((v, ctx) => {
      if (
        (v.assessmentIds &&
          v.resource !== "assessments" &&
          v.resource !== "insights") ||
        (v.transitionKind && v.resource !== "transitions") ||
        (v.category && v.resource !== "insights") ||
        (v.includeFactSnapshot && v.resource !== "assessments")
      )
        ctx.addIssue({
          code: "custom",
          message:
            "The selected filter does not apply to this evidence resource",
        });
    }),
  },
  async run({ authorization, now }, { query: input }) {
    return runContentQuery({
      title: `Stored Plant Intelligence ${input.resource}`,
      href: "/phase",
      filtered: intelligenceFilteredQuery(authorization.actor.plantId, input),
      mode: "list",
      limit: input.limit,
      offset: input.offset,
      now: now ?? new Date(),
      timeZone: await readEvryPlantTimeZone(authorization.actor.plantId),
      notes: [
        "Attribute findings to the stored report and date. Missing evidence is not zero; incompatible rubric versions must not be treated as directly comparable. This read generates no new health judgment.",
      ],
    });
  },
});

export const notificationQuerySchema = z.strictObject({
  mode: contentMode,
  ...contentPage,
  unreadOnly: z.boolean().default(false),
  categories: z.array(z.enum(notificationCategories)).min(1).optional(),
  window: contentWindow.optional(),
  entityType: z.enum(notificationEntityTypes).optional(),
  entityIds: contentIds.optional(),
  groupBy: z
    .enum(["category", "read_status", "entity_type"])
    .default("category"),
});
export const NOTIFICATIONS_QUERY = defineEvryReadRegistration({
  id: "notifications.query",
  capabilityIdentity: "notifications.feed.list",
  inputShape: notificationQuerySchema.shape,
  async run({ authorization, now }, input) {
    const actor = authorization.actor;
    const instant = now ?? new Date();
    const viewer = notificationViewer({
      user: {
        id: actor.userId,
        churchId: actor.plantId,
        sendingChurchId: null,
        sendingNetworkId: null,
      },
    });
    if (!viewer) throw new Error("Notification viewer unavailable");
    const categories = await dbNotificationFeedDeps.inAppCategories(viewer);
    const visible = feedScopedWhere(
      viewer.scope,
      ...feedVisibility(instant, categories)
    );
    const group = {
      category: sql`category`,
      read_status: sql`case when read_at is null then 'Unread' else 'Read' end`,
      entity_type: sql`entity_type`,
    }[input.groupBy];
    const filtered = sql`select id::text as id, title as label, jsonb_build_object('Message', body, 'Category', category, 'Received', created_at, 'Read at', read_at, 'Source type', entity_type, 'Source ID', entity_id) as facts, '/notifications'::text as href, ${group} as group_key, created_at::text as sort_key from notifications where ${visible} and ${input.unreadOnly ? sql`read_at is null` : sql`true`} and ${contentIn(sql`category`, input.categories)} and ${contentRange(sql`created_at`, input.window)} and ${input.entityType ? sql`entity_type = ${input.entityType}` : sql`true`} and ${contentIn(sql`entity_id`, input.entityIds)}`;
    return runContentQuery({
      title: input.unreadOnly ? "Unread notifications" : "Notifications",
      href: "/notifications",
      filtered,
      mode: input.mode,
      limit: input.limit,
      offset: input.offset,
      now: instant,
      timeZone: await readEvryPlantTimeZone(actor.plantId),
    });
  },
});

export const FILES_INSPECT = defineEvryReadRegistration({
  id: "files.inspect",
  capabilityIdentity: PEOPLE_FILE_READ_IDENTITIES.preview,
  inputShape: {
    attachmentReference: z
      .string()
      .min(1)
      .max(EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH),
    attachmentDigest: z.string().regex(/^[0-9a-f]{64}$/),
  },
  run: ({ authorization }, input) =>
    readPeopleImportPreviewArtifact({ actor: authorization.actor, ...input }),
});
