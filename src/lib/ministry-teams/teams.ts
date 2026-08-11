import { db } from "@/db";
import {
  ministryTeams,
  teamRoles,
  teamMemberships,
  persons,
  type MinistryTeam,
  type NewMinistryTeam,
  type TeamRole,
  type TeamStatus,
  type TeamType,
} from "@/db/schema";
import { and, eq, inArray, sql, asc, isNull } from "drizzle-orm";
import { emitTeamLeaderAssigned } from "./events";
import { TEAM_TEMPLATES, type PredefinedTeamKey } from "./role-templates";

// ============================================================================
// Types
// ============================================================================

export interface TeamWithStats extends MinistryTeam {
  filledRoles: number;
  totalRoles: number;
  leaderName: string | null;
}

export interface TeamDetail extends MinistryTeam {
  filledRoles: number;
  totalRoles: number;
  leaderName: string | null;
  roles: (TeamRole & {
    assignedPerson: {
      membershipId: string;
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
    } | null;
  })[];
}

// ============================================================================
// Team Queries
// ============================================================================

/**
 * List all teams for a church with staffing stats.
 * Uses batch queries instead of N+1 loops.
 */
export async function listTeams(churchId: string): Promise<TeamWithStats[]> {
  const teams = await db
    .select()
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId))
    .orderBy(asc(ministryTeams.sortOrder), asc(ministryTeams.name));

  if (teams.length === 0) return [];

  // Batch: get role counts per team
  const teamIds = teams.map((t) => t.id);
  const roleCounts = await db
    .select({
      teamId: teamRoles.teamId,
      total: sql<number>`count(*)::int`,
      filled: sql<number>`count(*) filter (where ${teamRoles.status} = 'filled')::int`,
    })
    .from(teamRoles)
    .where(
      and(eq(teamRoles.churchId, churchId), inArray(teamRoles.teamId, teamIds))
    )
    .groupBy(teamRoles.teamId);

  const roleCountMap = new Map(
    roleCounts.map((r) => [r.teamId, { total: r.total, filled: r.filled }])
  );

  // Batch: get leader names
  const leaderIds = teams
    .map((t) => t.leaderId)
    .filter((id): id is string => id !== null);
  const leaderMap = new Map<string, string>();
  if (leaderIds.length > 0) {
    const leaders = await db
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(persons)
      .where(
        and(eq(persons.churchId, churchId), inArray(persons.id, leaderIds))
      );
    for (const l of leaders) {
      leaderMap.set(l.id, `${l.firstName} ${l.lastName}`);
    }
  }

  return teams.map((team) => {
    const counts = roleCountMap.get(team.id) ?? { total: 0, filled: 0 };
    return {
      ...team,
      filledRoles: counts.filled,
      totalRoles: counts.total,
      leaderName: team.leaderId ? (leaderMap.get(team.leaderId) ?? null) : null,
    };
  });
}

/**
 * Get a single team with full detail (roles + assigned members)
 */
export async function getTeam(
  churchId: string,
  teamId: string
): Promise<TeamDetail | null> {
  const [team] = await db
    .select()
    .from(ministryTeams)
    .where(
      and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, teamId))
    )
    .limit(1);

  if (!team) return null;

  // Get all roles for this team
  const roles = await db
    .select()
    .from(teamRoles)
    .where(and(eq(teamRoles.churchId, churchId), eq(teamRoles.teamId, teamId)))
    .orderBy(asc(teamRoles.sortOrder), asc(teamRoles.name));

  // Get active memberships for this team
  const memberships = await db
    .select()
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.status, "active")
      )
    );

  // Batch-load all assigned persons
  const assignedPersonIds = memberships.map((m) => m.personId);
  const personMap = new Map<
    string,
    {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
    }
  >();
  if (assignedPersonIds.length > 0) {
    const assignedPersons = await db
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
        email: persons.email,
        phone: persons.phone,
      })
      .from(persons)
      .where(
        and(
          eq(persons.churchId, churchId),
          inArray(persons.id, assignedPersonIds)
        )
      );
    for (const p of assignedPersons) {
      personMap.set(p.id, p);
    }
  }

  // Map roles with assigned persons
  const rolesWithMembers = roles.map((role) => {
    const membership = memberships.find((m) => m.roleId === role.id);
    const person = membership
      ? (personMap.get(membership.personId) ?? null)
      : null;
    const assignedPerson =
      membership && person ? { membershipId: membership.id, ...person } : null;
    return { ...role, assignedPerson };
  });

  // Compute stats
  const filledRoles = roles.filter((r) => r.status === "filled").length;
  const totalRoles = roles.length;

  let leaderName: string | null = null;
  if (team.leaderId) {
    const [leader] = await db
      .select({
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(persons)
      .where(and(eq(persons.id, team.leaderId), eq(persons.churchId, churchId)))
      .limit(1);
    if (leader) {
      leaderName = `${leader.firstName} ${leader.lastName}`;
    }
  }

  return {
    ...team,
    filledRoles,
    totalRoles,
    leaderName,
    roles: rolesWithMembers,
  };
}

/**
 * Create a custom team
 */
export async function createTeam(
  churchId: string,
  userId: string,
  data: {
    name: string;
    description?: string;
    icon?: string;
  }
): Promise<MinistryTeam> {
  const [team] = await db
    .insert(ministryTeams)
    .values({
      churchId,
      name: data.name,
      type: "custom" as TeamType,
      description: data.description ?? null,
      icon: data.icon ?? null,
      phaseIntroduced: "phase_2",
      status: "forming" as TeamStatus,
      sortOrder: 100, // custom teams sort after predefined
      createdBy: userId,
    } satisfies NewMinistryTeam)
    .returning();

  return team;
}

/**
 * Update a team
 */
export async function updateTeam(
  churchId: string,
  teamId: string,
  data: {
    name?: string;
    description?: string;
    icon?: string;
    status?: TeamStatus;
  }
): Promise<MinistryTeam> {
  const updateData: Partial<NewMinistryTeam> = { updatedAt: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.icon !== undefined) updateData.icon = data.icon;
  if (data.status !== undefined) updateData.status = data.status;

  const [updated] = await db
    .update(ministryTeams)
    .set(updateData)
    .where(
      and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, teamId))
    )
    .returning();

  if (!updated) throw new Error("Team not found");
  return updated;
}

