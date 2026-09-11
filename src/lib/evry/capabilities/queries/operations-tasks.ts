import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { taskStatuses, taskPriorities, taskCategories } from "@/db/schema";
import { toCalendarDate } from "@/lib/datetime";
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
  operationPage,
  operationSearch,
  operationsArtifact,
  operationsMode,
  operationsStatement,
  operationsTimeZone,
  operationsWhere,
  predicateSet,
} from "./operations-core";

const taskFilter = z.strictObject({
  search: operationSearch.optional(),
  status: z.array(z.enum(taskStatuses)).min(1).optional(),
  priority: z.array(z.enum(taskPriorities)).min(1).optional(),
  category: z.array(z.enum(taskCategories)).min(1).optional(),
  assignment: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("mine") }),
      z.strictObject({ kind: z.literal("unassigned") }),
      z.strictObject({ kind: z.literal("accounts"), ids: operationIds }),
      z.strictObject({ kind: z.literal("people"), ids: operationIds }),
    ])
    .optional(),
  due: z
    .union([
      evryDateRangeSchema,
      z.strictObject({ kind: z.literal("undated") }),
    ])
    .optional(),
  completed: evryDateRangeSchema.optional(),
  linked: z
    .strictObject({
      kind: z.enum(["person", "meeting", "team"]),
      ids: operationIds,
    })
    .optional(),
  incompletePrerequisites: z.boolean().optional(),
  launchMilestone: z.boolean().optional(),
  parentIds: operationIds.optional(),
});

export const tasksQueryShape = {
  where: operationsWhere(taskFilter),
  resource: z.enum(["tasks", "checklist", "all"]).default("tasks"),
  query: operationsMode(
    ["due", "title", "priority", "completed"],
    ["status", "priority", "category", "assignee", "team", "due_bucket"]
  ),
};

function incompleteDependencies(plantId: string): SQL {
  return sql`exists (select 1 from task_dependencies dep join tasks prerequisite on prerequisite.id = dep.prerequisite_task_id and prerequisite.church_id = ${plantId} and prerequisite.deleted_at is null where dep.church_id = ${plantId} and dep.task_id = t.id and prerequisite.status <> 'complete')`;
}

