"use server";

import type {
  Invitation,
  Location,
  MeetingChecklistItem,
  MeetingEvaluation,
  VisionMeeting,
  VisionMeetingAttendance,
} from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { createPerson } from "@/lib/people/service";
import {
  attendanceCreateSchema,
  attendeeQuickAddSchema,
  checklistItemUpdateSchema,
  evaluationCreateSchema,
  invitationCreateSchema,
  invitationStatusUpdateSchema,
  locationCreateSchema,
  locationUpdateSchema,
  meetingCreateSchema,
  meetingStatusSchema,
  meetingUpdateSchema,
} from "@/lib/validations/vision-meetings";
import {
  createInvitation,
  updateInvitationStatus,
} from "@/lib/vision-meetings/invitations";
import {
  createLocation,
  updateLocation,
} from "@/lib/vision-meetings/locations";
import {
  addAttendee,
  createEvaluation,
  createMeeting,
  deleteMeeting,
  finalizeAttendance,
  removeAttendee,
  updateChecklistItem,
  updateMeeting,
  updateMeetingStatus,
} from "@/lib/vision-meetings/service";
import type { ActionResult } from "@/lib/vision-meetings/types";
import { revalidatePath } from "next/cache";

/**
 * Helper to extract form data into an object
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  formData.forEach((value, key) => {
    // Handle empty strings as undefined for optional fields
    if (value === "") {
      obj[key] = undefined;
    } else {
      obj[key] = value;
    }
  });

  return obj;
}

// ============================================================================
// Meeting Actions
// ============================================================================

/**
 * Create a new vision meeting
 */
export async function createMeetingAction(
  formData: FormData
): Promise<ActionResult<VisionMeeting>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create meetings",
      };
    }

    // Parse and validate form data
    const rawData = formDataToObject(formData);
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

    // Create the meeting
    const meeting = await createMeeting(user.churchId, user.id, parsed.data);

    // Revalidate the meetings list
    revalidatePath("/vision-meetings");

    return {
      success: true,
      data: meeting,
    };
  } catch (error) {
    console.error("createMeetingAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in",
      };
    }

    return {
      success: false,
      error: "An unexpected error occurred while creating the meeting",
    };
  }
}

/**
 * Update an existing vision meeting
 */
export async function updateMeetingAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<VisionMeeting>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update meetings",
      };
    }

    // Parse and validate form data
    const rawData = formDataToObject(formData);
    const parsed = meetingUpdateSchema.safeParse(rawData);

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

    // Update the meeting
    const meeting = await updateMeeting(user.churchId, meetingId, parsed.data);

    // Revalidate the meetings list and detail page
    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);

    return {
      success: true,
      data: meeting,
    };
  } catch (error) {
    console.error("updateMeetingAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in",
        };
      }

      if (error.message === "Meeting not found") {
        return {
          success: false,
          error: "Meeting not found or has been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while updating the meeting",
    };
  }
}

/**
 * Delete a vision meeting
 */
export async function deleteMeetingAction(
  meetingId: string
): Promise<ActionResult<void>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to delete meetings",
      };
    }

    // Delete the meeting
    await deleteMeeting(user.churchId, meetingId);

    // Revalidate the meetings list
    revalidatePath("/vision-meetings");

    return {
      success: true,
      data: undefined,
    };
  } catch (error) {
    console.error("deleteMeetingAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in",
        };
      }

      if (error.message === "Meeting not found") {
        return {
          success: false,
          error: "Meeting not found or has already been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while deleting the meeting",
    };
  }
}

/**
 * Update a vision meeting's status
 */
export async function updateMeetingStatusAction(
  meetingId: string,
  newStatus: string
): Promise<ActionResult<VisionMeeting>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update meetings",
      };
    }

    // Validate the newStatus
    const statusResult = meetingStatusSchema.safeParse(newStatus);
    if (!statusResult.success) {
      return {
        success: false,
        error: "Invalid meeting status value",
      };
    }

    // Update the meeting status
    const meeting = await updateMeetingStatus(
      user.churchId,
      meetingId,
      statusResult.data
    );

    // Revalidate the meetings list and detail page
    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);

    return {
      success: true,
      data: meeting,
    };
  } catch (error) {
    console.error("updateMeetingStatusAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in",
        };
      }

      if (error.message === "Meeting not found") {
        return {
          success: false,
          error: "Meeting not found or has been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while updating the meeting status",
    };
  }
}

