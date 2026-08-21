import { db } from "@/db";
import {
  teamRoles,
  type TeamRole,
  type NewTeamRole,
  type RoleStatus,
  type TimeCommitment,
} from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { emitTeamLeaderAssigned, emitTeamStaffingChanged } from "./events";
import { ExpectedError } from "./expected-error";
import {
  activeRoleHolder,
  syncLeaderOnFill,
  syncLeaderOnVacate,
} from "./leader-sync";
import { fillLeadershipRole } from "./leadership-fill";
import { getRoleTemplates, type PredefinedTeamKey } from "./role-templates";
import { getTeamStaffingCounts, verifyTeamOwnership } from "./shared";

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
    .where(and(eq(teamRoles.churchId, churchId), eq(teamRoles.teamId, teamId)))
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
 * Update a role.
 *
 * THE LEADERSHIP FLAG IS THE ONE FIELD WITH A CONSEQUENCE OUTSIDE THIS ROW
 * (#311 WS2): a FILLED role that becomes a leadership role names its occupant
 * as the team's leader, and one that stops being a leadership role gives that
 * back — both through `leader-sync.ts`, whose `WHERE` clauses carry the "only
 * when the team has none" and "only when it points at them" halves.
 *
 * IT READS THE FLAG'S NEW VALUE, NOT A BEFORE/AFTER DIFF. Re-asserting the
 * value a role already has is a no-op given those predicates, so there is
 * nothing a diff would save and one fewer read to get wrong. The gate is
 * whether the CALLER SPOKE about the flag: renaming a role must not disturb the
 * header, and `undefined` is exactly "did not mention it".
 */
export async function updateRole(
  churchId: string,
  roleId: string,
  userId: string,
  data: {
    name?: string;
    description?: string;
    isLeadershipRole?: boolean;
    timeCommitment?: TimeCommitment;
    desiredSkills?: string;
    sortOrder?: number;
  }
): Promise<TeamRole> {
  const updateData: Partial<NewTeamRole> = { updatedAt: new Date() };

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

  // ExpectedError: user copy — surfaced to the planter verbatim (409-6C). An
  // id from another church matches nothing, so the tenancy check and the
  // refusal are the same statement.
  if (!updated) throw new ExpectedError("Role not found");

  if (data.isLeadershipRole !== undefined) {
    const holder = await activeRoleHolder(churchId, roleId);
    if (holder) {
      if (updated.isLeadershipRole) {
        await syncLeaderOnFill(churchId, updated.teamId, holder);
        // The same event `assignMember` emits when somebody lands in a
        // leadership seat, on the other door into that state. F2 advances the
        // person's status from it, and `autoAdvanceStatus` moves them only out
        // of `launch_team`, so a repeat is a no-op rather than a demotion.
        await emitTeamLeaderAssigned(updated.teamId, holder, churchId, userId);
      } else {
        await syncLeaderOnVacate(churchId, updated.teamId, holder);
      }
    }
  }

  return updated;
}

/**
 * Delete a role, and with it whoever was sitting in it.
 *
 * THE MEMBERSHIPS GO WITH THE ROLE IN THE SAME STATEMENT, not by the caller
 * deleting them first: `team_memberships.role_id` is `ON DELETE CASCADE`
 * (migration 0008), so one DELETE takes the seat and its history together and
 * there is no ordering for a UI to get wrong. They are HARD-deleted rather than
 * deactivated the way `removeMember` does it — an inactive membership is a
 * record of a role somebody used to hold, and this role is about to stop
 * existing.
 *
 * SO THE HOLDER IS READ BEFORE THE DELETE, because afterwards nothing can say
 * who it was, and a leadership seat owes the team's leader a clear on the way
 * out (#311 WS2 amendment).
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

  // ExpectedError: user copy — surfaced to the planter verbatim (409-6C).
  if (!role) throw new ExpectedError("Role not found");

  const holder = role.isLeadershipRole
    ? await activeRoleHolder(churchId, roleId)
    : null;

  await db
    .delete(teamRoles)
    .where(and(eq(teamRoles.churchId, churchId), eq(teamRoles.id, roleId)));

  // Derived after the fact, for the reason `removeMember` states: a leader that
  // lags the seat is repairable, one that leads it is a lie about a live row.
  if (holder) {
    await syncLeaderOnVacate(churchId, role.teamId, holder);
  }

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
  // The teamId arrives from the client (importRoleTemplatesAction is a public
  // endpoint), so prove it belongs to the caller's church before writing rows
  // that point at it — same rule as createRole above.
  await verifyTeamOwnership(churchId, teamId);

  const allTemplates = getRoleTemplates(teamKey);
  const templates = roleKeys
    ? allTemplates.filter((t) => roleKeys.includes(t.key))
    : allTemplates;

  // An empty selection is a legitimate answer (`roleKeys` matching nothing),
  // and an INSERT with no rows is a runtime error rather than a no-op.
  if (templates.length === 0) return [];

  // ONE statement, not one per template — every row is known up front, so a
  // mid-import failure can no longer leave a team with half its roles
  // (memory/invariants.md → Transactions; initializePredefinedTeams is the
  // precedent one module over).
  const rows = templates.map(
    (template) =>
      ({
        churchId,
        teamId,
        name: template.roleName,
        description: template.description,
        isLeadershipRole: template.isLeadership,
        timeCommitment: template.timeCommitment,
        sortOrder: template.sortOrder,
        status: "open" as RoleStatus,
        createdBy: userId,
      }) satisfies NewTeamRole
  );

  const roles = await db.insert(teamRoles).values(rows).returning();

  // OB-004's answer, applied (#378 WS2). A plant whose `leadership_status` is
  // `planter_confirmed` has already said who the Senior Pastor is, so the role
  // this import just created is filled with them rather than offered back as a
  // question. Runs BEFORE the staffing count below so that count reflects it.
  // Never raises — see `leadership-fill.ts`.
  await fillLeadershipRole(churchId, teamId, userId, teamKey, roles);

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
