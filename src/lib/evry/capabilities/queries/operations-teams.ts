import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { teamStatuses, membershipStatuses } from "@/db/schema";
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

const teamFilter = z.strictObject({
  ids: operationIds.optional(),
  search: operationSearch.optional(),
  statuses: z.array(z.enum(teamStatuses)).min(1).optional(),
  leaderIds: operationIds.optional(),
  hasLeader: z.boolean().optional(),
  hasVacancies: z.boolean().optional(),
  minimumOpenSlots: z.number().int().min(0).optional(),
});
const roleFilter = z.strictObject({
  teamIds: operationIds.optional(),
  ids: operationIds.optional(),
  search: operationSearch.optional(),
  vacant: z.boolean().optional(),
  leadership: z.boolean().optional(),
  desiredSkills: operationSearch.optional(),
  timeCommitment: z.enum(["low", "medium", "high"]).optional(),
  personIds: operationIds.optional(),
});
const assignmentFilter = z.strictObject({
  teamIds: operationIds.optional(),
  personIds: operationIds.optional(),
  roleIds: operationIds.optional(),
  statuses: z.array(z.enum(membershipStatuses)).min(1).optional(),
});
const personFilter = z.strictObject({
  ids: operationIds.optional(),
  teamIds: operationIds.optional(),
  roleIds: operationIds.optional(),
  assigned: z.boolean().optional(),
});
const responsibilityFilter = z.strictObject({
  teamIds: operationIds.optional(),
  search: operationSearch.optional(),
  complete: z.boolean().optional(),
});
export const teamsQueryShape = {
  request: z.discriminatedUnion("resource", [
    z.strictObject({
      resource: z.literal("teams"),
      where: operationsWhere(teamFilter),
      query: operationsMode(["name", "open_slots"], ["status", "leader"]),
    }),
    z.strictObject({
      resource: z.literal("roles"),
      where: operationsWhere(roleFilter),
      query: operationsMode(
        ["name", "team"],
        ["team", "vacancy", "leadership"]
      ),
    }),
    z.strictObject({
      resource: z.literal("assignments"),
      where: operationsWhere(assignmentFilter),
      query: operationsMode(["name", "team"], ["team", "person", "status"]),
    }),
    z.strictObject({
      resource: z.literal("people"),
      where: operationsWhere(personFilter),
      query: operationsMode(["name"], ["status", "assigned"]),
    }),
    z.strictObject({
      resource: z.literal("responsibilities"),
      where: operationsWhere(responsibilityFilter),
      query: operationsMode(["name", "team"], ["team", "completion"]),
    }),
  ]),
};

function all(clauses: SQL[]) {
  return clauses.length ? sql`(${sql.join(clauses, sql` and `)})` : sql`true`;
}
function activeRole(plantId: string) {
  return sql`exists (select 1 from team_memberships seat join persons occupant on occupant.id = seat.person_id and occupant.church_id = ${plantId} and occupant.deleted_at is null where seat.church_id = ${plantId} and seat.team_id = r.team_id and seat.role_id = r.id and seat.status = 'active')`;
}
function openSlots(plantId: string) {
  return sql`(select count(*)::int from team_roles r where r.church_id = ${plantId} and r.team_id = mt.id and not ${activeRole(plantId)})`;
}
function personMembership(
  plantId: string,
  f: z.infer<typeof personFilter>
): SQL {
  return sql`exists (select 1 from team_memberships seat join ministry_teams own_team on own_team.id = seat.team_id and own_team.church_id = ${plantId} join team_roles own_role on own_role.id = seat.role_id and own_role.team_id = own_team.id and own_role.church_id = ${plantId} where seat.church_id = ${plantId} and seat.person_id = p.id and seat.status = 'active' and ${f.teamIds ? inValues(sql`seat.team_id::text`, f.teamIds) : sql`true`} and ${f.roleIds ? inValues(sql`seat.role_id::text`, f.roleIds) : sql`true`})`;
}

