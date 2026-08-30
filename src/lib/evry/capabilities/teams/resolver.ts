import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { APP_TIME_ZONE, toCalendarDate } from "@/lib/datetime";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  TEAM_TEMPLATES,
  getRoleTemplates,
  playbookResponsibilities,
  type PredefinedTeamKey,
} from "@/lib/ministry-teams/role-templates";
import {
  coreGroupUserIdsQuery,
  personUserIdsQuery,
  planMeetingNotifications,
} from "@/lib/meetings/notifications";
import {
  defaultAgendaTemplatesForType,
  parseAgenda,
  sectionsFromTemplates,
} from "@/lib/meetings/agenda";
import {
  memberAssignSchema,
  responsibilitySchema,
  roleCreateSchema,
  roleUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema,
  trainingCompleteSchema,
  trainingProgramCreateSchema,
} from "@/lib/validations/ministry-teams";
import { meetingCreateSchema } from "@/lib/validations/meetings";

import {
  TEAMS_EFFECT_TABLES,
  parseTeamsEffectArguments,
  type TeamsEffectArguments,
  type TeamsEffectOperation,
} from "./effect-contracts";
import type { TeamsEvryEffectSelection } from "./selection";

type Table = (typeof TEAMS_EFFECT_TABLES)[number];
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type RawRow = Record<string, JsonValue>;
type Snapshot = TeamsEffectArguments["expected"][number];
type Mutation = TeamsEffectArguments["mutations"][number];
type SetAssertion = TeamsEffectArguments["sets"][number];

export type ResolvedTeamsEffect = Readonly<{
  operation: TeamsEffectOperation;
  arguments: TeamsEffectArguments;
}>;

function asRaw(value: unknown): RawRow {
  return structuredClone(value) as RawRow;
}

function iso(now: Date): string {
  return now.toISOString();
}

function sortedIds(rows: readonly RawRow[]): string[] {
  return rows.map(({ id }) => String(id)).toSorted();
}

async function queryRows(query: ReturnType<typeof sql>): Promise<RawRow[]> {
  const result = await db.execute<RawRow>(query);
  return result.rows.map((row) => asRaw(row));
}

async function rawRow(
  table: Table,
  plantId: string,
  id: string
): Promise<RawRow | null> {
  const tableName = sql.identifier(table);
  const churchTerm =
    table === "churches"
      ? sql`id = ${plantId}::uuid`
      : sql`church_id = ${plantId}::uuid`;
  const result = await queryRows(
    sql`select to_jsonb(r) row from ${tableName} r where r.id=${id}::uuid and ${churchTerm} limit 1`
  );
  const wrapped = result[0]?.row;
  return wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
    ? asRaw(wrapped)
    : null;
}

function snapshot(table: Table, id: string, state: RawRow | null): Snapshot {
  return { table, id, state };
}

function mutation(
  table: Table,
  id: string,
  before: RawRow | null,
  after: RawRow | null
): Mutation {
  return {
    table,
    id,
    mode: before === null ? "insert" : after === null ? "delete" : "update",
    before,
    after,
  };
}

function set(
  kind: SetAssertion["kind"],
  ids: readonly string[],
  scopeId: string | null = null,
  otherId: string | null = null
): SetAssertion {
  return { kind, scopeId, otherId, ids: [...ids].toSorted() };
}

function disclosure(input: {
  title: string;
  targets: readonly { label: string; value: string; href?: string | null }[];
  mutations: readonly Mutation[];
  counts?: readonly { label: string; count: number }[];
  consequences: readonly string[];
  reversibility?: "reversible" | "difficult_to_reverse" | "irreversible";
  dateTime?: { instantUtc: string; timeZone: string } | null;
}) {
  return {
    title: input.title,
    targets: input.targets.map((target) => ({
      ...target,
      href: target.href ?? null,
    })),
    counts: input.counts ?? [
      { label: "Database rows", count: input.mutations.length },
    ],
    changes: input.mutations.map((change) => ({
      label: `${change.table} ${change.id}`,
      before: JSON.stringify(change.before),
      after: JSON.stringify(change.after),
    })),
    consequences: [...input.consequences],
    reversibility: input.reversibility ?? "reversible",
    dateTime: input.dateTime ?? null,
  } as const;
}

function finish(input: {
  operation: TeamsEffectOperation;
  expected: Snapshot[];
  sets?: SetAssertion[];
  mutations: Mutation[];
  notificationIntents?: readonly {
    recipientUserId: string;
    type: string;
    scheduledFor: string;
  }[];
  title: string;
  targets: readonly { label: string; value: string; href?: string | null }[];
  consequences: readonly string[];
  counts?: readonly { label: string; count: number }[];
  reversibility?: "reversible" | "difficult_to_reverse" | "irreversible";
  dateTime?: { instantUtc: string; timeZone: string } | null;
}): ResolvedTeamsEffect {
  const args = parseTeamsEffectArguments(input.operation, {
    operation: input.operation,
    expected: input.expected,
    sets: input.sets ?? [],
    mutations: input.mutations,
    notificationIntents: input.notificationIntents ?? [],
    disclosure: disclosure(input),
  });
  return Object.freeze({ operation: input.operation, arguments: args });
}

function uuid(value: string | undefined): string | null {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
    ? value.toLowerCase()
    : null;
}

function csv(value: string | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      ]
    : [];
}

function exactBoolean(value: string | undefined): boolean {
  return value === undefined || value === "true" || value === "false";
}

function exactCalendarDate(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function updateRow(
  before: RawRow,
  now: Date,
  fields: Record<string, JsonValue | undefined>
): RawRow {
  const after = asRaw(before);
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined) after[key] = value;
  after.updated_at = iso(now);
  return after;
}

function newTeam(input: {
  actor: EvryPlantActor;
  now: Date;
  name: string;
  description: string | null;
  icon: string | null;
  type: "custom" | "predefined";
  templateKey: PredefinedTeamKey | null;
  sortOrder: number;
}) {
  const id = randomUUID();
  return asRaw({
    id,
    church_id: input.actor.plantId,
    name: input.name,
    template_key: input.templateKey,
    type: input.type,
    description: input.description,
    icon: input.icon,
    leader_id: null,
    responsibilities_seeded_at: null,
    reports_to_team_id: null,
    phase_introduced: "phase_2",
    status: "forming",
    sort_order: input.sortOrder,
    created_by: input.actor.userId,
    created_at: iso(input.now),
    updated_at: iso(input.now),
  });
}

