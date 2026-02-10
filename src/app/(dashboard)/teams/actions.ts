"use server";

import { verifySession } from "@/lib/auth/session";
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  assignTeamLeader,
  initializePredefinedTeams,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  importRoleTemplates,
  assignMember,
  removeMember,
  getPersonTeams,
  getPersonTeamCount,
  listTrainingPrograms,
  createTrainingProgram,
  markTrainingComplete,
  getTeamHealth,
  getAllTeamsHealth,
  getStaffingSummary,
} from "@/lib/ministry-teams/service";
import type {
  TeamWithStats,
  TeamDetail,
  PersonTeamAssignment,
  StaffingSummary,
  TeamHealthMetrics,
} from "@/lib/ministry-teams/service";
import {
  createMeeting as createUnifiedMeeting,
  listMeetings as listUnifiedMeetings,
  recordAttendanceBatch,
} from "@/lib/meetings/service";
import type { ChurchMeeting, MeetingWithCounts } from "@/lib/meetings/types";
import {
  teamCreateSchema,
  teamUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  memberAssignSchema,
  trainingProgramCreateSchema,
  trainingCompleteSchema,
} from "@/lib/validations/ministry-teams";
import {
  meetingCreateSchema,
  attendanceBatchSchema,
} from "@/lib/validations/meetings";
import type {
  MinistryTeam,
  TeamRole,
  TeamMembership,
  TrainingProgram,
  TrainingCompletion,
} from "@/db/schema";
import type { PredefinedTeamKey } from "@/lib/ministry-teams/role-templates";
import { revalidatePath } from "next/cache";

// ============================================================================
// Types
// ============================================================================

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// ============================================================================
// Team Actions
// ============================================================================

export async function listTeamsAction(): Promise<
  ActionResult<TeamWithStats[]>
> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const teams = await listTeams(user.churchId);
    return { success: true, data: teams };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load teams" };
  }
}

export async function getTeamAction(
  teamId: string
): Promise<ActionResult<TeamDetail>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const team = await getTeam(user.churchId, teamId);
    if (!team) return { success: false, error: "Team not found" };

    return { success: true, data: team };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load team" };
  }
}

export async function createTeamAction(
  formData: FormData
): Promise<ActionResult<MinistryTeam>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const rawData = Object.fromEntries(formData.entries());
    const parsed = teamCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const team = await createTeam(user.churchId, user.id, parsed.data);
    revalidatePath("/teams");
    return { success: true, data: team };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to create team" };
  }
}

export async function updateTeamAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<MinistryTeam>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const rawData = Object.fromEntries(formData.entries());
    const parsed = teamUpdateSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const team = await updateTeam(user.churchId, teamId, parsed.data);
    revalidatePath("/teams");
    return { success: true, data: team };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to update team" };
  }
}

export async function assignTeamLeaderAction(
  teamId: string,
  personId: string
): Promise<ActionResult<MinistryTeam>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const team = await assignTeamLeader(
      user.churchId,
      teamId,
      personId,
      user.id
    );
    revalidatePath("/teams");
    return { success: true, data: team };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    if (error instanceof Error)
      return { success: false, error: error.message };
    return { success: false, error: "Failed to assign leader" };
  }
}

export async function initializeTeamsAction(
  teamKeys?: PredefinedTeamKey[]
): Promise<ActionResult<MinistryTeam[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const teams = await initializePredefinedTeams(
      user.churchId,
      user.id,
      teamKeys
    );
    revalidatePath("/teams");
    return { success: true, data: teams };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to initialize teams" };
  }
}

// ============================================================================
// Role Actions
// ============================================================================

export async function listRolesAction(
  teamId: string
): Promise<ActionResult<TeamRole[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const roles = await listRoles(user.churchId, teamId);
    return { success: true, data: roles };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load roles" };
  }
}

export async function createRoleAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<TeamRole>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const rawData: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      if (key === "isLeadershipRole") rawData[key] = value === "true";
      else if (key === "sortOrder") rawData[key] = parseInt(value as string);
      else if (value !== "") rawData[key] = value;
    });

    const parsed = roleCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const role = await createRole(
      user.churchId,
      teamId,
      user.id,
      parsed.data
    );
    revalidatePath(`/teams/${teamId}`);
    return { success: true, data: role };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to create role" };
  }
}

export async function updateRoleAction(
  roleId: string,
  formData: FormData
): Promise<ActionResult<TeamRole>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const rawData: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      if (key === "isLeadershipRole") rawData[key] = value === "true";
      else if (key === "sortOrder") rawData[key] = parseInt(value as string);
      else if (value !== "") rawData[key] = value;
    });

    const parsed = roleUpdateSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const role = await updateRole(user.churchId, roleId, parsed.data);
    revalidatePath("/teams");
    return { success: true, data: role };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to update role" };
  }
}

export async function deleteRoleAction(
  roleId: string
): Promise<ActionResult> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    await deleteRole(user.churchId, roleId, user.id);
    revalidatePath("/teams");
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    if (error instanceof Error)
      return { success: false, error: error.message };
    return { success: false, error: "Failed to delete role" };
  }
}

export async function importRoleTemplatesAction(
  teamId: string,
  teamKey: PredefinedTeamKey,
  roleKeys?: string[]
): Promise<ActionResult<TeamRole[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const roles = await importRoleTemplates(
      user.churchId,
      teamId,
      user.id,
      teamKey,
      roleKeys
    );
    revalidatePath(`/teams/${teamId}`);
    return { success: true, data: roles };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to import templates" };
  }
}

