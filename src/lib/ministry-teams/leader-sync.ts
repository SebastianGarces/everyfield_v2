import { db } from "@/db";
import { ministryTeams, teamMemberships, teamRoles } from "@/db/schema";
import { and, eq, exists, isNull, notExists, sql, type SQL } from "drizzle-orm";

/** First statement in every native role/membership mutation batch. Later
 * statements get a fresh READ COMMITTED snapshot after any lock wait.
 * Always lock the parent team before a role or membership, never in reverse.
 */
export function lockTeamLeadership(churchId: string, teamId: string) {
  return db
    .select({ id: ministryTeams.id })
    .from(ministryTeams)
    .where(
      and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, teamId))
    )
    .for("update");
}

function roleHolder(
  churchId: string,
  teamId: string,
  roleId: string,
  leadership: boolean,
  personId?: string | SQL
) {
  return db
    .select({ personId: teamMemberships.personId })
    .from(teamMemberships)
    .innerJoin(teamRoles, eq(teamRoles.id, teamMemberships.roleId))
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.roleId, roleId),
        eq(teamMemberships.status, "active"),
        eq(teamRoles.churchId, churchId),
        eq(teamRoles.teamId, teamId),
        eq(teamRoles.isLeadershipRole, leadership),
        personId === undefined
          ? undefined
          : eq(teamMemberships.personId, personId)
      )
    );
}

/** Batch statement. Assignment supplies eligibility from its RETURNING CTE so
 * an empty/conflicted membership write cannot create an appointment.
 */
export function fillLeaderStatement(
  churchId: string,
  teamId: string,
  roleId: string,
  personId: string | SQL,
  eligible: SQL
) {
  return db
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
        eligible
      )
    )
    .returning({ id: ministryTeams.id, personId: ministryTeams.leaderId });
}

/** Run before enabling a role, inside the same locked batch. Requiring the
 * current flag to be false prevents a repeated save from appointing a leader.
 */
export function fillOnRoleEnable(
  churchId: string,
  teamId: string,
  roleId: string,
  enabled: boolean
) {
  const holder = roleHolder(churchId, teamId, roleId, false);
  return fillLeaderStatement(
    churchId,
    teamId,
    roleId,
    sql`(${holder})`,
    sql`${enabled} and exists (${holder})`
  );
}

/** Batch statement. Reconcile the stored source, not a pre-read holder. A
 * renewed active derivation survives; a deleted role clears whoever held it.
 */
export function clearVacantRoleLeader(
  churchId: string,
  teamId: string,
  roleId: string,
  personId?: string
) {
  return db
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
        eq(ministryTeams.leaderSource, "role"),
        eq(ministryTeams.leaderRoleId, roleId),
        personId === undefined
          ? undefined
          : eq(ministryTeams.leaderId, personId),
        notExists(
          roleHolder(
            churchId,
            teamId,
            roleId,
            true,
            sql`${ministryTeams.leaderId}`
          )
        )
      )
    )
    .returning({ id: ministryTeams.id });
}

export async function syncLeaderOnFill(
  churchId: string,
  teamId: string,
  personId: string,
  roleId: string
): Promise<boolean> {
  const [, filled] = await db.batch([
    lockTeamLeadership(churchId, teamId),
    fillLeaderStatement(
      churchId,
      teamId,
      roleId,
      personId,
      exists(roleHolder(churchId, teamId, roleId, true, personId))
    ),
  ]);
  return filled.length > 0;
}

export async function syncLeaderOnVacate(
  churchId: string,
  teamId: string,
  personId: string,
  roleId: string
): Promise<boolean> {
  const [, cleared] = await db.batch([
    lockTeamLeadership(churchId, teamId),
    clearVacantRoleLeader(churchId, teamId, roleId, personId),
  ]);
  return cleared.length > 0;
}
