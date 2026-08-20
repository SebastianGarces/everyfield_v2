import { db } from "@/db";
import {
  teamRoles,
  type TeamRole,
  type NewTeamRole,
  type RoleStatus,
  type TimeCommitment,
} from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { emitTeamStaffingChanged } from "./events";
import { ExpectedError } from "./expected-error";
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

  // ExpectedError: user copy — surfaced to the planter verbatim (409-6C).
  if (!role) throw new ExpectedError("Role not found");

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
