// ============================================================================
// Team reads with no current caller. NOT a "use server" module on purpose:
// every export of one is a POSTable endpoint reachable with no UI, and reads
// belong in a sibling module until a surface actually wires them
// (memory/invariants.md → Authentication). Names and signatures are kept so a
// future caller — and the #311 specs — still find them; moving one back into
// actions.ts is a one-line cut when it gains a UI.
// ============================================================================

import {
  getTeam,
  getPersonTeams,
  listRoles,
  listTrainingPrograms,
  getTeamHealth,
  getAllTeamsHealth,
  getStaffingSummary,
} from "@/lib/ministry-teams/service";
import type {
  TeamDetail,
  PersonTeamAssignment,
  StaffingSummary,
  TeamHealthMetrics,
} from "@/lib/ministry-teams/service";
import { listMeetings as listUnifiedMeetings } from "@/lib/meetings/service";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { TeamRole, TrainingProgram } from "@/db/schema";
import { withChurch, type ActionResult } from "./action-shell";

export async function getTeamAction(
  teamId: string
): Promise<ActionResult<TeamDetail>> {
  return withChurch("Failed to load team", async ({ churchId }) => {
    const team = await getTeam(churchId, teamId);
    if (!team) return { success: false, error: "Team not found" };
    return { success: true, data: team };
  });
}

export async function listRolesAction(
  teamId: string
): Promise<ActionResult<TeamRole[]>> {
  return withChurch("Failed to load roles", async ({ churchId }) => {
    const roles = await listRoles(churchId, teamId);
    return { success: true, data: roles };
  });
}

export async function getPersonTeamsAction(
  personId: string
): Promise<ActionResult<PersonTeamAssignment[]>> {
  return withChurch("Failed to load person teams", async ({ churchId }) => {
    const teams = await getPersonTeams(churchId, personId);
    return { success: true, data: teams };
  });
}

export async function listMeetingsAction(
  teamId: string
): Promise<ActionResult<MeetingWithCounts[]>> {
  return withChurch("Failed to load meetings", async ({ churchId }) => {
    const result = await listUnifiedMeetings(churchId, {
      teamId,
      limit: 50,
    });
    return { success: true, data: result.meetings };
  });
}

export async function listTrainingProgramsAction(
  teamId?: string
): Promise<ActionResult<TrainingProgram[]>> {
  return withChurch("Failed to load programs", async ({ churchId }) => {
    const programs = await listTrainingPrograms(churchId, teamId);
    return { success: true, data: programs };
  });
}

export async function getStaffingSummaryAction(): Promise<
  ActionResult<StaffingSummary>
> {
  return withChurch("Failed to load staffing summary", async ({ churchId }) => {
    const summary = await getStaffingSummary(churchId);
    return { success: true, data: summary };
  });
}

export async function getTeamHealthAction(
  teamId: string
): Promise<ActionResult<TeamHealthMetrics>> {
  return withChurch("Failed to load team health", async ({ churchId }) => {
    const health = await getTeamHealth(churchId, teamId);
    return { success: true, data: health };
  });
}

export async function getAllTeamsHealthAction(): Promise<
  ActionResult<TeamHealthMetrics[]>
> {
  return withChurch("Failed to load team health", async ({ churchId }) => {
    const health = await getAllTeamsHealth(churchId);
    return { success: true, data: health };
  });
}