function newRole(input: {
  actor: EvryPlantActor;
  now: Date;
  teamId: string;
  name: string;
  description: string | null;
  isLeadershipRole: boolean;
  timeCommitment: string | null;
  desiredSkills: string | null;
  sortOrder: number;
}) {
  const id = randomUUID();
  return asRaw({
    id,
    church_id: input.actor.plantId,
    team_id: input.teamId,
    name: input.name,
    description: input.description,
    reports_to_role_id: null,
    is_leadership_role: input.isLeadershipRole,
    time_commitment: input.timeCommitment,
    desired_skills: input.desiredSkills,
    sort_order: input.sortOrder,
    status: "open",
    created_by: input.actor.userId,
    created_at: iso(input.now),
    updated_at: iso(input.now),
  });
}

function statusEffects(input: {
  actor: EvryPlantActor;
  person: RawRow;
  now: Date;
  teamId: string;
  roleId?: string;
  member: boolean;
  leader: boolean;
}) {
  const mutations: Mutation[] = [];
  const expected: Snapshot[] = [
    snapshot("persons", String(input.person.id), input.person),
  ];
  let person = input.person;
  const activities: RawRow[] = [];
  const advance = (from: string, to: string, reason: string) => {
    if (person.status !== from) return;
    const before = person;
    person = updateRow(before, input.now, { status: to });
    const activity = asRaw({
      id: randomUUID(),
      church_id: input.actor.plantId,
      person_id: person.id,
      activity_type: "status_changed",
      metadata: { oldStatus: from, newStatus: to, reason },
      performed_by: person.created_by,
      created_at: iso(input.now),
    });
    activities.push(activity);
  };
  if (input.member)
    advance(
      "core_group",
      "launch_team",
      `Auto-advanced from team assignment (team: ${input.teamId}, role: ${input.roleId})`
    );
  if (input.leader)
    advance(
      "launch_team",
      "leader",
      `Auto-advanced from team leader assignment (team: ${input.teamId})`
    );
  if (person !== input.person)
    mutations.push(
      mutation("persons", String(person.id), input.person, person)
    );
  for (const activity of activities) {
    const id = String(activity.id);
    expected.push(snapshot("person_activities", id, null));
    mutations.push(mutation("person_activities", id, null, activity));
  }
  return { expected, mutations };
}

async function allRows(
  table: Table,
  plantId: string,
  where: ReturnType<typeof sql>
): Promise<RawRow[]> {
  const tableName = sql.identifier(table);
  return queryRows(
    sql`select to_jsonb(r) row from ${tableName} r where r.church_id=${plantId}::uuid and ${where} order by r.id`
  ).then((rows) => rows.map(({ row }) => asRaw(row)));
}

async function teamAndFields(actor: EvryPlantActor, teamId: string) {
  return rawRow("ministry_teams", actor.plantId, teamId);
}

async function leadershipFill(input: {
  actor: EvryPlantActor;
  now: Date;
  team: RawRow;
  role: RawRow;
}) {
  const ownerIds = (
    await queryRows(
      sql`select p.id from persons p join users u on u.id=p.user_id and u.church_id=p.church_id join churches c on c.id=p.church_id where p.church_id=${input.actor.plantId}::uuid and p.deleted_at is null and u.seat='owner' and c.leadership_status='planter_confirmed' order by p.id`
    )
  ).map(({ id }) => String(id));
  const result = {
    team: input.team,
    role: input.role,
    expected: [] as Snapshot[],
    sets: [set("confirmed_owner_people", ownerIds)] as SetAssertion[],
    mutations: [] as Mutation[],
  };
  if (ownerIds.length !== 1) return result;
  const personId = ownerIds[0]!;
  const [person, existing, church] = await Promise.all([
    rawRow("persons", input.actor.plantId, personId),
    allRows(
      "team_memberships",
      input.actor.plantId,
      sql`team_id=${String(input.team.id)}::uuid and person_id=${personId}::uuid and status='active'`
    ),
    rawRow("churches", input.actor.plantId, input.actor.plantId),
  ]);
  result.sets.push(
    set(
      "active_person_team_memberships",
      sortedIds(existing),
      personId,
      String(input.team.id)
    )
  );
  if (!person || !church || existing.length > 0) {
    if (person) result.expected.push(snapshot("persons", personId, person));
    if (church)
      result.expected.push(snapshot("churches", input.actor.plantId, church));
    return result;
  }
  result.role = { ...input.role, status: "filled" };
  result.team =
    input.team.leader_id === null
      ? { ...input.team, leader_id: personId }
      : input.team;
  const membership = asRaw({
    id: randomUUID(),
    church_id: input.actor.plantId,
    team_id: input.team.id,
    person_id: personId,
    role_id: input.role.id,
    start_date: null,
    end_date: null,
    status: "active",
    notes: null,
    created_by: input.actor.userId,
    created_at: iso(input.now),
    updated_at: iso(input.now),
  });
  const status = statusEffects({
    actor: input.actor,
    person,
    now: input.now,
    teamId: String(input.team.id),
    roleId: String(input.role.id),
    member: true,
    leader: true,
  });
  const churchAfter = updateRow(church, input.now, {
    last_material_event_at: iso(input.now),
  });
  result.expected.push(
    snapshot("team_memberships", String(membership.id), null),
    snapshot("churches", input.actor.plantId, church),
    ...status.expected
  );
  result.mutations.push(
    mutation("team_memberships", String(membership.id), null, membership),
    mutation("churches", input.actor.plantId, church, churchAfter),
    ...status.mutations
  );
  return result;
}

