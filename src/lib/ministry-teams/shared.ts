import { db } from "@/db";
import { ministryTeams, teamRoles } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Verify that a team belongs to the specified church.
 * Throws if the team doesn't exist or belongs to a different church.
 */
export async function verifyTeamOwnership(
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
export async function getTeamStaffingCounts(
  churchId: string,
  teamId: string
): Promise<{ filled: number; total: number }> {
  const roles = await db
    .select()
    .from(teamRoles)
    .where(and(eq(teamRoles.churchId, churchId), eq(teamRoles.teamId, teamId)));

  const filled = roles.filter((r) => r.status === "filled").length;
  return { filled, total: roles.length };
}
