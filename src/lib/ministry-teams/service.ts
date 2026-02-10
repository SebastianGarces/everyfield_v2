import { db } from "@/db";
import {
  ministryTeams,
  teamRoles,
  teamMemberships,
  churchMeetings,
  meetingAttendance,
  trainingPrograms,
  trainingCompletions,
  persons,
  type MinistryTeam,
  type NewMinistryTeam,
  type TeamRole,
  type NewTeamRole,
  type TeamMembership,
  type NewTeamMembership,
  type TrainingProgram,
  type NewTrainingProgram,
  type TrainingCompletion,
  type NewTrainingCompletion,
  type MembershipStatus,
  type RoleStatus,
  type TeamStatus,
  type TeamType,
  type TimeCommitment,
} from "@/db/schema";
import { and, desc, eq, inArray, sql, asc, isNull } from "drizzle-orm";
import {
  emitTeamMemberAssigned,
  emitTeamLeaderAssigned,
  emitTeamStaffingChanged,
} from "./events";
import {
  TEAM_TEMPLATES,
  getRoleTemplates,
  type PredefinedTeamKey,
} from "./role-templates";

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
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
    } | null;
  })[];
}

export interface PersonTeamAssignment {
  membershipId: string;
  teamId: string;
  teamName: string;
  roleId: string;
  roleName: string;
  status: MembershipStatus;
  startDate: string | null;
}

export interface StaffingSummary {
  totalTeams: number;
  totalRoles: number;
  filledRoles: number;
  staffingPercentage: number;
}

export interface TeamHealthMetrics {
  teamId: string;
  teamName: string;
  staffingPercent: number;
  trainingPercent: number;
  meetingAttendancePercent: number;
  engagementScore: number;
  alertLevel: "green" | "yellow" | "red";
}

export interface TrainingMatrixRow {
  personId: string;
  personName: string;
  completions: Record<string, boolean>;
}

// ============================================================================
// Team Queries
// ============================================================================

/**
 * List all teams for a church with staffing stats.
 * Uses batch queries instead of N+1 loops.
 */
export async function listTeams(
  churchId: string
): Promise<TeamWithStats[]> {
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
      and(
        eq(teamRoles.churchId, churchId),
        inArray(teamRoles.teamId, teamIds)
      )
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
        and(
          eq(persons.churchId, churchId),
          inArray(persons.id, leaderIds)
        )
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
      leaderName: team.leaderId ? leaderMap.get(team.leaderId) ?? null : null,
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
    .where(
      and(eq(teamRoles.churchId, churchId), eq(teamRoles.teamId, teamId))
    )
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
    { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }
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
    const assignedPerson = membership
      ? personMap.get(membership.personId) ?? null
      : null;
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
      .where(
        and(eq(persons.id, team.leaderId), eq(persons.churchId, churchId))
      )
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
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

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

  const teams: MinistryTeam[] = [];

  for (const template of templates) {
    const [team] = await db
      .insert(ministryTeams)
      .values({
        churchId,
        name: template.teamName,
        type: "predefined" as TeamType,
        description: template.description,
        icon: template.icon,
        phaseIntroduced: "phase_2",
        status: "forming" as TeamStatus,
        sortOrder: template.sortOrder,
        createdBy: userId,
      } satisfies NewMinistryTeam)
      .returning();

    teams.push(team);
  }

  return teams;
}

// ============================================================================
// Role Functions
// ============================================================================

/**
 * List roles for a team
 */
export async function listRoles(
  churchId: string,
  teamId: string
): Promise<TeamRole[]> {
  return db
    .select()
    .from(teamRoles)
    .where(
      and(eq(teamRoles.churchId, churchId), eq(teamRoles.teamId, teamId))
    )
    .orderBy(asc(teamRoles.sortOrder), asc(teamRoles.name));
}

/**
 * Create a role within a team.
 * Verifies the team belongs to the church before inserting.
 */
