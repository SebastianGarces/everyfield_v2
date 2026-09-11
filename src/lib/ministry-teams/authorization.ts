import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  ministryTeams,
  persons,
  teamMemberships,
  teamResponsibilities,
  teamRoles,
  trainingPrograms,
  type User,
} from "@/db/schema";
import { holdsSeatFor, SeatRefusalError } from "@/lib/auth/seat-rules";

type TeamViewer = Pick<
  User,
  "id" | "seat" | "churchId" | "sendingChurchId" | "sendingNetworkId"
>;

/** The subject comes from the stored row, never a second client-supplied team id. */
export type TeamWriteTarget =
  | { kind: "team"; id: unknown }
  | { kind: "role" | "membership" | "responsibility"; id: string }
  | { kind: "training-completion"; programId: string; personId: string };

/** AS-006: the person link identifies the leader; the seat still grants the floor. */
export async function mayManageTeam(
  user: TeamViewer,
  teamId: string
): Promise<boolean> {
  if (!holdsSeatFor(user, "teams.own") || !user.churchId) return false;

  const [team] = await db
    .select({ id: ministryTeams.id, leaderUserId: persons.userId })
    .from(ministryTeams)
    .leftJoin(
      persons,
      and(
        eq(persons.id, ministryTeams.leaderId),
        eq(persons.churchId, ministryTeams.churchId),
        isNull(persons.deletedAt)
      )
    )
    .where(
      and(
        eq(ministryTeams.churchId, user.churchId),
        eq(ministryTeams.id, teamId)
      )
    )
    .limit(1);

  return (
    !!team &&
    (holdsSeatFor(user, "teams.write") || team.leaderUserId === user.id)
  );
}

async function targetTeamId(
  churchId: string,
  target: TeamWriteTarget
): Promise<string | null> {
  if (target.kind === "team") {
    const parsed = z.string().uuid().safeParse(target.id);
    return parsed.success ? parsed.data : null;
  }

  if (target.kind === "training-completion") {
    const [row] = await db
      .select({ teamId: trainingPrograms.teamId })
      .from(trainingPrograms)
      .innerJoin(
        teamMemberships,
        and(
          eq(teamMemberships.churchId, trainingPrograms.churchId),
          eq(teamMemberships.teamId, trainingPrograms.teamId),
          eq(teamMemberships.personId, target.personId),
          eq(teamMemberships.status, "active")
        )
      )
      .where(
        and(
          eq(trainingPrograms.churchId, churchId),
          eq(trainingPrograms.id, target.programId)
        )
      )
      .limit(1);
    return row?.teamId ?? null;
  }

  const table = {
    role: teamRoles,
    membership: teamMemberships,
    responsibility: teamResponsibilities,
  }[target.kind];
  const [row] = await db
    .select({ teamId: table.teamId })
    .from(table)
    .where(and(eq(table.churchId, churchId), eq(table.id, target.id)))
    .limit(1);
  return row?.teamId ?? null;
}

export async function requireTeamWrite(
  user: TeamViewer,
  target: TeamWriteTarget
): Promise<void> {
  // Owner/Admin retain the existing service's tenant and input validation.
  if (holdsSeatFor(user, "teams.write")) return;
  if (holdsSeatFor(user, "teams.own") && user.churchId) {
    const teamId = await targetTeamId(user.churchId, target);
    if (teamId && (await mayManageTeam(user, teamId))) return;
  }
  throw new SeatRefusalError("teams.own");
}