// ============================================================================
// Location Actions
// ============================================================================

/**
 * Create a new location
 */
export async function createLocationAction(
  formData: FormData
): Promise<ActionResult<Location>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create locations",
      };
    }

    // Parse and validate form data
    const rawData = formDataToObject(formData);
    const parsed = locationCreateSchema.safeParse(rawData);

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

    // Create the location
    const location = await createLocation(user.churchId, parsed.data);

    // Revalidate the meetings page (locations are shown there)
    revalidatePath("/vision-meetings");

    return {
      success: true,
      data: location,
    };
  } catch (error) {
    console.error("createLocationAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in",
      };
    }

    return {
      success: false,
      error: "An unexpected error occurred while creating the location",
    };
  }
}

/**
 * Update an existing location
 */
export async function updateLocationAction(
  locationId: string,
  formData: FormData
): Promise<ActionResult<Location>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update locations",
      };
    }

    // Parse and validate form data
    const rawData = formDataToObject(formData);
    const parsed = locationUpdateSchema.safeParse(rawData);

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

    // Update the location
    const location = await updateLocation(
      user.churchId,
      locationId,
      parsed.data
    );

    // Revalidate the meetings page (locations are shown there)
    revalidatePath("/vision-meetings");

    return {
      success: true,
      data: location,
    };
  } catch (error) {
    console.error("updateLocationAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in",
        };
      }

      if (error.message === "Location not found") {
        return {
          success: false,
          error: "Location not found or has been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while updating the location",
    };
  }
}

// ============================================================================
// Attendance Actions
// ============================================================================

/**
 * Add an existing person as an attendee to a meeting
 */
export async function addAttendeeAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<VisionMeetingAttendance>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to record attendance",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = attendanceCreateSchema.safeParse(rawData);

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

    const record = await addAttendee(user.churchId, meetingId, parsed.data);

    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);

    return {
      success: true,
      data: record,
    };
  } catch (error) {
    console.error("addAttendeeAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }

    return {
      success: false,
      error: "An unexpected error occurred while adding the attendee",
    };
  }
}

/**
 * Quick-add a new person and immediately add them as an attendee
 */
export async function quickAddAttendeeAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<VisionMeetingAttendance>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to record attendance",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = attendeeQuickAddSchema.safeParse(rawData);

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

    // Create the person first
    const person = await createPerson(user.churchId, user.id, {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      source: "vision_meeting",
      status: "prospect",
      country: "US",
    });

    // Then add as attendee
    const record = await addAttendee(user.churchId, meetingId, {
      personId: person.id,
      attendanceType: parsed.data.attendanceType,
      invitedById: parsed.data.invitedById,
    });

    revalidatePath("/people");
    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);

    return {
      success: true,
      data: record,
    };
  } catch (error) {
    console.error("quickAddAttendeeAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }

    return {
      success: false,
      error: "An unexpected error occurred while adding the attendee",
    };
  }
}

/**
 * Remove an attendee from a meeting
 */
export async function removeAttendeeAction(
  meetingId: string,
  personId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to manage attendance",
      };
    }

    await removeAttendee(user.churchId, meetingId, personId);

    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);

    return {
      success: true,
      data: undefined,
    };
  } catch (error) {
    console.error("removeAttendeeAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return { success: false, error: "You must be logged in" };
      }

      if (error.message === "Attendance record not found") {
        return {
          success: false,
          error: "Attendance record not found or already removed",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while removing the attendee",
    };
  }
}

/**
 * Finalize attendance for a meeting
 */