export function teamsQueryStatement(
  input: z.infer<z.ZodObject<typeof teamsQueryShape>>,
  plantId: string
): SQL {
  const r = input.request;
  if (r.resource === "teams") {
    const where = predicateSet(r.where, (f) => {
      const clauses: SQL[] = [];
      if (f.ids) clauses.push(inValues(sql`mt.id::text`, f.ids));
      if (f.search) clauses.push(sql`mt.name ilike ${`%${f.search}%`}`);
      if (f.statuses) clauses.push(inValues(sql`mt.status`, f.statuses));
      if (f.leaderIds)
        clauses.push(inValues(sql`leader.id::text`, f.leaderIds));
      if (f.hasLeader !== undefined)
        clauses.push(
          f.hasLeader ? sql`leader.id is not null` : sql`leader.id is null`
        );
      if (f.hasVacancies !== undefined)
        clauses.push(
          f.hasVacancies
            ? sql`${openSlots(plantId)} > 0`
            : sql`${openSlots(plantId)} = 0`
        );
      if (f.minimumOpenSlots !== undefined)
        clauses.push(sql`${openSlots(plantId)} >= ${f.minimumOpenSlots}`);
      return all(clauses);
    });
    return operationsStatement(
      sql`select mt.id::text as id, mt.name as label, '/teams/' || mt.id as href, ${facts(fact("Status", sql`mt.status`, { format: "team_status" }), fact("Leader", sql`leader.first_name || ' ' || leader.last_name`), fact("Open role slots", openSlots(plantId)), fact("Role slots", sql`(select count(*) from team_roles roles where roles.church_id = ${plantId} and roles.team_id = mt.id)`), fact("Distinct active people", sql`(select count(distinct seat.person_id) from team_memberships seat join persons p on p.id = seat.person_id and p.church_id = ${plantId} and p.deleted_at is null where seat.church_id = ${plantId} and seat.team_id = mt.id and seat.status = 'active')`))} as facts,
      mt.name, mt.status, coalesce(leader.first_name || ' ' || leader.last_name || ' [' || leader.id::text || ']', 'No leader') as leader, ${openSlots(plantId)} as open_slots
      from ministry_teams mt left join persons leader on leader.id = mt.leader_id and leader.church_id = ${plantId} and leader.deleted_at is null where mt.church_id = ${plantId} and ${where}`,
      r.query,
      { status: sql`status`, leader: sql`leader` },
      { name: sql`name`, open_slots: sql`open_slots` },
      { status: "team_status", leader: "record_label" }
    );
  }
  if (r.resource === "roles") {
    const where = predicateSet(r.where, (f) => {
      const clauses: SQL[] = [];
      if (f.teamIds) clauses.push(inValues(sql`mt.id::text`, f.teamIds));
      if (f.ids) clauses.push(inValues(sql`r.id::text`, f.ids));
      if (f.search) clauses.push(sql`r.name ilike ${`%${f.search}%`}`);
      if (f.vacant !== undefined)
        clauses.push(
          f.vacant ? sql`not ${activeRole(plantId)}` : activeRole(plantId)
        );
      if (f.leadership !== undefined)
        clauses.push(sql`r.is_leadership_role = ${f.leadership}`);
      if (f.desiredSkills)
        clauses.push(sql`r.desired_skills ilike ${`%${f.desiredSkills}%`}`);
      if (f.timeCommitment)
        clauses.push(sql`r.time_commitment = ${f.timeCommitment}`);
      if (f.personIds)
        clauses.push(
          sql`exists (select 1 from team_memberships seat join persons p on p.id = seat.person_id and p.church_id = ${plantId} and p.deleted_at is null where seat.church_id = ${plantId} and seat.role_id = r.id and seat.team_id = r.team_id and seat.status = 'active' and ${inValues(sql`p.id::text`, f.personIds)})`
        );
      return all(clauses);
    });
    return operationsStatement(
      sql`select r.id::text as id, r.name as label, '/teams/' || mt.id as href, ${facts(fact("Ministry", sql`mt.name`), fact("Vacancy", sql`case when ${activeRole(plantId)} then 'Filled' else 'Open' end`), fact("Leadership role", sql`r.is_leadership_role`, { format: "boolean" }), fact("Desired skills", sql`r.desired_skills`), fact("Time commitment", sql`r.time_commitment`, { format: "priority" }))} as facts, r.name, mt.name || ' [' || mt.id::text || ']' as team, case when ${activeRole(plantId)} then 'Filled' else 'Open' end as vacancy, r.is_leadership_role as leadership
      from team_roles r join ministry_teams mt on mt.id = r.team_id and mt.church_id = ${plantId} where r.church_id = ${plantId} and ${where}`,
      r.query,
      { team: sql`team`, vacancy: sql`vacancy`, leadership: sql`leadership` },
      { name: sql`name`, team: sql`team` },
      { team: "record_label", leadership: "boolean" }
    );
  }
  if (r.resource === "assignments") {
    const where = predicateSet(r.where, (f) =>
      all([
        ...(f.teamIds ? [inValues(sql`mt.id::text`, f.teamIds)] : []),
        ...(f.personIds ? [inValues(sql`p.id::text`, f.personIds)] : []),
        ...(f.roleIds ? [inValues(sql`role.id::text`, f.roleIds)] : []),
        ...(f.statuses ? [inValues(sql`seat.status`, f.statuses)] : []),
      ])
    );
    return operationsStatement(
      sql`select seat.id::text as id, p.first_name || ' ' || p.last_name as label, '/teams/' || mt.id as href, ${facts(fact("Person ID", sql`p.id`, { modelOnly: true }), fact("Ministry", sql`mt.name`), fact("Role", sql`role.name`), fact("Role ID", sql`role.id`, { modelOnly: true }), fact("Status", sql`seat.status`, { format: "team_status" }), fact("Started", sql`seat.start_date`, { format: "calendar" }), fact("Ended", sql`seat.end_date`, { format: "calendar" }))} as facts, p.first_name || ' ' || p.last_name as name, mt.name || ' [' || mt.id::text || ']' as team, p.first_name || ' ' || p.last_name || ' [' || p.id::text || ']' as person, seat.status
      from team_memberships seat join ministry_teams mt on mt.id = seat.team_id and mt.church_id = ${plantId} join team_roles role on role.id = seat.role_id and role.team_id = mt.id and role.church_id = ${plantId} join persons p on p.id = seat.person_id and p.church_id = ${plantId} and p.deleted_at is null where seat.church_id = ${plantId} and ${where}`,
      r.query,
      { team: sql`team`, person: sql`person`, status: sql`status` },
      { name: sql`name`, team: sql`team` },
      { team: "record_label", person: "record_label", status: "team_status" }
    );
  }
  if (r.resource === "people") {
    const where = predicateSet(r.where, (f) =>
      all([
        ...(f.ids ? [inValues(sql`p.id::text`, f.ids)] : []),
        ...(f.assigned !== undefined || f.teamIds || f.roleIds
          ? [
              f.assigned === false
                ? sql`not ${personMembership(plantId, f)}`
                : personMembership(plantId, f),
            ]
          : []),
      ])
    );
    return operationsStatement(
      sql`select p.id::text as id, p.first_name || ' ' || p.last_name as label, '/people/' || p.id as href, ${facts(fact("Stage", sql`p.status`, { format: "person_status" }), fact("Currently assigned", personMembership(plantId, {}), { format: "boolean" }))} as facts, p.first_name || ' ' || p.last_name as name, p.status, ${personMembership(plantId, {})} as assigned from persons p where p.church_id = ${plantId} and p.deleted_at is null and ${where}`,
      r.query,
      { status: sql`status`, assigned: sql`assigned` },
      { name: sql`name` },
      { status: "person_status", assigned: "boolean" }
    );
  }
  const where = predicateSet(r.where, (f) =>
    all([
      ...(f.teamIds ? [inValues(sql`mt.id::text`, f.teamIds)] : []),
      ...(f.search ? [sql`responsibility.title ilike ${`%${f.search}%`}`] : []),
      ...(f.complete !== undefined
        ? [
            f.complete
              ? sql`responsibility.completed_at is not null`
              : sql`responsibility.completed_at is null`,
          ]
        : []),
    ])
  );
  return operationsStatement(
    sql`select responsibility.id::text as id, responsibility.title as label, '/teams/' || mt.id as href, ${facts(fact("Ministry", sql`mt.name`), fact("Completed at", sql`responsibility.completed_at`, { format: "instant" }))} as facts, responsibility.title as name, mt.name || ' [' || mt.id::text || ']' as team, case when responsibility.completed_at is null then 'Incomplete' else 'Complete' end as completion from team_responsibilities responsibility join ministry_teams mt on mt.id = responsibility.team_id and mt.church_id = ${plantId} where responsibility.church_id = ${plantId} and ${where}`,
    r.query,
    { team: sql`team`, completion: sql`completion` },
    { name: sql`name`, team: sql`team` },
    { team: "record_label" }
  );
}

