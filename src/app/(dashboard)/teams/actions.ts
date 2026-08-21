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
  createResponsibility,
  updateResponsibility,
  deleteResponsibility,
  createTrainingProgram,
  markTrainingComplete,
} from "@/lib/ministry-teams/service";
import { getTeamCountsForPeople } from "@/lib/ministry-teams/service";
import type { TeamWithStats } from "@/lib/ministry-teams/service";
import { listPeople } from "@/lib/people/service";
import type { PersonForClient } from "@/lib/people/types";

/**
 * How many matches the assign dialog shows. A search is a NARROWING — a planter
 * who types three letters and gets fifty rows types a fourth — so this is a cap
 * on the render, not a ceiling on who is findable.
 */
// NOT exported: a "use server" module's export list IS its endpoint surface
// (memory/invariants.md → Authentication), and the repo-wide walk refuses a
// non-function export here by name.
const TEAM_CANDIDATE_SEARCH_LIMIT = 50;
import { createMeeting as createUnifiedMeeting } from "@/lib/meetings/service";
import type { ChurchMeeting } from "@/lib/meetings/types";
import {
  teamCreateSchema,
  teamUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  responsibilitySchema,
  memberAssignSchema,
  trainingProgramCreateSchema,
  trainingCompleteSchema,
} from "@/lib/validations/ministry-teams";
import { meetingCreateSchema } from "@/lib/validations/meetings";
import type {
  MinistryTeam,
  TeamRole,
  TeamMembership,
  TeamResponsibility,
  TrainingProgram,
  TrainingCompletion,
} from "@/db/schema";
import type { PredefinedTeamKey } from "@/lib/ministry-teams/role-templates";
import { revalidatePath } from "next/cache";
import { requireSeat } from "@/lib/auth/seats";
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
  return withChurch("read", "Failed to load teams", async ({ churchId }) => {
    const teams = await listTeams(churchId);
    return { success: true, data: teams };
  });
}

/**
 * The assign dialog's people search, answered by the DATABASE (ruling
 * 2026-08-12, from sweep #403 / PR #409 DECISION 3).
 *
 * The dialog used to be handed `listPeople(churchId, { limit: 100 })` and
 * filter that array in the browser. Past a hundred people, everyone outside the
 * prefetched hundred simply did not exist as far as the search box was
 * concerned — a planter typing a real member's name was told "No people found".
 * A bigger prefetch moves the ceiling; it does not remove it.
 *
 * So the search is a scoped read: `listPeople(..., { search })` goes through
 * `peopleTextSearch`, the one people text predicate, and the team counts the
 * dialog's warning needs come back with the matches rather than from a props
 * table that only covered the prefetch.
 */
export async function searchTeamCandidatesAction(query: string): Promise<
  ActionResult<{
    people: PersonForClient[];
    teamCounts: Record<string, number>;
  }>
> {
  return withChurch("read", "Failed to search people", async ({ churchId }) => {
    const { people } = await listPeople(churchId, {
      search: query,
      limit: TEAM_CANDIDATE_SEARCH_LIMIT,
    });

    const teamCounts = await getTeamCountsForPeople(
      churchId,
      people.map((person) => person.id)
    );

    return { success: true, data: { people, teamCounts } };
  });
}

export async function createTeamAction(
  formData: FormData
): Promise<ActionResult<MinistryTeam>> {
  return withChurch(
    "teams.write",
    "Failed to create team",
    async ({ churchId, userId }) => {
      const parsed = teamCreateSchema.safeParse(
        Object.fromEntries(formData.entries())
      );
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const team = await createTeam(churchId, userId, parsed.data);
      revalidateTeamSurfaces();
      return { success: true, data: team };
    }
  );
}

export async function updateTeamAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<MinistryTeam>> {
  return withChurch(
    "teams.write",
    "Failed to update team",
    async ({ churchId }) => {
      const parsed = teamUpdateSchema.safeParse(
        Object.fromEntries(formData.entries())
      );
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const team = await updateTeam(churchId, teamId, parsed.data);
      revalidateTeamSurfaces();
      return { success: true, data: team };
    }
  );
}

export async function assignTeamLeaderAction(
  teamId: string,
  personId: string
): Promise<ActionResult<MinistryTeam>> {
  return withChurch(
    "teams.write",
    "Failed to assign leader",
    async ({ churchId, userId }) => {
      const team = await assignTeamLeader(churchId, teamId, personId, userId);
      revalidateTeamSurfaces();
      return { success: true, data: team };
    }
  );
}