export async function createRole(
  churchId: string,
  teamId: string,
  userId: string,
  data: {
    name: string;
    description?: string;
    isLeadershipRole?: boolean;
    timeCommitment?: TimeCommitment;
    desiredSkills?: string;
    sortOrder?: number;
  }
): Promise<TeamRole> {
  // Verify team belongs to church
  await verifyTeamOwnership(churchId, teamId);

  const [role] = await db
    .insert(teamRoles)
    .values({
      churchId,
      teamId,
      name: data.name,
      description: data.description ?? null,
      isLeadershipRole: data.isLeadershipRole ?? false,
      timeCommitment: data.timeCommitment ?? null,
      desiredSkills: data.desiredSkills ?? null,
      sortOrder: data.sortOrder ?? 0,
      status: "open" as RoleStatus,
      createdBy: userId,
    } satisfies NewTeamRole)
    .returning();

  // Emit staffing changed event
  const stats = await getTeamStaffingCounts(churchId, teamId);
  await emitTeamStaffingChanged(
    teamId,
    stats.filled,
    stats.total,
    churchId,
    userId
  );

  return role;
}

/**
 * Update a role
 */
export async function updateRole(
  churchId: string,
  roleId: string,
  data: {
    name?: string;
    description?: string;
    isLeadershipRole?: boolean;
    timeCommitment?: TimeCommitment;
    desiredSkills?: string;
    sortOrder?: number;
  }
): Promise<TeamRole> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.isLeadershipRole !== undefined)
    updateData.isLeadershipRole = data.isLeadershipRole;
  if (data.timeCommitment !== undefined)
    updateData.timeCommitment = data.timeCommitment;
  if (data.desiredSkills !== undefined)
    updateData.desiredSkills = data.desiredSkills;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

  const [updated] = await db
    .update(teamRoles)
    .set(updateData)
    .where(and(eq(teamRoles.churchId, churchId), eq(teamRoles.id, roleId)))
    .returning();

  if (!updated) throw new Error("Role not found");
  return updated;
}

/**
 * Delete a role
 */
export async function deleteRole(
  churchId: string,
  roleId: string,
  userId: string
): Promise<void> {
  const [role] = await db
    .select()
    .from(teamRoles)
    .where(and(eq(teamRoles.churchId, churchId), eq(teamRoles.id, roleId)))
    .limit(1);

  if (!role) throw new Error("Role not found");

  await db
    .delete(teamRoles)
    .where(and(eq(teamRoles.churchId, churchId), eq(teamRoles.id, roleId)));

  // Emit staffing changed
  const stats = await getTeamStaffingCounts(churchId, role.teamId);
  await emitTeamStaffingChanged(
    role.teamId,
    stats.filled,
    stats.total,
    churchId,
    userId
  );
}

/**
 * Import role templates from the global template library into a team.
 * When roleKeys is provided, only the matching role templates are imported.
 * When omitted, all roles for the team are imported.
 */
export async function importRoleTemplates(
  churchId: string,
  teamId: string,
  userId: string,
  teamKey: PredefinedTeamKey,
  roleKeys?: string[]
): Promise<TeamRole[]> {
  const allTemplates = getRoleTemplates(teamKey);
  const templates = roleKeys
    ? allTemplates.filter((t) => roleKeys.includes(t.key))
    : allTemplates;

  const roles: TeamRole[] = [];

  for (const template of templates) {
    const [role] = await db
      .insert(teamRoles)
      .values({
        churchId,
        teamId,
        name: template.roleName,
        description: template.description,
        isLeadershipRole: template.isLeadership,
        timeCommitment: template.timeCommitment,
        sortOrder: template.sortOrder,
        status: "open" as RoleStatus,
        createdBy: userId,
      } satisfies NewTeamRole)
      .returning();

    roles.push(role);
  }

  // Emit staffing changed
  const stats = await getTeamStaffingCounts(churchId, teamId);
  await emitTeamStaffingChanged(
    teamId,
    stats.filled,
    stats.total,
    churchId,
    userId
  );

  return roles;
}

// ============================================================================
// Membership Functions
// ============================================================================

/**
 * Assign a person to a team role
 */