const getShape = {
  resource: z.enum(["teams", "roles"]),
  ids: operationIds,
  sections: z
    .array(
      z.enum(["details", "roles", "roster", "responsibilities", "requirements"])
    )
    .min(1)
    .default(["details"]),
  relatedLimit: z.number().int().min(1).max(20).default(10),
};
export function teamsGetManyStatement(
  input: z.infer<z.ZodObject<typeof getShape>>,
  plantId: string
): SQL {
  const roleOnly = input.resource === "roles";
  const roster = sql`select seat.id, p.id as person_id, p.first_name || ' ' || p.last_name as name, role.name as role_name from team_memberships seat join persons p on p.id = seat.person_id and p.church_id = ${plantId} and p.deleted_at is null join team_roles role on role.id = seat.role_id and role.team_id = seat.team_id and role.church_id = ${plantId} where seat.church_id = ${plantId} and seat.team_id = mt.id and seat.status = 'active' and ${roleOnly ? sql`seat.role_id = r.id` : sql`true`}`;
  let evidence = facts(
    fact("Ministry", sql`mt.name`),
    fact("Description", roleOnly ? sql`r.description` : sql`mt.description`),
    fact("Status", roleOnly ? sql`r.status` : sql`mt.status`, {
      format: "team_status",
    })
  );
  if (input.sections.includes("requirements") && roleOnly)
    evidence = sql`${evidence} || ${facts(fact("Desired skills", sql`r.desired_skills`), fact("Time commitment", sql`r.time_commitment`, { format: "priority" }), fact("Leadership role", sql`r.is_leadership_role`, { format: "boolean" }))}`;
  if (input.sections.includes("roster"))
    evidence = sql`${evidence} || ${facts(fact("Active assignments total", sql`(select count(*) from (${roster}) roster)`), fact("Distinct active people total", sql`(select count(distinct person_id) from (${roster}) roster)`))} || coalesce((select jsonb_agg(${relatedFact("Assigned person", sql`member.name || ' · ' || member.role_name`, sql`member.name || ' [' || member.person_id || ']'`)} order by member.id) from (${roster} order by seat.id limit ${input.relatedLimit}) member), '[]'::jsonb)`;
  if (input.sections.includes("roles"))
    evidence = sql`${evidence} || ${facts(fact("Role slots total", sql`(select count(*) from team_roles r where r.church_id = ${plantId} and r.team_id = mt.id)`), fact("Open role slots", openSlots(plantId)))} || coalesce((select jsonb_agg(${relatedFact("Role", sql`role.name || ' · ' || ${displayLabel(sql`role.status`, "team_status")}`, sql`role.name || ' [' || role.id || ']'`)} order by role.id) from (select r.id, r.name, r.status from team_roles r where r.church_id = ${plantId} and r.team_id = mt.id order by r.id limit ${input.relatedLimit}) role), '[]'::jsonb)`;
  if (input.sections.includes("responsibilities"))
    evidence = sql`${evidence} || ${facts(fact("Responsibilities total", sql`(select count(*) from team_responsibilities responsibility where responsibility.church_id = ${plantId} and responsibility.team_id = mt.id)`))} || coalesce((select jsonb_agg(${fact("Responsibility", sql`responsibility.title || ' · ' || case when responsibility.completed_at is null then 'Incomplete' else 'Complete' end`)} order by responsibility.id) from (select responsibility.id, responsibility.title, responsibility.completed_at from team_responsibilities responsibility where responsibility.church_id = ${plantId} and responsibility.team_id = mt.id order by responsibility.id limit ${input.relatedLimit}) responsibility), '[]'::jsonb)`;
  if (input.sections.includes("requirements"))
    evidence = sql`${evidence} || ${facts(fact("Required training programs total", sql`(select count(*) from training_programs program where program.church_id = ${plantId} and (program.team_id = mt.id or program.team_id is null) and program.is_required)`))} || coalesce((select jsonb_agg(${relatedFact("Required training", sql`program.name`, sql`program.name || ' [' || program.id || ']'`)} order by program.id) from (select program.id, program.name from training_programs program where program.church_id = ${plantId} and (program.team_id = mt.id or program.team_id is null) and program.is_required order by program.id limit ${input.relatedLimit}) program), '[]'::jsonb)`;
  const source = sql`select ${roleOnly ? sql`r.id` : sql`mt.id`}::text as id, ${roleOnly ? sql`r.name` : sql`mt.name`} as label, '/teams/' || mt.id as href, ${evidence} || ${facts(fact("Related evidence limit per section", sql`${input.relatedLimit}::int`))} as facts from ministry_teams mt ${roleOnly ? sql`join team_roles r on r.team_id = mt.id and r.church_id = ${plantId}` : sql``} where mt.church_id = ${plantId} and ${inValues(roleOnly ? sql`r.id::text` : sql`mt.id::text`, input.ids)}`;
  return operationsStatement(
    source,
    { mode: "list", limit: 50, sort: "id", direction: "asc" },
    {},
    { id: sql`id` }
  );
}