export async function initializeTeamsAction(
  teamKeys?: PredefinedTeamKey[]
): Promise<ActionResult<MinistryTeam[]>> {
  return withChurch(
    "teams.write",
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
  // ITS OWN CAPABILITY, not the one inherited from the first thing it calls.
  // This export composes `listTeamsAction` (a `read`) with `initializeTeamsAction`
  // and `importRoleTemplatesAction` (both `teams.write`), so the guard walk would
  // otherwise report a WRITE endpoint whose stated authority is `read` — true of
  // the first statement and false of the endpoint.
  await requireSeat("teams.write");

  const existing = await listTeamsAction();
  if (!existing.success) return { success: false, error: existing.error };
  if (existing.data.length > 0) return { success: true, data: [] };

  const created = await initializeTeamsAction();
  if (!created.success) return created;

  // The created rows CARRY their template key (`ministry_teams.template_key`,
  // ruling 2026-08-12), so the join back to the role templates is the column
  // itself — no name map, and nothing here breaks when a template is renamed.
  // A NULL key would mean a row this call did not create from a template, which
  // `initializePredefinedTeams` cannot produce: skip it rather than guess.
  for (const team of created.data) {
    if (!team.templateKey) continue;

    const roles = await importRoleTemplatesAction(team.id, team.templateKey);
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
  return withChurch(
    "teams.write",
    "Failed to create role",
    async ({ churchId, userId }) => {
      const parsed = roleCreateSchema.safeParse(formEntries(formData));
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const role = await createRole(churchId, teamId, userId, parsed.data);
      revalidateTeamSurfaces();
      return { success: true, data: role };
    }
  );
}

export async function updateRoleAction(
  roleId: string,
  formData: FormData
): Promise<ActionResult<TeamRole>> {
  return withChurch(
    "teams.write",
    "Failed to update role",
    async ({ churchId, userId }) => {
      const parsed = roleUpdateSchema.safeParse(formEntries(formData));
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const role = await updateRole(churchId, roleId, userId, parsed.data);
      revalidateTeamSurfaces();
      return { success: true, data: role };
    }
  );
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult> {
  return withChurch(
    "teams.write",
    "Failed to delete role",
    async ({ churchId, userId }) => {
      await deleteRole(churchId, roleId, userId);
      revalidateTeamSurfaces();
      return { success: true, data: undefined };
    }
  );
}

export async function importRoleTemplatesAction(
  teamId: string,
  teamKey: PredefinedTeamKey,
  roleKeys?: string[]
): Promise<ActionResult<TeamRole[]>> {
  return withChurch(
    "teams.write",
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
// Responsibility Actions (MT-002b)
// ============================================================================
//
// There is no LIST action here: the responsibilities tab is a server component
// and calls `listResponsibilities` directly — a read with no caller does not
// get an endpoint. The seed rides on that read, so it is not an endpoint
// either, which is the point: nothing a POST can reach decides whether a team
// has been offered its playbook.

export async function createResponsibilityAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<TeamResponsibility>> {
  return withChurch(
    "teams.write",
    "Failed to add responsibility",
    async ({ churchId, userId }) => {
      const parsed = responsibilitySchema.safeParse(formEntries(formData));
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const responsibility = await createResponsibility(
        churchId,
        teamId,
        userId,
        parsed.data
      );
      revalidateTeamSurfaces();
      return { success: true, data: responsibility };
    }
  );
}

export async function updateResponsibilityAction(
  responsibilityId: string,
  formData: FormData
): Promise<ActionResult<TeamResponsibility>> {
  return withChurch(
    "teams.write",
    "Failed to update responsibility",
    async ({ churchId }) => {
      const parsed = responsibilitySchema.safeParse(formEntries(formData));
      if (!parsed.success) return fieldErrorResult(parsed.error);

      const responsibility = await updateResponsibility(
        churchId,
        responsibilityId,
        parsed.data
      );
      revalidateTeamSurfaces();
      return { success: true, data: responsibility };
    }
  );
}

/**
 * Tick a responsibility off, or reopen it. The COMPLETE/NOT flag is the whole
 * argument — `completed_at` is derived from it in the service, so a caller can
 * never post a completion time of its own choosing.
 */
export async function setResponsibilityCompleteAction(
  responsibilityId: string,
  completed: boolean
): Promise<ActionResult<TeamResponsibility>> {
  return withChurch(
    "teams.write",
    "Failed to update responsibility",
    async ({ churchId }) => {
      const responsibility = await updateResponsibility(
        churchId,
        responsibilityId,
        { completed }
      );
      revalidateTeamSurfaces();
      return { success: true, data: responsibility };
    }
  );
}

export async function deleteResponsibilityAction(
  responsibilityId: string
): Promise<ActionResult> {
  return withChurch(
    "teams.write",
    "Failed to delete responsibility",
    async ({ churchId }) => {
      await deleteResponsibility(churchId, responsibilityId);
      revalidateTeamSurfaces();
      return { success: true, data: undefined };
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
  return withChurch(
    "teams.write",
    "Failed to assign member",
    async ({ churchId, userId }) => {
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
    }
  );
}

export async function removeMemberAction(
  membershipId: string
): Promise<ActionResult> {
  return withChurch(
    "teams.write",
    "Failed to remove member",
    async ({ churchId, userId }) => {
      await removeMember(churchId, membershipId, userId);
      revalidateTeamSurfaces();
      return { success: true, data: undefined };
    }
  );
}

// ============================================================================
// Meeting Actions (using unified meetings service)
// ============================================================================

export async function createMeetingAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<ChurchMeeting>> {
  return withChurch(
    "teams.write",
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
    "teams.write",
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
  return withChurch(
    "teams.write",
    "Failed to mark complete",
    async ({ churchId, userId }) => {
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
    }
  );
}