export function tasksQueryStatement(
  input: z.infer<z.ZodObject<typeof tasksQueryShape>>,
  plantId: string,
  accountId: string,
  now: Date,
  timeZone: string
): SQL {
  const where = predicateSet(input.where, (f) => {
    const clauses: SQL[] = [];
    if (f.search)
      clauses.push(
        sql`(t.title ilike ${`%${f.search}%`} or t.description ilike ${`%${f.search}%`})`
      );
    if (f.status) clauses.push(inValues(sql`t.status`, f.status));
    if (f.priority) clauses.push(inValues(sql`t.priority`, f.priority));
    if (f.category) clauses.push(inValues(sql`t.category`, f.category));
    if (f.assignment?.kind === "mine")
      clauses.push(sql`t.assigned_to_id = ${accountId}`);
    if (f.assignment?.kind === "unassigned")
      clauses.push(sql`t.assigned_to_id is null`);
    if (f.assignment?.kind === "accounts")
      clauses.push(inValues(sql`a.id::text`, f.assignment.ids));
    if (f.assignment?.kind === "people")
      clauses.push(
        sql`exists (select 1 from persons p where p.church_id = ${plantId} and p.deleted_at is null and p.user_id = a.id and ${inValues(sql`p.id::text`, f.assignment.ids)})`
      );
    if (f.due?.kind === "undated") clauses.push(sql`t.due_date is null`);
    else if (f.due) {
      clauses.push(datePredicate(sql`t.due_date`, f.due, now, timeZone));
      if (f.due.kind === "relative" && f.due.period === "overdue")
        clauses.push(sql`t.status <> 'complete'`);
    }
    if (f.completed)
      clauses.push(
        datePredicate(
          sql`(t.completed_at at time zone 'UTC' at time zone ${timeZone})::date`,
          f.completed,
          now,
          timeZone
        )
      );
    if (f.linked)
      clauses.push(
        inValues(
          f.linked.kind === "person"
            ? sql`linked_person.id::text`
            : f.linked.kind === "meeting"
              ? sql`linked_meeting.id::text`
              : sql`mt.id::text`,
          f.linked.ids
        )
      );
    if (f.incompletePrerequisites !== undefined)
      clauses.push(
        f.incompletePrerequisites
          ? incompleteDependencies(plantId)
          : sql`not ${incompleteDependencies(plantId)}`
      );
    if (f.launchMilestone !== undefined) {
      const linked = sql`exists (select 1 from launch_milestone_tasks lm where lm.church_id = ${plantId} and lm.task_id = t.id)`;
      clauses.push(f.launchMilestone ? linked : sql`not ${linked}`);
    }
    if (f.parentIds)
      clauses.push(
        sql`exists (select 1 from tasks parent where parent.id=t.parent_task_id and parent.church_id=${plantId} and parent.deleted_at is null and ${inValues(sql`parent.id::text`, f.parentIds)})`
      );
    return clauses.length ? sql`(${sql.join(clauses, sql` and `)})` : sql`true`;
  });
  const today = toCalendarDate(now, timeZone);
  const source = sql`select t.id::text as id, t.title as label, '/tasks/' || t.id as href,
    ${facts(fact("Status", sql`t.status`, { format: "task_status" }), fact("Priority", sql`t.priority`, { format: "priority" }), fact("Due date", sql`t.due_date`, { format: "calendar" }), fact("Assignee", sql`case when t.assigned_to_id is null then 'Unassigned' else coalesce(a.name, 'Unavailable account') end`), fact("Assignee account ID", sql`a.id`, { modelOnly: true }), fact("Category", sql`t.category`, { format: "category" }), relatedFact("Related record", sql`coalesce(linked_person.first_name || ' ' || linked_person.last_name, linked_meeting.title, mt.name)`, sql`coalesce(linked_person.first_name || ' ' || linked_person.last_name || ' [' || linked_person.id || ']', linked_meeting.title || ' [' || linked_meeting.id || ']', mt.name || ' [' || mt.id || ']')`), fact("Blocked by incomplete prerequisites", incompleteDependencies(plantId), { format: "boolean" }))} as facts,
    t.due_date as due, t.title, t.priority, t.completed_at as completed, t.status, t.category,
    coalesce(a.name || ' [' || a.id::text || ']', case when t.assigned_to_id is null then 'Unassigned' else 'Unavailable account' end) as assignee,
    coalesce(mt.name || ' [' || mt.id::text || ']', 'No linked ministry') as team,
    case when t.status = 'complete' then 'Completed' when t.due_date is null then 'Undated' when t.due_date < ${today}::date then 'Overdue' when t.due_date = ${today}::date then 'Today' else 'Later' end as due_bucket
    from tasks t left join users a on a.id = t.assigned_to_id and a.church_id = ${plantId} and a.sending_church_id is null and a.sending_network_id is null
    left join ministry_teams mt on t.related_type = 'team' and t.related_id = mt.id and mt.church_id = ${plantId}
    left join persons linked_person on t.related_type = 'person' and t.related_id = linked_person.id and linked_person.church_id = ${plantId} and linked_person.deleted_at is null
    left join church_meetings linked_meeting on t.related_type = 'meeting' and t.related_id = linked_meeting.id and linked_meeting.church_id = ${plantId}
    where t.church_id = ${plantId} and t.deleted_at is null and ${input.resource === "tasks" ? sql`t.parent_task_id is null` : input.resource === "checklist" ? sql`t.parent_task_id is not null` : sql`true`} and ${where}`;
  return operationsStatement(
    source,
    input.query,
    {
      status: sql`status`,
      priority: sql`priority`,
      category: sql`category`,
      assignee: sql`assignee`,
      team: sql`team`,
      due_bucket: sql`due_bucket`,
    },
    {
      due: sql`due`,
      title: sql`title`,
      priority: sql`case priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
      completed: sql`completed`,
    },
    {
      status: "task_status",
      priority: "priority",
      category: "category",
      assignee: "record_label",
      team: "record_label",
    }
  );
}

const getShape = {
  ids: operationIds,
  sections: z
    .array(z.enum(["details", "checklist", "dependencies"]))
    .min(1)
    .default(["details"]),
  relatedLimit: z.number().int().min(1).max(20).default(10),
};
export function tasksGetManyStatement(
  input: z.infer<z.ZodObject<typeof getShape>>,
  plantId: string
): SQL {
  const checklist = sql`select c.id, c.title, c.status, c.assigned_to_id from tasks c where c.church_id = ${plantId} and c.deleted_at is null and c.parent_task_id = t.id`;
  const dependencies = sql`select p.id, p.title, p.status, a.name as assignee, a.id as account_id from task_dependencies d join tasks p on p.id = d.prerequisite_task_id and p.church_id = ${plantId} and p.deleted_at is null left join users a on a.id = p.assigned_to_id and a.church_id = ${plantId} and a.sending_church_id is null and a.sending_network_id is null where d.church_id = ${plantId} and d.task_id = t.id`;
  const detailFacts = [
    fact("Status", sql`t.status`, { format: "task_status" }),
    fact("Due date", sql`t.due_date`, { format: "calendar" }),
    fact("Assignee", sql`a.name`),
    fact("Assignee account ID", sql`a.id`, { modelOnly: true }),
  ];
  if (input.sections.includes("details"))
    detailFacts.push(
      fact("Description", sql`t.description`),
      fact("Priority", sql`t.priority`, { format: "priority" }),
      fact("Completed", sql`t.completed_at`, { format: "instant" })
    );
  let evidence = facts(...detailFacts);
  if (input.sections.includes("checklist"))
    evidence = sql`${evidence} || ${facts(fact("Checklist total", sql`(select count(*) from (${checklist}) children)`))} || coalesce((select jsonb_agg(${relatedFact("Checklist item", sql`c.title || ' · ' || ${displayLabel(sql`c.status`, "task_status")}`, sql`c.title || ' [' || c.id || ']'`)} order by c.id) from (${checklist} order by c.id limit ${input.relatedLimit}) c), '[]'::jsonb)`;
  if (input.sections.includes("dependencies"))
    evidence = sql`${evidence} || ${facts(fact("Prerequisite total", sql`(select count(*) from (${dependencies}) dependencies)`))} || coalesce((select jsonb_agg(${relatedFact("Prerequisite", sql`p.title || ' · ' || ${displayLabel(sql`p.status`, "task_status")} || ' · ' || coalesce(p.assignee, 'Unassigned or unavailable')`, sql`p.title || ' [' || p.id || ']' || coalesce(' account [' || p.account_id || ']', '')`)} order by p.id) from (${dependencies} order by p.id limit ${input.relatedLimit}) p), '[]'::jsonb)`;
  const source = sql`select t.id::text as id, t.title as label, '/tasks/' || t.id as href, ${evidence} || ${facts(fact("Related evidence limit per section", sql`${input.relatedLimit}::int`))} as facts from tasks t left join users a on a.id = t.assigned_to_id and a.church_id = ${plantId} and a.sending_church_id is null and a.sending_network_id is null where t.church_id = ${plantId} and t.deleted_at is null and ${inValues(sql`t.id::text`, input.ids)}`;
  return operationsStatement(
    source,
    { mode: "list", limit: 50, sort: "id", direction: "asc" },
    {},
    { id: sql`id` }
  );
}

const assigneeShape = { search: operationSearch.optional(), ...operationPage };
export function assigneesStatement(
  input: z.infer<z.ZodObject<typeof assigneeShape>>,
  plantId: string
) {
  const source = sql`select a.id::text as id, a.name as label, '/tasks'::text as href, ${facts(fact("Account ID", sql`a.id`, { modelOnly: true }), fact("Email", sql`a.email`), fact("Person ID", sql`p.id`, { modelOnly: true }))} as facts from users a left join persons p on p.user_id = a.id and p.church_id = ${plantId} and p.deleted_at is null where a.church_id = ${plantId} and a.sending_church_id is null and a.sending_network_id is null and ${input.search ? sql`a.name ilike ${`%${input.search}%`}` : sql`true`}`;
  return operationsStatement(
    source,
    { ...input, mode: "list", sort: "name", direction: "asc" },
    {},
    { name: sql`label` }
  );
}

export const TASK_QUERY_READS = [
  defineEvryReadRegistration({
    id: "tasks.query",
    capabilityIdentity: "tasks.read.list",
    inputShape: tasksQueryShape,
    async run({ authorization, now = new Date() }, input) {
      const actor = authorization.actor;
      const zone = await operationsTimeZone(actor.plantId);
      return operationsArtifact(
        "Tasks",
        "/tasks",
        await executeOperations(
          tasksQueryStatement(input, actor.plantId, actor.userId, now, zone)
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
    id: "tasks.get_many",
    capabilityIdentity: "tasks.read.detail",
    inputShape: getShape,
    async run({ authorization, now = new Date() }, input) {
      const zone = await operationsTimeZone(authorization.actor.plantId);
      return operationsArtifact(
        "Tasks",
        "/tasks",
        await executeOperations(
          tasksGetManyStatement(input, authorization.actor.plantId)
        ),
        input,
        now,
        zone,
        input.ids
      );
    },
  }),
  defineEvryReadRegistration({
    id: "tasks.assignees.search",
    capabilityIdentity: "tasks.read.planning-options",
    inputShape: assigneeShape,
    async run({ authorization, now = new Date() }, input) {
      return operationsArtifact(
        "Task assignees",
        "/tasks",
        await executeOperations(
          assigneesStatement(input, authorization.actor.plantId)
        ),
        input,
        now,
        await operationsTimeZone(authorization.actor.plantId)
      );
    },
  }),
] as const;