export async function assignMember(
  churchId: string,
  teamId: string,
  roleId: string,
  personId: string,
  userId: string,
  startDate?: string
): Promise<TeamMembership> {
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

  // Verify role exists and belongs to team
  const [role] = await db
    .select()
    .from(teamRoles)
    .where(
      and(
        eq(teamRoles.id, roleId),
        eq(teamRoles.churchId, churchId),
        eq(teamRoles.teamId, teamId)
      )
    )
    .limit(1);

  if (!role) throw new Error("Role not found in this team");

  // Check for duplicate active assignment
  const existing = await db
    .select()
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.roleId, roleId),
        eq(teamMemberships.personId, personId),
        eq(teamMemberships.status, "active")
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error("Person is already assigned to this role");
  }

  const [membership] = await db
    .insert(teamMemberships)
    .values({
      churchId,
      teamId,
      personId,
      roleId,
      startDate: startDate ?? null,
      status: "active" as MembershipStatus,
      createdBy: userId,
    } satisfies NewTeamMembership)
    .returning();

  // Mark role as filled
  await db
    .update(teamRoles)
    .set({ status: "filled" as RoleStatus, updatedAt: new Date() })
    .where(and(eq(teamRoles.id, roleId), eq(teamRoles.churchId, churchId)));

  // Emit events
  await emitTeamMemberAssigned(teamId, personId, roleId, churchId, userId);

  // If this is a leadership role, also emit leader assigned event
  if (role.isLeadershipRole) {
    await emitTeamLeaderAssigned(teamId, personId, churchId, userId);
  }

  const stats = await getTeamStaffingCounts(churchId, teamId);
  await emitTeamStaffingChanged(
    teamId,
    stats.filled,
    stats.total,
    churchId,
    userId
  );

  return membership;
}

/**
 * Remove (deactivate) a team membership
 */
export async function removeMember(
  churchId: string,
  membershipId: string,
  userId: string
): Promise<void> {
  const [membership] = await db
    .select()
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.id, membershipId)
      )
    )
    .limit(1);

  if (!membership) throw new Error("Membership not found");

  // Deactivate membership
  await db
    .update(teamMemberships)
    .set({
      status: "inactive" as MembershipStatus,
      endDate: new Date().toISOString().split("T")[0],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.id, membershipId)
      )
    );

  // Mark role as open
  await db
    .update(teamRoles)
    .set({ status: "open" as RoleStatus, updatedAt: new Date() })
    .where(
      and(
        eq(teamRoles.id, membership.roleId),
        eq(teamRoles.churchId, churchId)
      )
    );

  // Emit staffing changed
  const stats = await getTeamStaffingCounts(churchId, membership.teamId);
  await emitTeamStaffingChanged(
    membership.teamId,
    stats.filled,
    stats.total,
    churchId,
    userId
  );
}

/**
 * Get all team assignments for a person (for person profile)
 */
export async function getPersonTeams(
  churchId: string,
  personId: string
): Promise<PersonTeamAssignment[]> {
  const memberships = await db
    .select({
      membershipId: teamMemberships.id,
      teamId: teamMemberships.teamId,
      roleId: teamMemberships.roleId,
      status: teamMemberships.status,
      startDate: teamMemberships.startDate,
    })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.personId, personId),
        eq(teamMemberships.status, "active")
      )
    );

  if (memberships.length === 0) return [];

  // Batch-load team and role names
  const teamIdSet = [...new Set(memberships.map((m) => m.teamId))];
  const roleIdSet = [...new Set(memberships.map((m) => m.roleId))];

  const [teamRows, roleRows] = await Promise.all([
    db
      .select({ id: ministryTeams.id, name: ministryTeams.name })
      .from(ministryTeams)
      .where(inArray(ministryTeams.id, teamIdSet)),
    db
      .select({ id: teamRoles.id, name: teamRoles.name })
      .from(teamRoles)
      .where(inArray(teamRoles.id, roleIdSet)),
  ]);

  const teamNameMap = new Map(teamRows.map((t) => [t.id, t.name]));
  const roleNameMap = new Map(roleRows.map((r) => [r.id, r.name]));

  return memberships.map((m) => ({
    membershipId: m.membershipId,
    teamId: m.teamId,
    teamName: teamNameMap.get(m.teamId) ?? "Unknown",
    roleId: m.roleId,
    roleName: roleNameMap.get(m.roleId) ?? "Unknown",
    status: m.status,
    startDate: m.startDate,
  }));
}

/**
 * Count how many teams a person is actively assigned to (for warnings)
 */