/**
 * Assign a leader to a team
 */
export async function assignTeamLeader(
  churchId: string,
  teamId: string,
  personId: string,
  userId: string
): Promise<MinistryTeam> {
  // Verify person exists
  const [person] = await db
    .select()
    .from(persons)
    .where(
      and(
        eq(persons.id, personId),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
      )
    )
    .limit(1);

  if (!person) throw new Error("Person not found");

  const [updated] = await db
    .update(ministryTeams)
    .set({ leaderId: personId, updatedAt: new Date() })
    .where(
      and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, teamId))
    )
    .returning();

  if (!updated) throw new Error("Team not found");

  // Emit leader assigned event (F2 subscribes to auto-advance launch_team -> leader)
  await emitTeamLeaderAssigned(teamId, personId, churchId, userId);

  return updated;
}

/**
 * Initialize predefined teams for a new church.
 * When teamKeys is provided, only the matching templates are created.
 * When omitted, all 10 predefined teams are created.
 *
 * Returns the teams THIS call created — never the ones that were already there.
 * A caller that needs the plant's full roster reads it back with `listTeams`;
 * the return value answers "what did I just make?", which is what the role
 * import downstream of it needs.
 *
 * THE GUARD LIVES HERE, NOT IN A CALLER (#306, HR4 exit comment 2026-08-09).
 * Two surfaces reach this function — the /teams "Set Up Ministry Teams" dialog
 * and the onboarding finish screen's OB-015 offer — and both used to protect a
 * loop of unconditional inserts with a read ("does this church have teams
 * yet?"). `memory/invariants.md` → Transactions names that shape: SELECT-then-
 * INSERT is not a concurrency guard, and two accepts a few milliseconds apart
 * left a plant with 20 teams and 96 roles. A guard in one caller would not have
 * covered the other either.
 *
 * ONE STATEMENT, NOT TEN. Every row is known up front, so all of them go in a
 * single INSERT: it is atomic without an interactive transaction (which
 * neon-http cannot give us anyway), and — the point of the exercise — the
 * uniqueness claim travels in the SAME statement as the rows it speaks for,
 * exactly as the invariant requires. `ON CONFLICT … DO NOTHING` makes the loser
 * of a race a no-op instead of a duplicate, and makes a re-run against an
 * already-initialized plant a no-op too.
 *
 * *** The `where` predicate and `ministry_teams_predefined_name_unique_idx`
 * change TOGETHER. *** It renders as the ON CONFLICT index_predicate, not as a
 * row filter, and Postgres matches it against the stored predicate literally —
 * a mismatch is not subtle drift, it is "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification" on every initialization.
 * The literal `'predefined'` is inlined rather than parameterised for the same
 * reason: inference matches constants, not bind parameters.
 *
 * THIS FUNCTION STAYS LAST IN THIS FILE. `predefined-teams-guard.test.ts`
 * slices this module's source from this export to the end of the file and
 * asserts the body is ONE insert; a function added below it would land inside
 * that slice and break the assertion's meaning.
 */
export async function initializePredefinedTeams(
  churchId: string,
  userId: string,
  teamKeys?: PredefinedTeamKey[]
): Promise<MinistryTeam[]> {
  const templates = teamKeys
    ? TEAM_TEMPLATES.filter((t) =>
        teamKeys.includes(t.teamKey as PredefinedTeamKey)
      )
    : TEAM_TEMPLATES;

  // An empty selection is a legitimate answer (`teamKeys: []`), and an INSERT
  // with no rows is a runtime error rather than a no-op. Say nothing happened.
  if (templates.length === 0) return [];

  const rows = templates.map(
    (template) =>
      ({
        churchId,
        name: template.teamName,
        type: "predefined" as TeamType,
        description: template.description,
        icon: template.icon,
        phaseIntroduced: "phase_2",
        status: "forming" as TeamStatus,
        sortOrder: template.sortOrder,
        createdBy: userId,
      }) satisfies NewMinistryTeam
  );

  return db
    .insert(ministryTeams)
    .values(rows)
    .onConflictDoNothing({
      target: [ministryTeams.churchId, ministryTeams.name],
      where: sql`${ministryTeams.type} = 'predefined'`,
    })
    .returning();
}