const trainingProgramFilter = z.strictObject({
  ids: operationIds.optional(),
  teamIds: operationIds.optional(),
  search: operationSearch.optional(),
  required: z.boolean().optional(),
});
const trainingPersonFilter = z.strictObject({
  programIds: operationIds.optional(),
  personIds: operationIds.optional(),
  teamIds: operationIds.optional(),
  roleIds: operationIds.optional(),
  completed: z.boolean().optional(),
  completedDate: evryDateRangeSchema.optional(),
  required: z.boolean().optional(),
});
export const trainingQueryShape = {
  request: z.discriminatedUnion("resource", [
    z.strictObject({
      resource: z.literal("programs"),
      where: operationsWhere(trainingProgramFilter),
      query: operationsMode(["name"], ["team", "required"]),
    }),
    z.strictObject({
      resource: z.enum(["requirements", "completions"]),
      where: operationsWhere(trainingPersonFilter),
      query: operationsMode(
        ["name", "completed"],
        ["person", "program", "team", "completion"]
      ),
    }),
  ]),
};

export function trainingQueryStatement(
  input: z.infer<z.ZodObject<typeof trainingQueryShape>>,
  plantId: string,
  now: Date,
  zone: string
) {
  const r = input.request;
  if (r.resource === "programs") {
    const where = predicateSet(r.where, (f) =>
      all([
        ...(f.ids ? [inValues(sql`program.id::text`, f.ids)] : []),
        ...(f.teamIds
          ? [
              sql`(program.team_id is null or ${inValues(sql`mt.id::text`, f.teamIds)})`,
            ]
          : []),
        ...(f.required !== undefined
          ? [sql`program.is_required = ${f.required}`]
          : []),
        ...(f.search ? [sql`program.name ilike ${`%${f.search}%`}`] : []),
      ])
    );
    return operationsStatement(
      sql`select program.id::text as id, program.name as label, '/teams'::text as href, ${facts(fact("Required", sql`program.is_required`, { format: "boolean" }), fact("Ministry", sql`coalesce(mt.name, 'All ministries')`), fact("Description", sql`program.description`))} as facts, program.name, coalesce(mt.name || ' [' || mt.id::text || ']', 'All ministries') as team, program.is_required as required from training_programs program left join ministry_teams mt on mt.id = program.team_id and mt.church_id = ${plantId} where program.church_id = ${plantId} and (program.team_id is null or mt.id is not null) and ${where}`,
      r.query,
      { team: sql`team`, required: sql`required` },
      { name: sql`name` },
      { team: "record_label", required: "boolean" }
    );
  }
  const where = predicateSet(r.where, (f) => {
    const membership = sql`exists (select 1 from team_memberships seat join ministry_teams own_team on own_team.id = seat.team_id and own_team.church_id = ${plantId} join team_roles role on role.id = seat.role_id and role.team_id = own_team.id and role.church_id = ${plantId} where seat.church_id = ${plantId} and seat.person_id = p.id and seat.status = 'active' and (program.team_id is null or seat.team_id = program.team_id) and ${f.teamIds ? inValues(sql`seat.team_id::text`, f.teamIds) : sql`true`} and ${f.roleIds ? inValues(sql`role.id::text`, f.roleIds) : sql`true`})`;
    return all([
      ...(f.programIds ? [inValues(sql`program.id::text`, f.programIds)] : []),
      ...(f.personIds ? [inValues(sql`p.id::text`, f.personIds)] : []),
      ...(f.teamIds || f.roleIds ? [membership] : []),
      ...(f.completed !== undefined
        ? [
            f.completed
              ? sql`completion.id is not null`
              : sql`completion.id is null`,
          ]
        : []),
      ...(f.completedDate
        ? [
            datePredicate(
              sql`(completion.completed_at at time zone 'UTC' at time zone ${zone})::date`,
              f.completedDate,
              now,
              zone
            ),
          ]
        : []),
      ...(f.required !== undefined
        ? [sql`program.is_required = ${f.required}`]
        : []),
    ]);
  });
  const scope =
    r.resource === "requirements"
      ? sql`program.is_required and exists (select 1 from team_memberships current_seat join ministry_teams current_team on current_team.id = current_seat.team_id and current_team.church_id = ${plantId} join team_roles occupied_role on occupied_role.id = current_seat.role_id and occupied_role.team_id = current_team.id and occupied_role.church_id = ${plantId} where current_seat.church_id = ${plantId} and current_seat.person_id = p.id and current_seat.status = 'active' and (program.team_id is null or current_seat.team_id = program.team_id))`
      : sql`completion.id is not null`;
  const source = sql`select p.id::text || ':' || program.id::text as id, p.first_name || ' ' || p.last_name || ' · ' || program.name as label, '/people/' || p.id as href,
    ${facts(fact("Person ID", sql`p.id`, { modelOnly: true }), fact("Training program ID", sql`program.id`, { modelOnly: true }), fact("Program", sql`program.name`), fact("Required", sql`program.is_required`, { format: "boolean" }), fact("Completion", sql`case when completion.id is null then 'No completion recorded' else 'Completed' end`), fact("Completed at", sql`completion.completed_at`, { format: "instant" }), fact("Evidence", sql`'Current requirements derive from active team roles and required team/global programs. No certification expiry is recorded.'`))} as facts,
    p.first_name || ' ' || p.last_name as name, completion.completed_at as completed, p.first_name || ' ' || p.last_name || ' [' || p.id::text || ']' as person, program.name || ' [' || program.id::text || ']' as program, coalesce(mt.name || ' [' || mt.id::text || ']', 'All ministries') as team, case when completion.id is null then 'No completion recorded' else 'Completed' end as completion
    from persons p join training_programs program on program.church_id = ${plantId} left join ministry_teams mt on mt.id = program.team_id and mt.church_id = ${plantId} left join training_completions completion on completion.person_id = p.id and completion.training_program_id = program.id and completion.church_id = ${plantId}
    where p.church_id = ${plantId} and p.deleted_at is null and (program.team_id is null or mt.id is not null) and ${scope} and ${where}`;
  return operationsStatement(
    source,
    r.query,
    {
      person: sql`person`,
      program: sql`program`,
      team: sql`team`,
      completion: sql`completion`,
    },
    { name: sql`name`, completed: sql`completed` },
    { person: "record_label", program: "record_label", team: "record_label" }
  );
}

