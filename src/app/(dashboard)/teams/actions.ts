"use server";

// ============================================================================
// The ministry-teams endpoints. Every export here is a POSTable endpoint some
// UI actually calls (memory/invariants.md → Authentication); a read with no
// caller does not get an action at all — server components call the service
// directly. The shared shell — session, error policy, validation plumbing,
// revalidation — lives in ./action-shell.ts.
// ============================================================================

import {
  listTeams,
  createTeam,
  updateTeam,
  assignTeamLeader,
  initializePredefinedTeams,
  createRole,
  updateRole,
  deleteRole,
  importRoleTemplates,
  assignMember,
  removeMember,
  createTrainingProgram,
  markTrainingComplete,
} from "@/lib/ministry-teams/service";
import type { TeamWithStats } from "@/lib/ministry-teams/service";
import { createMeeting as createUnifiedMeeting } from "@/lib/meetings/service";
import type { ChurchMeeting } from "@/lib/meetings/types";
import {
  teamCreateSchema,
  teamUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  memberAssignSchema,
  trainingProgramCreateSchema,
  trainingCompleteSchema,
} from "@/lib/validations/ministry-teams";
import { meetingCreateSchema } from "@/lib/validations/meetings";
import type {
  MinistryTeam,
  TeamRole,
  TeamMembership,
  TrainingProgram,
  TrainingCompletion,
} from "@/db/schema";
import {
  TEAM_TEMPLATES,
  type PredefinedTeamKey,
} from "@/lib/ministry-teams/role-templates";
import { revalidatePath } from "next/cache";
import {
  fieldErrorResult,
  formEntries,
  revalidateTeamSurfaces,
  withChurch,
} from "./action-shell";
import type { ActionResult } from "./action-shell";

// ============================================================================
// Team Actions
// ============================================================================

export async function listTeamsAction(): Promise<
  ActionResult<TeamWithStats[]>
> {
  return withChurch("Failed to load teams", async ({ churchId }) => {
    const teams = await listTeams(churchId);
    return { success: true, data: teams };
  });
}

export async function createTeamAction(
  formData: FormData
): Promise<ActionResult<MinistryTeam>> {
  return withChurch("Failed to create team", async ({ churchId, userId }) => {
    const parsed = teamCreateSchema.safeParse(
      Object.fromEntries(formData.entries())
    );
    if (!parsed.success) return fieldErrorResult(parsed.error);

    const team = await createTeam(churchId, userId, parsed.data);
    revalidateTeamSurfaces();
    return { success: true, data: team };
  });
}

export async function updateTeamAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<MinistryTeam>> {
  return withChurch("Failed to update team", async ({ churchId }) => {
    const parsed = teamUpdateSchema.safeParse(
      Object.fromEntries(formData.entries())
    );
    if (!parsed.success) return fieldErrorResult(parsed.error);

    const team = await updateTeam(churchId, teamId, parsed.data);
    revalidateTeamSurfaces();
    return { success: true, data: team };
  });
}

export async function assignTeamLeaderAction(
  teamId: string,
  personId: string
): Promise<ActionResult<MinistryTeam>> {
  return withChurch("Failed to assign leader", async ({ churchId, userId }) => {
    const team = await assignTeamLeader(churchId, teamId, personId, userId);
    revalidateTeamSurfaces();
    return { success: true, data: team };
  });
}

export async function initializeTeamsAction(
  teamKeys?: PredefinedTeamKey[]
): Promise<ActionResult<MinistryTeam[]>> {
  return withChurch(
    "Failed to initialize teams",
    async ({ churchId, userId }) => {
      const teams = await initializePredefinedTeams(churchId, userId, teamKeys);
      revalidateTeamSurfaces();
      return { success: true, data: teams };
    }
  );
}

/**
 * Said when the teams landed but a role import did not. Names the half that
 * worked, because it is durable and the planter will see it on /teams.
 */