export async function finalizeAttendanceAction(
  meetingId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to finalize attendance",
      };
    }

    await finalizeAttendance(user.churchId, meetingId, user.id);

    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);

    return {
      success: true,
      data: undefined,
    };
  } catch (error) {
    console.error("finalizeAttendanceAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }

    return {
      success: false,
      error: "An unexpected error occurred while finalizing attendance",
    };
  }
}

// ============================================================================
// Invitation Actions
// ============================================================================

/**
 * Create an invitation record for a meeting
 */
export async function createInvitationAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<Invitation>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create invitations",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = invitationCreateSchema.safeParse(rawData);

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

    const invitation = await createInvitation(
      user.churchId,
      meetingId,
      parsed.data
    );

    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);
    revalidatePath(`/vision-meetings/${meetingId}/invitations`);

    return {
      success: true,
      data: invitation,
    };
  } catch (error) {
    console.error("createInvitationAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }

    return {
      success: false,
      error: "An unexpected error occurred while creating the invitation",
    };
  }
}

/**
 * Update the status of an invitation
 */
export async function updateInvitationStatusAction(
  invitationId: string,
  formData: FormData
): Promise<ActionResult<Invitation>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error:
          "You must be associated with a church to update invitation status",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = invitationStatusUpdateSchema.safeParse(rawData);

    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid invitation status",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const invitation = await updateInvitationStatus(
      user.churchId,
      invitationId,
      parsed.data.status
    );

    revalidatePath("/vision-meetings");

    return {
      success: true,
      data: invitation,
    };
  } catch (error) {
    console.error("updateInvitationStatusAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return { success: false, error: "You must be logged in" };
      }

      if (error.message === "Invitation not found") {
        return {
          success: false,
          error: "Invitation not found or has been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while updating invitation status",
    };
  }
}

// ============================================================================
// Evaluation Actions
// ============================================================================

/**
 * Create an evaluation for a vision meeting
 */
export async function createEvaluationAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingEvaluation>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to evaluate meetings",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = evaluationCreateSchema.safeParse(rawData);

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

    const evaluation = await createEvaluation(
      user.churchId,
      meetingId,
      user.id,
      parsed.data
    );

    revalidatePath("/vision-meetings");
    revalidatePath(`/vision-meetings/${meetingId}`);
    revalidatePath(`/vision-meetings/${meetingId}/evaluation`);

    return {
      success: true,
      data: evaluation,
    };
  } catch (error) {
    console.error("createEvaluationAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }

    return {
      success: false,
      error: "An unexpected error occurred while saving the evaluation",
    };
  }
}

// ============================================================================
// Checklist Actions
// ============================================================================

/**
 * Toggle a checklist item's checked state
 */
export async function toggleChecklistItemAction(
  itemId: string,
  isChecked: boolean
): Promise<ActionResult<MeetingChecklistItem>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const item = await updateChecklistItem(user.churchId, itemId, {
      isChecked,
    });
    revalidatePath("/vision-meetings");
    return { success: true, data: item };
  } catch (error) {
    console.error("toggleChecklistItemAction error:", error);
    if (
      error instanceof Error &&
      error.message === "Checklist item not found"
    ) {
      return { success: false, error: "Checklist item not found" };
    }
    return { success: false, error: "Failed to update checklist item" };
  }
}

/**
 * Update a checklist item (notes, assignment, etc.)
 */
export async function updateChecklistItemAction(
  itemId: string,
  formData: FormData
): Promise<ActionResult<MeetingChecklistItem>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const rawData = formDataToObject(formData);
    const parsed = checklistItemUpdateSchema.safeParse(rawData);

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

    const item = await updateChecklistItem(user.churchId, itemId, parsed.data);

    revalidatePath("/vision-meetings");

    return { success: true, data: item };
  } catch (error) {
    console.error("updateChecklistItemAction error:", error);
    if (
      error instanceof Error &&
      error.message === "Checklist item not found"
    ) {
      return { success: false, error: "Checklist item not found" };
    }
    return { success: false, error: "Failed to update checklist item" };
  }
}
