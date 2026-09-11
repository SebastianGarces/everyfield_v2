import { db } from "@/db";
import { ministryTeams, teamMemberships, teamRoles } from "@/db/schema";
import { and, eq, exists, isNull, sql } from "drizzle-orm";

/**
 * Who actively holds a role right now, or null for an open seat.
 *
 * ONE ACTIVE ROW EXISTS AT MOST — `team_memberships_role_active_unique_idx`
 * says so — so this is a point read and not a "first of several".
 */
export async function activeRoleHolder(
  churchId: string,
  roleId: string
): Promise<string | null> {
  const [holder] = await db
    .select({ personId: teamMemberships.personId })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.roleId, roleId),
        eq(teamMemberships.status, "active")
      )
    )
    .limit(1);

  return holder?.personId ?? null;
}

/** Fill from this exact active leadership seat, without replacing a leader.
 * The seat predicate is a snapshot, not a lock against role/membership writers.
 */
export async function syncLeaderOnFill(
  churchId: string,
  teamId: string,
  personId: string,
  roleId: string
): Promise<boolean> {
  const filled = await db
    .update(ministryTeams)
    .set({
      leaderId: personId,
      leaderSource: "role",
      leaderRoleId: roleId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ministryTeams.churchId, churchId),
        eq(ministryTeams.id, teamId),
        isNull(ministryTeams.leaderId),
        exists(
          db
            .select({ one: sql`1` })
            .from(teamMemberships)
            .innerJoin(teamRoles, eq(teamRoles.id, teamMemberships.roleId))
            .where(
              and(
                eq(teamMemberships.churchId, churchId),
                eq(teamMemberships.teamId, teamId),
                eq(teamMemberships.personId, personId),
                eq(teamMemberships.roleId, roleId),
                eq(teamRoles.churchId, churchId),
                eq(teamRoles.teamId, teamId),
                eq(teamRoles.isLeadershipRole, true),
                eq(teamMemberships.status, "active")
              )
            )
        )
      )
    )
    .returning({ id: ministryTeams.id });

  return filled.length > 0;
}

/** Clear only the appointment derived from this person's vacated source role. */
export async function syncLeaderOnVacate(
  churchId: string,
  teamId: string,
  personId: string,
  roleId: string
): Promise<boolean> {
  const cleared = await db
    .update(ministryTeams)
    .set({
      leaderId: null,
      leaderSource: null,
      leaderRoleId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ministryTeams.churchId, churchId),
        eq(ministryTeams.id, teamId),
        eq(ministryTeams.leaderId, personId),
        eq(ministryTeams.leaderSource, "role"),
        eq(ministryTeams.leaderRoleId, roleId)
      )
    )
    .returning({ id: ministryTeams.id });

  return cleared.length > 0;
}
