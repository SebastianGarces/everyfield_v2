import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  ministryTeams,
  persons,
  teamMemberships,
  teamRoles,
} from "@/db/schema";
import type { ChartTeam } from "./org-chart-model";

/** Explicit display DTO: no account IDs, storage keys or contact details cross this boundary. */
export async function getOrgChart(churchId: string): Promise<ChartTeam[]> {
  const [teams, roles] = await db.batch([
    db
      .select({
        id: ministryTeams.id,
        name: ministryTeams.name,
        templateKey: ministryTeams.templateKey,
        leaderId: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(ministryTeams)
      .leftJoin(
        persons,
        and(
          eq(persons.id, ministryTeams.leaderId),
          eq(persons.churchId, churchId),
          isNull(persons.deletedAt)
        )
      )
      .where(eq(ministryTeams.churchId, churchId))
      .orderBy(
        asc(ministryTeams.sortOrder),
        asc(ministryTeams.name),
        asc(ministryTeams.id)
      ),
    db
      .select({
        id: teamRoles.id,
        teamId: teamRoles.teamId,
        name: teamRoles.name,
        leadership: teamRoles.isLeadershipRole,
        personId: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(teamRoles)
      .innerJoin(
        ministryTeams,
        and(
          eq(ministryTeams.id, teamRoles.teamId),
          eq(ministryTeams.churchId, churchId)
        )
      )
      .leftJoin(
        teamMemberships,
        and(
          eq(teamMemberships.roleId, teamRoles.id),
          eq(teamMemberships.teamId, teamRoles.teamId),
          eq(teamMemberships.churchId, churchId),
          eq(teamMemberships.status, "active")
        )
      )
      .leftJoin(
        persons,
        and(
          eq(persons.id, teamMemberships.personId),
          eq(persons.churchId, churchId),
          isNull(persons.deletedAt)
        )
      )
      .where(eq(teamRoles.churchId, churchId))
      .orderBy(
        asc(teamRoles.sortOrder),
        asc(teamRoles.name),
        asc(teamRoles.id)
      ),
  ]);
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    templateKey: team.templateKey,
    leader: team.leaderId
      ? { id: team.leaderId, name: `${team.firstName} ${team.lastName}` }
      : null,
    roles: roles
      .filter((role) => role.teamId === team.id)
      .map((role) => ({
        id: role.id,
        name: role.name,
        leadership: role.leadership,
        person: role.personId
          ? { id: role.personId, name: `${role.firstName} ${role.lastName}` }
          : null,
      })),
  }));
}