// ============================================================================
// Membership Actions
// ============================================================================

export async function assignMemberAction(
  teamId: string,
  roleId: string,
  data: { personId: string; startDate?: string }
): Promise<ActionResult<TeamMembership>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const parsed = memberAssignSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const membership = await assignMember(
      user.churchId,
      teamId,
      roleId,
      parsed.data.personId,
      user.id,
      parsed.data.startDate
    );
    revalidatePath(`/teams/${teamId}`);
    revalidatePath("/teams");
    return { success: true, data: membership };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    if (error instanceof Error)
      return { success: false, error: error.message };
    return { success: false, error: "Failed to assign member" };
  }
}

export async function removeMemberAction(
  membershipId: string
): Promise<ActionResult> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    await removeMember(user.churchId, membershipId, user.id);
    revalidatePath("/teams");
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    if (error instanceof Error)
      return { success: false, error: error.message };
    return { success: false, error: "Failed to remove member" };
  }
}

export async function getPersonTeamsAction(
  personId: string
): Promise<ActionResult<PersonTeamAssignment[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const teams = await getPersonTeams(user.churchId, personId);
    return { success: true, data: teams };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load person teams" };
  }
}

export async function getPersonTeamCountAction(
  personId: string
): Promise<ActionResult<number>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const count = await getPersonTeamCount(user.churchId, personId);
    return { success: true, data: count };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to get team count" };
  }
}

// ============================================================================
// Meeting Actions (using unified meetings service)
// ============================================================================

export async function listMeetingsAction(
  teamId: string
): Promise<ActionResult<MeetingWithCounts[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const result = await listUnifiedMeetings(user.churchId, { teamId, limit: 50 });
    return { success: true, data: result.meetings };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load meetings" };
  }
}

export async function createMeetingAction(
  teamId: string,
  formData: FormData
): Promise<ActionResult<ChurchMeeting>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const rawData: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      if (key === "durationMinutes")
        rawData[key] = value ? parseInt(value as string) : undefined;
      else if (value !== "") rawData[key] = value;
    });

    // Inject team meeting type and teamId
    rawData.type = "team_meeting";
    rawData.teamId = teamId;
    // Map meetingType to meetingSubtype
    if (rawData.meetingType) {
      rawData.meetingSubtype = rawData.meetingType;
      delete rawData.meetingType;
    }

    const parsed = meetingCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const meeting = await createUnifiedMeeting(user.churchId, user.id, parsed.data);
    revalidatePath(`/teams/${teamId}/meetings`);
    revalidatePath("/meetings");
    return { success: true, data: meeting };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to create meeting" };
  }
}

export async function recordAttendanceAction(
  meetingId: string,
  data: { records: { personId: string; status: "attended" | "absent" | "excused" }[] }
): Promise<ActionResult> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const parsed = attendanceBatchSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
      };
    }

    await recordAttendanceBatch(
      user.churchId,
      meetingId,
      parsed.data.records,
      user.id
    );
    revalidatePath("/teams");
    revalidatePath("/meetings");
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to record attendance" };
  }
}

// ============================================================================
// Training Actions
// ============================================================================

export async function listTrainingProgramsAction(
  teamId?: string
): Promise<ActionResult<TrainingProgram[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const programs = await listTrainingPrograms(user.churchId, teamId);
    return { success: true, data: programs };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load programs" };
  }
}

export async function createTrainingProgramAction(
  formData: FormData
): Promise<ActionResult<TrainingProgram>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const rawData: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      if (key === "isRequired") rawData[key] = value === "true";
      else if (value !== "") rawData[key] = value;
    });

    const parsed = trainingProgramCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const program = await createTrainingProgram(
      user.churchId,
      user.id,
      parsed.data
    );
    revalidatePath("/teams");
    return { success: true, data: program };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to create program" };
  }
}

export async function markTrainingCompleteAction(
  data: { personId: string; programId: string }
): Promise<ActionResult<TrainingCompletion>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const parsed = trainingCompleteSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
      };
    }

    const completion = await markTrainingComplete(
      user.churchId,
      parsed.data.personId,
      parsed.data.programId,
      user.id
    );
    revalidatePath("/teams");
    return { success: true, data: completion };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    if (error instanceof Error)
      return { success: false, error: error.message };
    return { success: false, error: "Failed to mark complete" };
  }
}

// ============================================================================
// Health / Metrics Actions
// ============================================================================

export async function getStaffingSummaryAction(): Promise<
  ActionResult<StaffingSummary>
> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const summary = await getStaffingSummary(user.churchId);
    return { success: true, data: summary };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load staffing summary" };
  }
}

export async function getTeamHealthAction(
  teamId: string
): Promise<ActionResult<TeamHealthMetrics>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const health = await getTeamHealth(user.churchId, teamId);
    return { success: true, data: health };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load team health" };
  }
}

export async function getAllTeamsHealthAction(): Promise<
  ActionResult<TeamHealthMetrics[]>
> {
  try {
    const { user } = await verifySession();
    if (!user.churchId)
      return { success: false, error: "No church associated" };

    const health = await getAllTeamsHealth(user.churchId);
    return { success: true, data: health };
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return { success: false, error: "Failed to load team health" };
  }
}