const TEAM_ROLES_PARTIAL_MESSAGE =
  "Your ministry teams were created, but we could not add every role description. You can add the missing ones from the Teams page.";

/**
 * F12 / OB-015 — the onboarding finish screen's one-click offer: the standard
 * ministry teams AND the role descriptions that belong to them.
 *
 * A CALLER, NOT A SECOND WRITE PATH. Everything here is `initializeTeamsAction`
 * and `importRoleTemplatesAction` — the same two actions `/teams` has always
 * used — run back to back, because "the standard teams" and "their roles" are
 * one thought to a planter and two calls to the machinery. No template list,
 * no insert and no notion of what a standard team is lives in this function;
 * add a team to `TEAM_TEMPLATES` and both surfaces get it.
 *
 * The actor is minted inside each of those actions from `verifySession()` — no
 * argument names a user, a church or a team, so a forged POST can only
 * initialize the caller's own plant (`memory/invariants.md` → Authentication).
 *
 * ALREADY-INITIALIZED CHURCHES ARE A NO-OP, TWICE OVER. The read below skips
 * the whole call for a plant that already has teams — including teams the
 * planter made themselves, which is the same question the finish screen asks
 * before offering at all. It is a convenience, NOT the concurrency guard
 * (`memory/invariants.md` → Transactions: SELECT-then-INSERT is not one). The
 * real guard is inside `initializePredefinedTeams`: one INSERT carrying
 * `ON CONFLICT … DO NOTHING` against `ministry_teams_predefined_name_unique_idx`
 * (migration 0034), so two simultaneous accepts produce one set of teams and the
 * loser creates nothing. Both callers of that function are covered, which a
 * guard living here could never manage.
 *
 * The loser's role import is a no-op for free: it iterates the rows this call
 * created, and the loser created none.
 *
 * PARTIAL IS REPORTED, NOT ROLLED BACK. If a role import fails the teams are
 * already real and useful; deleting them to make the call atomic would throw
 * away the half that worked. The planter is told which half landed.
 */
export async function initializeTeamsWithRolesAction(): Promise<
  ActionResult<MinistryTeam[]>
> {
  const existing = await listTeamsAction();
  if (!existing.success) return { success: false, error: existing.error };
  if (existing.data.length > 0) return { success: true, data: [] };

  const created = await initializeTeamsAction();
  if (!created.success) return created;

  // The created rows carry the template's NAME, not its key — the join back to
  // the role templates has to go through it. Both sides come from
  // `TEAM_TEMPLATES` moments apart, so an unmatched name means the template
  // list changed under us: skip that team's roles rather than guess at a key.
  const keyByTeamName = new Map<string, PredefinedTeamKey>(
    TEAM_TEMPLATES.map((template) => [
      template.teamName,
      template.teamKey as PredefinedTeamKey,
    ])
  );

  for (const team of created.data) {
    const teamKey = keyByTeamName.get(team.name);
    if (!teamKey) continue;

    const roles = await importRoleTemplatesAction(team.id, teamKey);
    if (!roles.success) {
      return { success: false, error: TEAM_ROLES_PARTIAL_MESSAGE };
    }
  }

  return { success: true, data: created.data };
}

// ============================================================================
// Role Actions
// ============================================================================

export async function createRoleAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<TeamRole>> {
  return withChurch("Failed to create role", async ({ churchId, userId }) => {
    const parsed = roleCreateSchema.safeParse(formEntries(formData));
    if (!parsed.success) return fieldErrorResult(parsed.error);

    const role = await createRole(churchId, teamId, userId, parsed.data);
    revalidateTeamSurfaces();
    return { success: true, data: role };
  });
}