/** Resolve all IDs, row sets, derived People/Phase effects, and final rows before confirmation. */
export async function resolveTeamsEvryEffect(input: {
  actor: EvryPlantActor;
  selection: TeamsEvryEffectSelection;
  now: Date;
}): Promise<ResolvedTeamsEffect | null> {
  const { actor, now } = input;
  const { operation, values } = input.selection;

  if (operation === "createTeamAction") {
    const parsed = teamCreateSchema.safeParse(values);
    if (!parsed.success) return null;
    const after = newTeam({
      actor,
      now,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      type: "custom",
      templateKey: null,
      sortOrder: 100,
    });
    const id = String(after.id);
    return finish({
      operation,
      expected: [snapshot("ministry_teams", id, null)],
      mutations: [mutation("ministry_teams", id, null, after)],
      title: "Create ministry team",
      targets: [
        { label: "Team", value: parsed.data.name, href: `/teams/${id}` },
      ],
      consequences: ["Creates one custom ministry team in this plant."],
    });
  }

  if (operation === "updateTeamAction") {
    const teamId = uuid(values.teamId);
    const parsed = teamUpdateSchema.safeParse(values);
    if (!teamId || !parsed.success || Object.keys(parsed.data).length === 0)
      return null;
    const before = await teamAndFields(actor, teamId);
    if (!before) return null;
    const after = updateRow(before, now, {
      name: parsed.data.name,
      description: parsed.data.description,
      icon: parsed.data.icon,
      status: parsed.data.status,
    });
    return finish({
      operation,
      expected: [snapshot("ministry_teams", teamId, before)],
      mutations: [mutation("ministry_teams", teamId, before, after)],
      title: "Update ministry team",
      targets: [
        { label: "Team", value: String(before.name), href: `/teams/${teamId}` },
      ],
      consequences: ["Updates only the disclosed team fields."],
    });
  }

  if (operation === "assignTeamLeaderAction") {
    const teamId = uuid(values.teamId);
    const personId = uuid(values.personId);
    if (!teamId || !personId) return null;
    const [team, person] = await Promise.all([
      teamAndFields(actor, teamId),
      rawRow("persons", actor.plantId, personId),
    ]);
    if (!team || !person || person.deleted_at !== null) return null;
    const teamAfter = updateRow(team, now, { leader_id: personId });
    const status = statusEffects({
      actor,
      person,
      now,
      teamId,
      member: false,
      leader: true,
    });
    const changes = [
      mutation("ministry_teams", teamId, team, teamAfter),
      ...status.mutations,
    ];
    return finish({
      operation,
      expected: [snapshot("ministry_teams", teamId, team), ...status.expected],
      mutations: changes,
      title: "Assign team leader",
      targets: [
        { label: "Team", value: String(team.name), href: `/teams/${teamId}` },
        {
          label: "Leader",
          value: `${person.first_name} ${person.last_name}`,
          href: `/people/${personId}`,
        },
      ],
      consequences: [
        "Sets the explicit team leader.",
        "A launch-team person advances to leader with a People timeline activity.",
      ],
    });
  }

  if (
    operation === "initializeTeamsAction" ||
    operation === "initializeTeamsWithRolesAction"
  ) {
    const existing = await allRows("ministry_teams", actor.plantId, sql`true`);
    const requestedKeys =
      operation === "initializeTeamsAction" && values.teamKeys
        ? csv(values.teamKeys)
        : TEAM_TEMPLATES.map(({ teamKey }) => teamKey);
    if (
      requestedKeys.some(
        (key) => !TEAM_TEMPLATES.some(({ teamKey }) => teamKey === key)
      )
    )
      return null;
    if (operation === "initializeTeamsWithRolesAction" && existing.length > 0)
      return null;
    const existingNames = new Set(
      existing
        .filter(({ type }) => type === "predefined")
        .map(({ name }) => String(name))
    );
    const retained = TEAM_TEMPLATES.filter(
      ({ teamKey, teamName }) =>
        requestedKeys.includes(teamKey) && existingNames.has(teamName)
    );
    const templates = TEAM_TEMPLATES.filter(
      ({ teamKey, teamName }) =>
        requestedKeys.includes(teamKey) && !existingNames.has(teamName)
    );
    if (templates.length === 0) return null;
    const teams = templates.map((template) =>
      newTeam({
        actor,
        now,
        name: template.teamName,
        description: template.description,
        icon: template.icon,
        type: "predefined",
        templateKey: template.teamKey,
        sortOrder: template.sortOrder,
      })
    );
    const roles =
      operation === "initializeTeamsWithRolesAction"
        ? templates.flatMap((template, index) =>
            getRoleTemplates(template.teamKey).map((role) =>
              newRole({
                actor,
                now,
                teamId: String(teams[index]?.id),
                name: role.roleName,
                description: role.description,
                isLeadershipRole: role.isLeadership,
                timeCommitment: role.timeCommitment,
                desiredSkills: null,
                sortOrder: role.sortOrder,
              })
            )
          )
        : [];
    const fillExpected: Snapshot[] = [];
    const fillSets: SetAssertion[] = [];
    const fillMutations: Mutation[] = [];
    if (operation === "initializeTeamsWithRolesAction") {
      const teamIndex = teams.findIndex(
        ({ template_key }) => template_key === "senior_pastor"
      );
      const team = teams[teamIndex];
      const roleIndex = roles.findIndex(
        (role) => role.team_id === team?.id && role.name === "Senior Pastor"
      );
      const role = roles[roleIndex];
      if (team && role) {
        const fill = await leadershipFill({ actor, now, team, role });
        teams[teamIndex] = fill.team;
        roles[roleIndex] = fill.role;
        fillExpected.push(...fill.expected);
        fillSets.push(...fill.sets);
        fillMutations.push(...fill.mutations);
      }
    }
    const rows = [
      ...teams.map((row) => ["ministry_teams", row] as const),
      ...roles.map((row) => ["team_roles", row] as const),
    ];
    const expected = [
      ...existing.map((row) => snapshot("ministry_teams", String(row.id), row)),
      ...rows.map(([tableName, row]) =>
        snapshot(tableName, String(row.id), null)
      ),
      ...fillExpected,
    ];
    const mutations = [
      ...rows.map(([tableName, row]) =>
        mutation(tableName, String(row.id), null, row)
      ),
      ...fillMutations,
    ];
    return finish({
      operation,
      expected,
      sets: [set("church_teams", sortedIds(existing)), ...fillSets],
      mutations,
      title:
        operation === "initializeTeamsAction"
          ? "Set up predefined ministry teams"
          : "Set up predefined ministry teams and roles",
      targets: teams.map((team) => ({
        label: "Team",
        value: String(team.name),
        href: `/teams/${team.id}`,
      })),
      counts: [
        { label: "Requested teams", count: requestedKeys.length },
        { label: "Teams created", count: teams.length },
        { label: "Existing teams retained", count: retained.length },
        { label: "Role rows created", count: roles.length },
        { label: "Total database rows", count: mutations.length },
      ],
      consequences: [
        roles.length
          ? `Creates ${teams.length} teams and ${roles.length} role descriptions.`
          : `Creates ${teams.length} predefined ministry teams.`,
        retained.length > 0
          ? `Retains ${retained.map(({ teamName }) => teamName).join(", ")} because ${retained.length === 1 ? "that predefined team already exists" : "those predefined teams already exist"}.`
          : "No requested predefined team is retained from an earlier setup.",
        operation === "initializeTeamsWithRolesAction"
          ? "If the plant still has one confirmed Owner-person planter, the Senior Pastor role is filled with the canonical membership, leader, People-stage, and Phase Engine effects."
          : "Only the selected predefined teams are created.",
        "A concurrent or changed team set refuses this exact plan.",
      ],
    });
  }

  if (operation === "createRoleAction") {
    const teamId = uuid(values.teamId);
    const parsed = roleCreateSchema.safeParse(values);
    if (!teamId || !parsed.success || !exactBoolean(values.isLeadershipRole))
      return null;
    const team = await teamAndFields(actor, teamId);
    if (!team) return null;
    const role = newRole({
      actor,
      now,
      teamId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isLeadershipRole: parsed.data.isLeadershipRole ?? false,
      timeCommitment: parsed.data.timeCommitment ?? null,
      desiredSkills: parsed.data.desiredSkills ?? null,
      sortOrder: parsed.data.sortOrder ?? 0,
    });
    const roleId = String(role.id);
    return finish({
      operation,
      expected: [
        snapshot("ministry_teams", teamId, team),
        snapshot("team_roles", roleId, null),
      ],
      mutations: [mutation("team_roles", roleId, null, role)],
      title: "Create team role",
      targets: [
        { label: "Team", value: String(team.name), href: `/teams/${teamId}` },
        { label: "Role", value: parsed.data.name },
      ],
      consequences: ["Adds one open role to this team."],
    });
  }

  if (operation === "updateRoleAction") {
    const roleId = uuid(values.roleId);
    const parsed = roleUpdateSchema.safeParse(values);
    if (
      !roleId ||
      !parsed.success ||
      !exactBoolean(values.isLeadershipRole) ||
      Object.keys(parsed.data).length === 0
    )
      return null;
    const role = await rawRow("team_roles", actor.plantId, roleId);
    if (!role) return null;
    const teamId = String(role.team_id);
    const team = await teamAndFields(actor, teamId);
    if (!team) return null;
    const holderRows = await allRows(
      "team_memberships",
      actor.plantId,
      sql`role_id=${roleId}::uuid and status='active'`
    );
    const roleAfter = updateRow(role, now, {
      name: parsed.data.name,
      description: parsed.data.description,
      is_leadership_role: parsed.data.isLeadershipRole,
      time_commitment: parsed.data.timeCommitment,
      desired_skills: parsed.data.desiredSkills,
      sort_order: parsed.data.sortOrder,
    });
    const mutations: Mutation[] = [
      mutation("team_roles", roleId, role, roleAfter),
    ];
    const expected: Snapshot[] = [
      snapshot("team_roles", roleId, role),
      snapshot("ministry_teams", teamId, team),
      ...holderRows.map((row) =>
        snapshot("team_memberships", String(row.id), row)
      ),
    ];
    if (
      holderRows[0] &&
      role.is_leadership_role !== roleAfter.is_leadership_role
    ) {
      const personId = String(holderRows[0].person_id);
      if (roleAfter.is_leadership_role === true) {
        if (team.leader_id === null)
          mutations.push(
            mutation(
              "ministry_teams",
              teamId,
              team,
              updateRow(team, now, { leader_id: personId })
            )
          );
        const person = await rawRow("persons", actor.plantId, personId);
        if (person) {
          if (person.deleted_at === null) {
            const status = statusEffects({
              actor,
              person,
              now,
              teamId,
              roleId,
              member: false,
              leader: true,
            });
            expected.push(...status.expected);
            mutations.push(...status.mutations);
          } else {
            expected.push(snapshot("persons", personId, person));
          }
        }
      }
      if (roleAfter.is_leadership_role === false && team.leader_id === personId)
        mutations.push(
          mutation(
            "ministry_teams",
            teamId,
            team,
            updateRow(team, now, { leader_id: null })
          )
        );
    }
    return finish({
      operation,
      expected,
      sets: [set("active_role_memberships", sortedIds(holderRows), roleId)],
      mutations,
      title: "Update team role",
      targets: [
        { label: "Team", value: String(team.name), href: `/teams/${teamId}` },
        { label: "Role", value: String(role.name) },
      ],
      consequences: [
        "Updates the exact role.",
        "A real leadership-role transition may conditionally change the derived team leader.",
      ],
    });
  }

  if (operation === "deleteRoleAction") {
    const roleId = uuid(values.roleId);
    if (!roleId) return null;
    const role = await rawRow("team_roles", actor.plantId, roleId);
    if (!role) return null;
    const teamId = String(role.team_id);
    const [team, memberships] = await Promise.all([
      teamAndFields(actor, teamId),
      allRows("team_memberships", actor.plantId, sql`role_id=${roleId}::uuid`),
    ]);
    if (!team) return null;
    const mutations: Mutation[] = [
      ...memberships.map((row) =>
        mutation("team_memberships", String(row.id), row, null)
      ),
      mutation("team_roles", roleId, role, null),
    ];
    const active = memberships.find(({ status }) => status === "active");
    if (
      role.is_leadership_role === true &&
      active &&
      team.leader_id === active.person_id
    )
      mutations.push(
        mutation(
          "ministry_teams",
          teamId,
          team,
          updateRow(team, now, { leader_id: null })
        )
      );
    return finish({
      operation,
      expected: [
        snapshot("team_roles", roleId, role),
        snapshot("ministry_teams", teamId, team),
        ...memberships.map((row) =>
          snapshot("team_memberships", String(row.id), row)
        ),
      ],
      sets: [set("role_memberships", sortedIds(memberships), roleId)],
      mutations,
      title: "Delete team role and membership history",
      targets: [
        { label: "Team", value: String(team.name), href: `/teams/${teamId}` },
        { label: "Role", value: String(role.name) },
      ],
      consequences: [
        `Hard-deletes the role and ${memberships.length} membership history row${memberships.length === 1 ? "" : "s"}.`,
        "Clears the derived leader only if this leadership seat still owns it.",
      ],
      reversibility: "difficult_to_reverse",
    });
  }

  if (operation === "importRoleTemplatesAction") {
    const teamId = uuid(values.teamId);
    const teamKey = values.teamKey as PredefinedTeamKey | undefined;
    if (
      !teamId ||
      !teamKey ||
      !TEAM_TEMPLATES.some((template) => template.teamKey === teamKey)
    )
      return null;
    const [team, existingRoles] = await Promise.all([
      teamAndFields(actor, teamId),
      allRows("team_roles", actor.plantId, sql`team_id=${teamId}::uuid`),
    ]);
    if (!team || team.template_key !== teamKey) return null;
    const requested = values.roleKeys ? csv(values.roleKeys) : null;
    const templates = getRoleTemplates(teamKey).filter(
      (template) => requested === null || requested.includes(template.key)
    );
    if (
      templates.length === 0 ||
      (requested &&
        requested.some(
          (key) =>
            !getRoleTemplates(teamKey).some((template) => template.key === key)
        ))
    )
      return null;
    const roles = templates.map((role) =>
      newRole({
        actor,
        now,
        teamId,
        name: role.roleName,
        description: role.description,
        isLeadershipRole: role.isLeadership,
        timeCommitment: role.timeCommitment,
        desiredSkills: null,
        sortOrder: role.sortOrder,
      })
    );
    let finalTeam = team;
    const fillExpected: Snapshot[] = [];
    const fillSets: SetAssertion[] = [];
    const fillMutations: Mutation[] = [];
    const seniorIndex = roles.findIndex(({ name }) => name === "Senior Pastor");
    if (teamKey === "senior_pastor" && seniorIndex >= 0 && roles[seniorIndex]) {
      const fill = await leadershipFill({
        actor,
        now,
        team,
        role: roles[seniorIndex]!,
      });
      roles[seniorIndex] = fill.role;
      finalTeam = fill.team;
      fillExpected.push(...fill.expected);
      fillSets.push(...fill.sets);
      fillMutations.push(...fill.mutations);
    }
    const expected = [
      snapshot("ministry_teams", teamId, team),
      ...roles.map((row) => snapshot("team_roles", String(row.id), null)),
      ...fillExpected,
    ];
    const mutations = [
      ...roles.map((row) => mutation("team_roles", String(row.id), null, row)),
      ...(finalTeam !== team
        ? [
            mutation(
              "ministry_teams",
              teamId,
              team,
              updateRow(team, now, { leader_id: finalTeam.leader_id })
            ),
          ]
        : []),
      ...fillMutations,
    ];
    return finish({
      operation,
      expected,
      sets: [set("team_roles", sortedIds(existingRoles), teamId), ...fillSets],
      mutations,
      title: "Import team role templates",
      targets: [
        { label: "Team", value: String(team.name), href: `/teams/${teamId}` },
        ...roles.map((role) => ({ label: "Role", value: String(role.name) })),
      ],
      consequences: [
        `Adds ${roles.length} role template${roles.length === 1 ? "" : "s"}.`,
        "The template key must still match the team's stored identity.",
        "Leadership auto-fill uses the same confirmed Owner-person, membership, leader, People-stage, and Phase Engine semantics as the interface.",
      ],
    });
  }

  if (operation === "initializeResponsibilities") {
    const teamId = uuid(values.teamId);
    if (!teamId) return null;
    const [team, current] = await Promise.all([
      teamAndFields(actor, teamId),
      allRows(
        "team_responsibilities",
        actor.plantId,
        sql`team_id=${teamId}::uuid`
      ),
    ]);
    if (
      !team ||
      team.template_key === null ||
      team.responsibilities_seeded_at !== null
    )
      return null;
    const teamAfter = updateRow(team, now, {
      responsibilities_seeded_at: iso(now),
    });
    const rows = playbookResponsibilities(
      team.template_key as PredefinedTeamKey
    ).map((title, index) =>
      asRaw({
        id: randomUUID(),
        church_id: actor.plantId,
        team_id: teamId,
        title,
        sort_order: index,
        completed_at: null,
        created_by: actor.userId,
        created_at: iso(now),
        updated_at: iso(now),
      })
    );
    const mutations = [
      mutation("ministry_teams", teamId, team, teamAfter),
      ...rows.map((row) =>
        mutation("team_responsibilities", String(row.id), null, row)
      ),
    ];
    return finish({
      operation,
      expected: [
        snapshot("ministry_teams", teamId, team),
        ...rows.map((row) =>
          snapshot("team_responsibilities", String(row.id), null)
        ),
      ],
      sets: [set("team_responsibilities", sortedIds(current), teamId)],
      mutations,
      title: "Initialize team responsibilities",
      targets: [
        {
          label: "Team",
          value: String(team.name),
          href: `/teams/${teamId}/responsibilities`,
        },
      ],
      consequences: [
        `Claims the one-time playbook seed and creates ${rows.length} ordinary responsibility rows atomically.`,
        "Deleted or edited seeded rows will never be restored by a later read.",
      ],
    });
  }

  if (operation === "createResponsibilityAction") {
    const teamId = uuid(values.teamId);
    const parsed = responsibilitySchema.safeParse(values);
    if (!teamId || !parsed.success) return null;
    const team = await teamAndFields(actor, teamId);
    if (!team) return null;
    const row = asRaw({
      id: randomUUID(),
      church_id: actor.plantId,
      team_id: teamId,
      title: parsed.data.title,
      sort_order: 1000,
      completed_at: null,
      created_by: actor.userId,
      created_at: iso(now),
      updated_at: iso(now),
    });
    const id = String(row.id);
    return finish({
      operation,
      expected: [
        snapshot("ministry_teams", teamId, team),
        snapshot("team_responsibilities", id, null),
      ],
      mutations: [mutation("team_responsibilities", id, null, row)],
      title: "Add team responsibility",
      targets: [
        {
          label: "Team",
          value: String(team.name),
          href: `/teams/${teamId}/responsibilities`,
        },
        { label: "Responsibility", value: parsed.data.title },
      ],
      consequences: [
        "Adds one incomplete responsibility at the end of the team checklist.",
      ],
    });
  }

  if (
    operation === "updateResponsibilityAction" ||
    operation === "setResponsibilityCompleteAction" ||
    operation === "deleteResponsibilityAction"
  ) {
    const responsibilityId = uuid(values.responsibilityId);
    if (!responsibilityId) return null;
    const before = await rawRow(
      "team_responsibilities",
      actor.plantId,
      responsibilityId
    );
    if (!before) return null;
    let after: RawRow | null;
    if (operation === "deleteResponsibilityAction") after = null;
    else if (operation === "updateResponsibilityAction") {
      const parsed = responsibilitySchema.safeParse(values);
      if (!parsed.success) return null;
      after = updateRow(before, now, { title: parsed.data.title });
    } else {
      if (values.completed !== "true" && values.completed !== "false")
        return null;
      after = updateRow(before, now, {
        completed_at: values.completed === "true" ? iso(now) : null,
      });
    }
    return finish({
      operation,
      expected: [snapshot("team_responsibilities", responsibilityId, before)],
      mutations: [
        mutation("team_responsibilities", responsibilityId, before, after),
      ],
      title:
        operation === "deleteResponsibilityAction"
          ? "Delete team responsibility"
          : operation === "updateResponsibilityAction"
            ? "Update team responsibility"
            : "Update responsibility completion",
      targets: [
        {
          label: "Responsibility",
          value: String(before.title),
          href: `/teams/${before.team_id}/responsibilities`,
        },
      ],
      consequences: [
        after
          ? "Updates the exact responsibility row."
          : "Hard-deletes this responsibility.",
      ],
      reversibility: after ? "reversible" : "difficult_to_reverse",
    });
  }

  if (operation === "assignMemberAction") {
    const teamId = uuid(values.teamId);
    const roleId = uuid(values.roleId);
    const parsed = memberAssignSchema.safeParse(values);
    if (
      !teamId ||
      !roleId ||
      !parsed.success ||
      !exactCalendarDate(values.startDate)
    )
      return null;
    const personId = parsed.data.personId;
    const [team, role, person, active, history, church] = await Promise.all([
      teamAndFields(actor, teamId),
      rawRow("team_roles", actor.plantId, roleId),
      rawRow("persons", actor.plantId, personId),
      allRows(
        "team_memberships",
        actor.plantId,
        sql`role_id=${roleId}::uuid and status='active'`
      ),
      allRows(
        "team_memberships",
        actor.plantId,
        sql`team_id=${teamId}::uuid and role_id=${roleId}::uuid and person_id=${personId}::uuid`
      ),
      rawRow("churches", actor.plantId, actor.plantId),
    ]);
    if (
      !team ||
      !role ||
      role.team_id !== teamId ||
      !person ||
      person.deleted_at !== null ||
      !church ||
      active.length > 0
    )
      return null;
    const membershipBefore =
      history
        .filter(({ status }) => status === "inactive")
        .toSorted(
          (left, right) =>
            String(right.created_at).localeCompare(String(left.created_at)) ||
            String(right.id).localeCompare(String(left.id))
        )[0] ?? null;
    const membershipId = membershipBefore
      ? String(membershipBefore.id)
      : randomUUID();
    const membershipAfter = membershipBefore
      ? updateRow(membershipBefore, now, {
          start_date: parsed.data.startDate ?? null,
          end_date: null,
          status: "active",
        })
      : asRaw({
          id: membershipId,
          church_id: actor.plantId,
          team_id: teamId,
          person_id: personId,
          role_id: roleId,
          start_date: parsed.data.startDate ?? null,
          end_date: null,
          status: "active",
          notes: null,
          created_by: actor.userId,
          created_at: iso(now),
          updated_at: iso(now),
        });
    const teamAfter =
      role.is_leadership_role === true && team.leader_id === null
        ? updateRow(team, now, { leader_id: personId })
        : team;
    const status = statusEffects({
      actor,
      person,
      now,
      teamId,
      roleId,
      member: true,
      leader: role.is_leadership_role === true,
    });
    const churchAfter = updateRow(church, now, {
      last_material_event_at: iso(now),
    });
    const mutations = [
      mutation(
        "team_memberships",
        membershipId,
        membershipBefore,
        membershipAfter
      ),
      mutation(
        "team_roles",
        roleId,
        role,
        updateRow(role, now, { status: "filled" })
      ),
      ...(teamAfter !== team
        ? [mutation("ministry_teams", teamId, team, teamAfter)]
        : []),
      ...status.mutations,
      mutation("churches", actor.plantId, church, churchAfter),
    ];
    return finish({
      operation,
      expected: [
        snapshot("ministry_teams", teamId, team),
        snapshot("team_roles", roleId, role),
        ...(history.length > 0
          ? history.map((row) =>
              snapshot("team_memberships", String(row.id), row)
            )
          : [snapshot("team_memberships", membershipId, null)]),
        snapshot("churches", actor.plantId, church),
        ...status.expected,
      ],
      sets: [
        set("active_role_memberships", sortedIds(active), roleId),
        set("person_role_memberships", sortedIds(history), roleId, personId),
      ],
      mutations,
      title: "Assign team member",
      targets: [
        { label: "Team", value: String(team.name), href: `/teams/${teamId}` },
        { label: "Role", value: String(role.name) },
        {
          label: "Person",
          value: `${person.first_name} ${person.last_name}`,
          href: `/people/${personId}`,
        },
      ],
      consequences: [
        "Occupies the role with one active membership and marks the role filled.",
        "Reactivates the latest prior membership for this person and role, when one exists.",
        "Preserves the one-active-holder database invariant.",
        "Applies canonical People stage advancement and Phase Engine dirtiness in the same confirmed effect.",
      ],
    });
  }

  if (operation === "removeMemberAction") {
    const membershipId = uuid(values.membershipId);
    if (!membershipId) return null;
    const membership = await rawRow(
      "team_memberships",
      actor.plantId,
      membershipId
    );
    if (!membership) return null;
    const teamId = String(membership.team_id);
    const roleId = String(membership.role_id);
    const [team, role] = await Promise.all([
      teamAndFields(actor, teamId),
      rawRow("team_roles", actor.plantId, roleId),
    ]);
    if (!team || !role || membership.status !== "active") return null;
    const mutations = [
      mutation(
        "team_memberships",
        membershipId,
        membership,
        updateRow(membership, now, {
          status: "inactive",
          end_date: toCalendarDate(now),
        })
      ),
      mutation(
        "team_roles",
        roleId,
        role,
        updateRow(role, now, { status: "open" })
      ),
    ];
    if (
      role.is_leadership_role === true &&
      team.leader_id === membership.person_id
    )
      mutations.push(
        mutation(
          "ministry_teams",
          teamId,
          team,
          updateRow(team, now, { leader_id: null })
        )
      );
    return finish({
      operation,
      expected: [
        snapshot("team_memberships", membershipId, membership),
        snapshot("team_roles", roleId, role),
        snapshot("ministry_teams", teamId, team),
      ],
      sets: [set("active_role_memberships", [membershipId], roleId)],
      mutations,
      title: "Remove team member",
      targets: [
        { label: "Team", value: String(team.name), href: `/teams/${teamId}` },
        { label: "Role", value: String(role.name) },
      ],
      consequences: [
        "Retains the membership as inactive history, records the end date, and reopens the role.",
        "Clears the leader only when this leadership membership still owns it.",
      ],
      reversibility: "difficult_to_reverse",
    });
  }

  if (operation === "createTrainingProgramAction") {
    const parsed = trainingProgramCreateSchema.safeParse(values);
    if (!parsed.success || !exactBoolean(values.isRequired)) return null;
    const team = parsed.data.teamId
      ? await teamAndFields(actor, parsed.data.teamId)
      : null;
    if (parsed.data.teamId && !team) return null;
    const row = asRaw({
      id: randomUUID(),
      church_id: actor.plantId,
      team_id: parsed.data.teamId ?? null,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      is_required: parsed.data.isRequired ?? false,
      created_by: actor.userId,
      created_at: iso(now),
      updated_at: iso(now),
    });
    const id = String(row.id);
    return finish({
      operation,
      expected: [
        ...(team ? [snapshot("ministry_teams", String(team.id), team)] : []),
        snapshot("training_programs", id, null),
      ],
      mutations: [mutation("training_programs", id, null, row)],
      title: "Create training program",
      targets: [
        {
          label: team ? "Team training" : "Church-wide training",
          value: team ? String(team.name) : parsed.data.name,
          href: team ? `/teams/${team.id}/training` : "/teams",
        },
      ],
      consequences: [
        "Creates one training program with its required/optional setting.",
      ],
    });
  }

  if (operation === "markTrainingCompleteAction") {
    const parsed = trainingCompleteSchema.safeParse(values);
    if (!parsed.success) return null;
    const [person, program, existing] = await Promise.all([
      rawRow("persons", actor.plantId, parsed.data.personId),
      rawRow("training_programs", actor.plantId, parsed.data.programId),
      allRows(
        "training_completions",
        actor.plantId,
        sql`person_id=${parsed.data.personId}::uuid and training_program_id=${parsed.data.programId}::uuid`
      ),
    ]);
    if (
      !person ||
      person.deleted_at !== null ||
      !program ||
      existing.length > 0
    )
      return null;
    const row = asRaw({
      id: randomUUID(),
      church_id: actor.plantId,
      person_id: parsed.data.personId,
      training_program_id: parsed.data.programId,
      completed_at: iso(now),
      verified_by: actor.userId,
      notes: null,
      created_by: actor.userId,
      created_at: iso(now),
      updated_at: iso(now),
    });
    const id = String(row.id);
    return finish({
      operation,
      expected: [
        snapshot("persons", parsed.data.personId, person),
        snapshot("training_programs", parsed.data.programId, program),
        snapshot("training_completions", id, null),
      ],
      sets: [
        set(
          "training_completion_pair",
          [],
          parsed.data.personId,
          parsed.data.programId
        ),
      ],
      mutations: [mutation("training_completions", id, null, row)],
      title: "Mark training complete",
      targets: [
        {
          label: "Person",
          value: `${person.first_name} ${person.last_name}`,
          href: `/people/${person.id}`,
        },
        { label: "Program", value: String(program.name) },
      ],
      consequences: [
        "Creates the unique verified person/program completion fact.",
      ],
    });
  }

  if (operation === "createMeetingAction") {
    const teamId = uuid(values.teamId);
    if (!teamId) return null;
    const parsed = meetingCreateSchema.safeParse({
      ...values,
      type: "team_meeting",
      teamId,
    });
    if (!parsed.success) return null;
    const [team, memberships, corePeople] = await Promise.all([
      teamAndFields(actor, teamId),
      allRows(
        "team_memberships",
        actor.plantId,
        sql`team_id=${teamId}::uuid and status='active'`
      ),
      allRows(
        "persons",
        actor.plantId,
        sql`deleted_at is null and status in ('core_group','launch_team','leader')`
      ),
    ]);
    if (!team) return null;
    const personIds = [
      ...new Set(memberships.map(({ person_id }) => String(person_id))),
    ];
    const people = await Promise.all(
      personIds.map((id) => rawRow("persons", actor.plantId, id))
    );
    if (people.some((person) => !person || person.deleted_at !== null))
      return null;
    const location = parsed.data.locationId
      ? await rawRow("locations", actor.plantId, parsed.data.locationId)
      : null;
    if (parsed.data.locationId && !location) return null;
    const locationRow =
      !parsed.data.locationId && parsed.data.locationName
        ? asRaw({
            id: randomUUID(),
            church_id: actor.plantId,
            name: parsed.data.locationName,
            address: parsed.data.locationAddress ?? "",
            contact_name: null,
            contact_phone: null,
            contact_email: null,
            cost: null,
            capacity: null,
            notes: null,
            is_active: true,
            created_at: iso(now),
            updated_at: iso(now),
          })
        : null;
    const meetingId = randomUUID();
    const suppliedAgenda = parseAgenda(parsed.data.agenda);
    const agenda =
      suppliedAgenda.length > 0
        ? suppliedAgenda
        : sectionsFromTemplates(defaultAgendaTemplatesForType("team_meeting"));
    const meeting = asRaw({
      id: meetingId,
      church_id: actor.plantId,
      type: "team_meeting",
      title: parsed.data.title ?? null,
      datetime: parsed.data.datetime.toISOString(),
      status: "planning",
      location_id: location ? location.id : (locationRow?.id ?? null),
      location_name: location
        ? location.name
        : (parsed.data.locationName ?? null),
      location_address: location
        ? location.address
        : (parsed.data.locationAddress ?? null),
      meeting_number: null,
      team_id: teamId,
      meeting_subtype: parsed.data.meetingSubtype ?? null,
      estimated_attendance: parsed.data.estimatedAttendance ?? null,
      actual_attendance: null,
      duration_minutes: parsed.data.durationMinutes ?? null,
      notes: parsed.data.notes ?? null,
      agenda,
      created_by: actor.userId,
      created_at: iso(now),
      updated_at: iso(now),
    });
    const guests = people.filter(Boolean).map((person) =>
      asRaw({
        id: randomUUID(),
        church_id: actor.plantId,
        meeting_id: meetingId,
        person_id: person!.id,
        attendance_type: null,
        status: "absent",
        invited_by_id: null,
        response_status: null,
        notes: null,
        created_by: actor.userId,
        created_at: iso(now),
        updated_at: iso(now),
      })
    );
    const [coreUsers, teamUsers] = await Promise.all([
      coreGroupUserIdsQuery(actor.plantId),
      personIds.length === 0
        ? Promise.resolve([])
        : personUserIdsQuery(actor.plantId, personIds),
    ]);
    const reminderIds = [
      ...new Set([
        ...teamUsers.map(({ userId }) => String(userId)),
        actor.userId,
      ]),
    ].toSorted();
    const planned = planMeetingNotifications(
      {
        id: meetingId,
        churchId: actor.plantId,
        type: "team_meeting",
        title: parsed.data.title ?? null,
        datetime: parsed.data.datetime,
        status: "planning",
        meetingNumber: null,
        teamName: String(team.name),
        createdBy: actor.userId,
      },
      {
        coreGroup: coreUsers.map(({ userId }) => String(userId)),
        reminders: reminderIds,
      },
      now
    );
    const rows: [Table, RawRow][] = [
      ...(locationRow ? [["locations", locationRow] as [Table, RawRow]] : []),
      ["church_meetings", meeting],
      ...guests.map((row) => ["meeting_attendance", row] as [Table, RawRow]),
    ];
    const expectedPeople = [
      ...new Map(
        [...people.filter(Boolean), ...corePeople].map((row) => [
          String(row!.id),
          row!,
        ])
      ).values(),
    ];
    return finish({
      operation,
      expected: [
        snapshot("ministry_teams", teamId, team),
        ...(location
          ? [snapshot("locations", String(location.id), location)]
          : []),
        ...memberships.map((row) =>
          snapshot("team_memberships", String(row.id), row)
        ),
        ...expectedPeople.map((row) =>
          snapshot("persons", String(row.id), row)
        ),
        ...rows.map(([tableName, row]) =>
          snapshot(tableName, String(row.id), null)
        ),
      ],
      sets: [
        set("team_active_memberships", sortedIds(memberships), teamId),
        set("core_group_people", sortedIds(corePeople)),
        set(
          "core_group_users",
          coreUsers.map(({ userId }) => String(userId))
        ),
        set(
          "active_team_users",
          teamUsers.map(({ userId }) => String(userId)),
          teamId
        ),
      ],
      mutations: rows.map(([tableName, row]) =>
        mutation(tableName, String(row.id), null, row)
      ),
      notificationIntents: planned.notifications.map((notification) => ({
        recipientUserId: notification.recipientUserId,
        type: notification.type,
        scheduledFor: (notification.scheduledFor ?? now).toISOString(),
      })),
      title: "Schedule team meeting",
      targets: [
        {
          label: "Team",
          value: String(team.name),
          href: `/teams/${teamId}/meetings`,
        },
        {
          label: "Meeting",
          value: parsed.data.title ?? "Team meeting",
          href: `/meetings/${meetingId}`,
        },
      ],
      consequences: [
        `Creates the meeting${locationRow ? ", ad hoc location" : ""} and ${guests.length} roster guest rows, then best-effort syncs ${planned.notifications.length} disclosed notification intents through F11.`,
        parsed.data.meetingSubtype === "training"
          ? "Classifies the meeting as training for the same exact roster."
          : "Uses the unified Meetings reminder schedule.",
        "Any roster, audience, target, seat, or row drift refuses the durable meeting statement; notification delivery eligibility is freshly gated after commit.",
      ],
      counts: [
        { label: "Database rows", count: rows.length },
        {
          label: "Notification intents",
          count: planned.notifications.length,
        },
      ],
      dateTime: {
        instantUtc: parsed.data.datetime.toISOString(),
        timeZone: APP_TIME_ZONE,
      },
    });
  }

  return null;
}