export const TEAM_QUERY_READS = [
  defineEvryReadRegistration({
    id: "teams.query",
    capabilityIdentity: "teams.read.list",
    inputShape: teamsQueryShape,
    async run({ authorization, now = new Date() }, input) {
      return operationsArtifact(
        `Ministry ${input.request.resource}`,
        "/teams",
        await executeOperations(
          teamsQueryStatement(input, authorization.actor.plantId)
        ),
        input,
        now,
        await operationsTimeZone(authorization.actor.plantId),
        undefined,
        input.request.query.mode
      );
    },
  }),
  defineEvryReadRegistration({
    id: "teams.get_many",
    capabilityIdentity: "teams.read.detail",
    inputShape: getShape,
    async run({ authorization, now = new Date() }, input) {
      return operationsArtifact(
        `Ministry ${input.resource}`,
        "/teams",
        await executeOperations(
          teamsGetManyStatement(input, authorization.actor.plantId)
        ),
        input,
        now,
        await operationsTimeZone(authorization.actor.plantId),
        input.ids
      );
    },
  }),
  defineEvryReadRegistration({
    id: "training.query",
    capabilityIdentity: "teams.read.training",
    inputShape: trainingQueryShape,
    async run({ authorization, now = new Date() }, input) {
      const zone = await operationsTimeZone(authorization.actor.plantId);
      return operationsArtifact(
        "Training",
        "/teams",
        await executeOperations(
          trainingQueryStatement(input, authorization.actor.plantId, now, zone)
        ),
        input,
        now,
        zone,
        undefined,
        input.request.query.mode
      );
    },
  }),
] as const;
