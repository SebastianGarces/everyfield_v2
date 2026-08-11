import { db } from "@/db";
import {
  ministryTeams,
  teamRoles,
  teamMemberships,
  persons,
  type TeamMembership,
  type NewTeamMembership,
  type MembershipStatus,
  type RoleStatus,
} from "@/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  emitTeamMemberAssigned,
  emitTeamLeaderAssigned,
  emitTeamStaffingChanged,
} from "./events";
import { getTeamStaffingCounts } from "./shared";

// ============================================================================
// Types
// ============================================================================

export interface PersonTeamAssignment {
  membershipId: string;
  teamId: string;
  teamName: string;
  roleId: string;
  roleName: string;
  status: MembershipStatus;
  startDate: string | null;
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

  // Look for any existing membership row for this (team, person, role).
  // A row may linger after removeMember sets status='inactive' (the partial
  // unique index only constrains active rows). If an active row exists this is
  // a true duplicate; if an inactive row exists we reactivate it instead of
  // inserting a duplicate (F8 re-assignment fix).
  const [existing] = await db
    .select()
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.roleId, roleId),
        eq(teamMemberships.personId, personId)
      )
    )
    .orderBy(desc(teamMemberships.createdAt))
    .limit(1);

  if (existing && existing.status === "active") {
    throw new Error("Person is already assigned to this role");
  }

  let membership: TeamMembership;
  if (existing) {
    // Reactivate the inactive row: fresh startDate, cleared end fields.
    const [reactivated] = await db
      .update(teamMemberships)
      .set({
        status: "active" as MembershipStatus,
        startDate: startDate ?? null,
        endDate: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teamMemberships.churchId, churchId),
          eq(teamMemberships.id, existing.id)
        )
      )
      .returning();
    membership = reactivated;
  } else {
    const [inserted] = await db
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
    membership = inserted;
  }

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
      and(eq(teamRoles.id, membership.roleId), eq(teamRoles.churchId, churchId))
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
    .select({
      count: sql<number>`count(DISTINCT ${teamMemberships.teamId})::int`,
    })
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