async function currentSetIds(
  plantId: string,
  assertion: SetAssertion
): Promise<string[]> {
  const scopeId = assertion.scopeId;
  const otherId = assertion.otherId;
  switch (assertion.kind) {
    case "church_teams":
      return sortedIds(await allRows("ministry_teams", plantId, sql`true`));
    case "team_roles":
      return scopeId
        ? sortedIds(
            await allRows("team_roles", plantId, sql`team_id=${scopeId}::uuid`)
          )
        : [];
    case "team_active_memberships":
      return scopeId
        ? sortedIds(
            await allRows(
              "team_memberships",
              plantId,
              sql`team_id=${scopeId}::uuid and status='active'`
            )
          )
        : [];
    case "team_responsibilities":
      return scopeId
        ? sortedIds(
            await allRows(
              "team_responsibilities",
              plantId,
              sql`team_id=${scopeId}::uuid`
            )
          )
        : [];
    case "team_training_programs":
      return scopeId
        ? sortedIds(
            await allRows(
              "training_programs",
              plantId,
              sql`team_id=${scopeId}::uuid or team_id is null`
            )
          )
        : [];
    case "team_meetings":
      return scopeId
        ? sortedIds(
            await allRows(
              "church_meetings",
              plantId,
              sql`team_id=${scopeId}::uuid`
            )
          )
        : [];
    case "active_role_memberships":
      return scopeId
        ? sortedIds(
            await allRows(
              "team_memberships",
              plantId,
              sql`role_id=${scopeId}::uuid and status='active'`
            )
          )
        : [];
    case "role_memberships":
      return scopeId
        ? sortedIds(
            await allRows(
              "team_memberships",
              plantId,
              sql`role_id=${scopeId}::uuid`
            )
          )
        : [];
    case "person_role_memberships":
      return scopeId && otherId
        ? sortedIds(
            await allRows(
              "team_memberships",
              plantId,
              sql`role_id=${scopeId}::uuid and person_id=${otherId}::uuid`
            )
          )
        : [];
    case "active_person_team_memberships":
      return scopeId && otherId
        ? sortedIds(
            await allRows(
              "team_memberships",
              plantId,
              sql`person_id=${scopeId}::uuid and team_id=${otherId}::uuid and status='active'`
            )
          )
        : [];
    case "training_completion_pair":
      return scopeId && otherId
        ? sortedIds(
            await allRows(
              "training_completions",
              plantId,
              sql`person_id=${scopeId}::uuid and training_program_id=${otherId}::uuid`
            )
          )
        : [];
    case "core_group_people":
      return sortedIds(
        await allRows(
          "persons",
          plantId,
          sql`deleted_at is null and status in ('core_group','launch_team','leader')`
        )
      );
    case "core_group_users":
      return (await coreGroupUserIdsQuery(plantId))
        .map(({ userId }) => String(userId))
        .toSorted();
    case "active_team_users": {
      if (!scopeId) return [];
      const memberships = await allRows(
        "team_memberships",
        plantId,
        sql`team_id=${scopeId}::uuid and status='active'`
      );
      const personIds = [
        ...new Set(memberships.map(({ person_id }) => String(person_id))),
      ];
      if (personIds.length === 0) return [];
      return (await personUserIdsQuery(plantId, personIds))
        .map(({ userId }) => String(userId))
        .toSorted();
    }
    case "confirmed_owner_people":
      return (
        await queryRows(
          sql`select p.id from persons p join users u on u.id=p.user_id and u.church_id=p.church_id join churches c on c.id=p.church_id where p.church_id=${plantId}::uuid and p.deleted_at is null and u.seat='owner' and c.leadership_status='planter_confirmed' order by p.id`
        )
      )
        .map(({ id }) => String(id))
        .toSorted();
  }
}

/** Read-only resume gate; the executor repeats these predicates atomically. */
export async function teamsEffectArgumentsAreCurrent(input: {
  plantId: string;
  operation: TeamsEffectOperation;
  arguments: unknown;
}): Promise<boolean> {
  let args: TeamsEffectArguments;
  try {
    args = parseTeamsEffectArguments(input.operation, input.arguments);
  } catch {
    return false;
  }
  for (const expected of args.expected) {
    const current = await rawRow(expected.table, input.plantId, expected.id);
    if (JSON.stringify(current) !== JSON.stringify(expected.state))
      return false;
  }
  for (const assertion of args.sets) {
    if (
      JSON.stringify(await currentSetIds(input.plantId, assertion)) !==
      JSON.stringify(assertion.ids)
    )
      return false;
  }
  return true;
}