export async function getPersonTeamCount(
  churchId: string,
  personId: string
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(DISTINCT ${teamMemberships.teamId})::int` })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.personId, personId),
        eq(teamMemberships.status, "active")
      )
    );

  return result?.count ?? 0;
}

// ============================================================================
// Training Functions
// ============================================================================

/**
 * List training programs (optionally by team)
 */
export async function listTrainingPrograms(
  churchId: string,
  teamId?: string
): Promise<TrainingProgram[]> {
  const conditions = [eq(trainingPrograms.churchId, churchId)];

  if (teamId) {
    conditions.push(eq(trainingPrograms.teamId, teamId));
  }

  return db
    .select()
    .from(trainingPrograms)
    .where(and(...conditions))
    .orderBy(asc(trainingPrograms.name));
}

/**
 * Create a training program
 */
export async function createTrainingProgram(
  churchId: string,
  userId: string,
  data: {
    name: string;
    description?: string;
    teamId?: string;
    isRequired?: boolean;
  }
): Promise<TrainingProgram> {
  const [program] = await db
    .insert(trainingPrograms)
    .values({
      churchId,
      teamId: data.teamId ?? null,
      name: data.name,
      description: data.description ?? null,
      isRequired: data.isRequired ?? false,
      createdBy: userId,
    } satisfies NewTrainingProgram)
    .returning();

  return program;
}

/**
 * Mark training as complete for a person
 */
export async function markTrainingComplete(
  churchId: string,
  personId: string,
  programId: string,
  userId: string
): Promise<TrainingCompletion> {
  // Check for existing completion
  const existing = await db
    .select()
    .from(trainingCompletions)
    .where(
      and(
        eq(trainingCompletions.churchId, churchId),
        eq(trainingCompletions.personId, personId),
        eq(trainingCompletions.trainingProgramId, programId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error("Training already completed");
  }

  const [completion] = await db
    .insert(trainingCompletions)
    .values({
      churchId,
      personId,
      trainingProgramId: programId,
      completedAt: new Date(),
      verifiedBy: userId,
      createdBy: userId,
    } satisfies NewTrainingCompletion)
    .returning();

  return completion;
}

/**
 * Get training completion matrix for a team (members x programs)
 */
export async function getTrainingMatrix(
  churchId: string,
  teamId: string
): Promise<{ programs: TrainingProgram[]; rows: TrainingMatrixRow[] }> {
  // Get all training programs for this team (or global)
  const programs = await db
    .select()
    .from(trainingPrograms)
    .where(
      and(
        eq(trainingPrograms.churchId, churchId),
        sql`(${trainingPrograms.teamId} = ${teamId} OR ${trainingPrograms.teamId} IS NULL)`
      )
    )
    .orderBy(asc(trainingPrograms.name));

  // Get all active members
  const members = await db
    .select({
      personId: teamMemberships.personId,
    })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.status, "active")
      )
    );

  if (members.length === 0) return { programs, rows: [] };

  const memberPersonIds = members.map((m) => m.personId);

  // Batch-load person names and completions
  const [personRows, allCompletions] = await Promise.all([
    db
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(persons)
      .where(inArray(persons.id, memberPersonIds)),
    db
      .select()
      .from(trainingCompletions)
      .where(
        and(
          eq(trainingCompletions.churchId, churchId),
          inArray(trainingCompletions.personId, memberPersonIds)
        )
      ),
  ]);

  const personNameMap = new Map(
    personRows.map((p) => [p.id, `${p.firstName} ${p.lastName}`])
  );

  // Group completions by personId
  const completionsByPerson = new Map<string, Set<string>>();
  for (const c of allCompletions) {
    const set = completionsByPerson.get(c.personId) ?? new Set();
    set.add(c.trainingProgramId);
    completionsByPerson.set(c.personId, set);
  }

  const rows: TrainingMatrixRow[] = members.map((member) => {
    const completedPrograms =
      completionsByPerson.get(member.personId) ?? new Set();
    const completionMap: Record<string, boolean> = {};
    for (const program of programs) {
      completionMap[program.id] = completedPrograms.has(program.id);
    }
    return {
      personId: member.personId,
      personName: personNameMap.get(member.personId) ?? "Unknown",
      completions: completionMap,
    };
  });

  return { programs, rows };
}

// ============================================================================
// Health / Metrics Functions
// ============================================================================

/**
 * Verify that a team belongs to the specified church.
 * Throws if the team doesn't exist or belongs to a different church.
 */
async function verifyTeamOwnership(
  churchId: string,
  teamId: string
): Promise<void> {
  const [team] = await db
    .select({ id: ministryTeams.id })
    .from(ministryTeams)
    .where(
      and(eq(ministryTeams.id, teamId), eq(ministryTeams.churchId, churchId))
    )
    .limit(1);

  if (!team) {
    throw new Error("Team not found");
  }
}

/**
 * Get staffing counts for a team
 */
async function getTeamStaffingCounts(
  churchId: string,
  teamId: string
): Promise<{ filled: number; total: number }> {
  const roles = await db
    .select()
    .from(teamRoles)
    .where(
      and(eq(teamRoles.churchId, churchId), eq(teamRoles.teamId, teamId))
    );

  const filled = roles.filter((r) => r.status === "filled").length;
  return { filled, total: roles.length };
}

/**
 * Calculate team health metrics
 */
export async function getTeamHealth(
  churchId: string,
  teamId: string
): Promise<TeamHealthMetrics> {
  const [team] = await db
    .select()
    .from(ministryTeams)
    .where(
      and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, teamId))
    )
    .limit(1);

  if (!team) throw new Error("Team not found");

  // Staffing %
  const staffing = await getTeamStaffingCounts(churchId, teamId);
  const staffingPercent =
    staffing.total > 0
      ? Math.round((staffing.filled / staffing.total) * 100)
      : 100;

  // Training %
  const programs = await db
    .select()
    .from(trainingPrograms)
    .where(
      and(
        eq(trainingPrograms.churchId, churchId),
        eq(trainingPrograms.isRequired, true),
        sql`(${trainingPrograms.teamId} = ${teamId} OR ${trainingPrograms.teamId} IS NULL)`
      )
    );

  const members = await db
    .select({ personId: teamMemberships.personId })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.status, "active")
      )
    );

  let trainingPercent = 100;
  const totalRequired = programs.length * members.length;
  if (totalRequired > 0) {
    const memberPersonIds = members.map((m) => m.personId);
    const programIds = programs.map((p) => p.id);

    const [{ completedCount }] = await db
      .select({ completedCount: sql<number>`count(*)::int` })
      .from(trainingCompletions)
      .where(
        and(
          eq(trainingCompletions.churchId, churchId),
          inArray(trainingCompletions.personId, memberPersonIds),
          inArray(trainingCompletions.trainingProgramId, programIds)
        )
      );

    trainingPercent = Math.round(((completedCount ?? 0) / totalRequired) * 100);
  }

  // Meeting attendance (last 4 meetings)
  const recentMeetings = await db
    .select()
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.teamId, teamId)
      )
    )
    .orderBy(desc(churchMeetings.datetime))
    .limit(4);

  let meetingAttendancePercent = 100;
  if (recentMeetings.length > 0 && members.length > 0) {
    let totalAttended = 0;
    let totalExpected = 0;

    for (const meeting of recentMeetings) {
      const attendances = await db
        .select()
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, churchId),
            eq(meetingAttendance.meetingId, meeting.id)
          )
        );

      totalExpected += members.length;
      totalAttended += attendances.filter(
        (a) => a.status === "attended"
      ).length;
    }

    meetingAttendancePercent =
      totalExpected > 0
        ? Math.round((totalAttended / totalExpected) * 100)
        : 100;
  }

  // Engagement score (weighted average)
  const engagementScore = Math.round(
    staffingPercent * 0.4 +
      trainingPercent * 0.35 +
      meetingAttendancePercent * 0.25
  );

  // Alert level
  let alertLevel: "green" | "yellow" | "red" = "green";
  if (staffingPercent < 40) alertLevel = "red";
  else if (staffingPercent < 60 || meetingAttendancePercent < 50)
    alertLevel = "yellow";

  return {
    teamId,
    teamName: team.name,
    staffingPercent,
    trainingPercent,
    meetingAttendancePercent,
    engagementScore,
    alertLevel,
  };
}

/**
 * Get health metrics for all teams (dashboard)
 */
export async function getAllTeamsHealth(
  churchId: string
): Promise<TeamHealthMetrics[]> {
  const teams = await db
    .select()
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId))
    .orderBy(asc(ministryTeams.sortOrder));

  const healthMetrics: TeamHealthMetrics[] = [];

  for (const team of teams) {
    const metrics = await getTeamHealth(churchId, team.id);
    healthMetrics.push(metrics);
  }

  return healthMetrics;
}

/**
 * Get overall staffing summary
 */
export async function getStaffingSummary(
  churchId: string
): Promise<StaffingSummary> {
  const [teamCountResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId));

  const [roleStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      filled: sql<number>`count(*) filter (where ${teamRoles.status} = 'filled')::int`,
    })
    .from(teamRoles)
    .where(eq(teamRoles.churchId, churchId));

  const totalTeams = teamCountResult?.count ?? 0;
  const totalRoles = roleStats?.total ?? 0;
  const filledRoles = roleStats?.filled ?? 0;

  return {
    totalTeams,
    totalRoles,
    filledRoles,
    staffingPercentage:
      totalRoles > 0 ? Math.round((filledRoles / totalRoles) * 100) : 0,
  };
}