export async function updateRoleAction(
  roleId: string,
  formData: FormData
): Promise<ActionResult<TeamRole>> {
  return withChurch("Failed to update role", async ({ churchId }) => {
    const parsed = roleUpdateSchema.safeParse(formEntries(formData));
    if (!parsed.success) return fieldErrorResult(parsed.error);

    const role = await updateRole(churchId, roleId, parsed.data);
    revalidateTeamSurfaces();
    return { success: true, data: role };
  });
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult> {
  return withChurch("Failed to delete role", async ({ churchId, userId }) => {
    await deleteRole(churchId, roleId, userId);
    revalidateTeamSurfaces();
    return { success: true, data: undefined };
  });
}

export async function importRoleTemplatesAction(
  teamId: string,
  teamKey: PredefinedTeamKey,
  roleKeys?: string[]
): Promise<ActionResult<TeamRole[]>> {
  return withChurch(
    "Failed to import templates",
    async ({ churchId, userId }) => {
      const roles = await importRoleTemplates(
        churchId,
        teamId,
        userId,
        teamKey,
        roleKeys
      );
      revalidateTeamSurfaces();
      return { success: true, data: roles };
    }
  );
}

// ============================================================================
// Membership Actions
// ============================================================================

export async function assignMemberAction(
  teamId: string,
  roleId: string,
  data: { personId: string; startDate?: string }
): Promise<ActionResult<TeamMembership>> {
  return withChurch("Failed to assign member", async ({ churchId, userId }) => {
    const parsed = memberAssignSchema.safeParse(data);
    if (!parsed.success) return fieldErrorResult(parsed.error);

    const membership = await assignMember(
      churchId,
      teamId,
      roleId,
      parsed.data.personId,
      userId,
      parsed.data.startDate
    );
    revalidateTeamSurfaces();
    return { success: true, data: membership };
  });
}

export async function removeMemberAction(
  membershipId: string
): Promise<ActionResult> {
  return withChurch("Failed to remove member", async ({ churchId, userId }) => {
    await removeMember(churchId, membershipId, userId);
    revalidateTeamSurfaces();
    return { success: true, data: undefined };
  });
}

// ============================================================================
// Meeting Actions (using unified meetings service)
// ============================================================================

export async function createMeetingAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<ChurchMeeting>> {
  return withChurch(
    "Failed to create meeting",
    async ({ churchId, userId }) => {
      const rawData: Record<string, unknown> = formEntries(formData);

      // Inject team meeting type and teamId — real mapping, not coercion.
      rawData.type = "team_meeting";
      rawData.teamId = teamId;
      // Map meetingType to meetingSubtype
      if (rawData.meetingType) {
        rawData.meetingSubtype = rawData.meetingType;
        delete rawData.meetingType;
      }

      const parsed = meetingCreateSchema.safeParse(rawData);
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const meeting = await createUnifiedMeeting(churchId, userId, parsed.data);
      revalidatePath(`/teams/${teamId}/meetings`);
      revalidatePath("/meetings");
      return { success: true, data: meeting };
    }
  );
}

// ============================================================================
// Training Actions
// ============================================================================

export async function createTrainingProgramAction(
  formData: FormData
): Promise<ActionResult<TrainingProgram>> {
  return withChurch(
    "Failed to create program",
    async ({ churchId, userId }) => {
      const parsed = trainingProgramCreateSchema.safeParse(
        formEntries(formData)
      );
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const program = await createTrainingProgram(
        churchId,
        userId,
        parsed.data
      );
      revalidateTeamSurfaces();
      return { success: true, data: program };
    }
  );
}

export async function markTrainingCompleteAction(data: {
  personId: string;
  programId: string;
}): Promise<ActionResult<TrainingCompletion>> {
  return withChurch("Failed to mark complete", async ({ churchId, userId }) => {
    const parsed = trainingCompleteSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: "Validation failed" };
    }

    const completion = await markTrainingComplete(
      churchId,
      parsed.data.personId,
      parsed.data.programId,
      userId
    );
    revalidateTeamSurfaces();
    return { success: true, data: completion };
  });
}
