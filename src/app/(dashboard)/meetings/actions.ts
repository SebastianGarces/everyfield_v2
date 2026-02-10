"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetingAttendance } from "@/db/schema/meetings";
import type {
  ChurchMeeting,
  Invitation,
  Location,
  MeetingAttendanceRecord,
  MeetingChecklistItem,
  MeetingEvaluation,
} from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { createPerson } from "@/lib/people/service";
import {
  attendanceCreateSchema,
  attendanceBatchSchema,
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
} from "@/lib/validations/meetings";
import {
  createInvitation,
  updateInvitationStatus,
} from "@/lib/meetings/invitations";
import {
  createLocation,
  updateLocation,
} from "@/lib/meetings/locations";
import {
  addAttendee,
  createEvaluation,
  createMeeting,
  deleteMeeting,
  finalizeAttendance,
  recordAttendanceBatch,
  removeAttendee,
  updateChecklistItem,
  updateMeeting,
  updateMeetingStatus,
} from "@/lib/meetings/service";
import type { ActionResult } from "@/lib/meetings/types";
import { revalidatePath } from "next/cache";

/**
 * Helper to extract form data into an object
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  formData.forEach((value, key) => {
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

export async function createMeetingAction(
  formData: FormData
): Promise<ActionResult<ChurchMeeting>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church to create meetings" };
    }

    const rawData = formDataToObject(formData);
    const parsed = meetingCreateSchema.safeParse(rawData);

    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const meeting = await createMeeting(user.churchId, user.id, parsed.data);
    revalidatePath("/meetings");

    return { success: true, data: meeting };
  } catch (error) {
    console.error("createMeetingAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }
    return { success: false, error: "An unexpected error occurred while creating the meeting" };
  }
}

export async function updateMeetingAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<ChurchMeeting>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church to update meetings" };
    }

    const rawData = formDataToObject(formData);
    const parsed = meetingUpdateSchema.safeParse(rawData);

    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const meeting = await updateMeeting(user.churchId, meetingId, parsed.data);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);

    return { success: true, data: meeting };
  } catch (error) {
    console.error("updateMeetingAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
      if (error.message === "Meeting not found") return { success: false, error: "Meeting not found or has been deleted" };
    }
    return { success: false, error: "An unexpected error occurred while updating the meeting" };
  }
}

export async function deleteMeetingAction(
  meetingId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church to delete meetings" };
    }

    await deleteMeeting(user.churchId, meetingId);
    revalidatePath("/meetings");

    return { success: true, data: undefined };
  } catch (error) {
    console.error("deleteMeetingAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
      if (error.message === "Meeting not found") return { success: false, error: "Meeting not found or has already been deleted" };
    }
    return { success: false, error: "An unexpected error occurred while deleting the meeting" };
  }
}

export async function updateMeetingStatusAction(
  meetingId: string,
  newStatus: string
): Promise<ActionResult<ChurchMeeting>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church to update meetings" };
    }

    const statusResult = meetingStatusSchema.safeParse(newStatus);
    if (!statusResult.success) {
      return { success: false, error: "Invalid meeting status value" };
    }

    const meeting = await updateMeetingStatus(user.churchId, meetingId, statusResult.data);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);

    return { success: true, data: meeting };
  } catch (error) {
    console.error("updateMeetingStatusAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
      if (error.message === "Meeting not found") return { success: false, error: "Meeting not found or has been deleted" };
    }
    return { success: false, error: "An unexpected error occurred while updating the meeting status" };
  }
}

// ============================================================================
// Location Actions
// ============================================================================

export async function createLocationAction(
  formData: FormData
): Promise<ActionResult<Location>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to create locations" };

    const rawData = formDataToObject(formData);
    const parsed = locationCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
    }

    const location = await createLocation(user.churchId, parsed.data);
    revalidatePath("/meetings");
    return { success: true, data: location };
  } catch (error) {
    console.error("createLocationAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
    return { success: false, error: "An unexpected error occurred while creating the location" };
  }
}

export async function updateLocationAction(
  locationId: string,
  formData: FormData
): Promise<ActionResult<Location>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to update locations" };

    const rawData = formDataToObject(formData);
    const parsed = locationUpdateSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
    }

    const location = await updateLocation(user.churchId, locationId, parsed.data);
    revalidatePath("/meetings");
    return { success: true, data: location };
  } catch (error) {
    console.error("updateLocationAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
      if (error.message === "Location not found") return { success: false, error: "Location not found or has been deleted" };
    }
    return { success: false, error: "An unexpected error occurred while updating the location" };
  }
}

// ============================================================================
// Attendance Actions
// ============================================================================

export async function addAttendeeAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to record attendance" };

    const rawData = formDataToObject(formData);
    const parsed = attendanceCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
    }

    const record = await addAttendee(user.churchId, meetingId, parsed.data);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: record };
  } catch (error) {
    console.error("addAttendeeAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
    return { success: false, error: "An unexpected error occurred while adding the attendee" };
  }
}

export async function quickAddAttendeeAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to record attendance" };

    const rawData = formDataToObject(formData);
    const parsed = attendeeQuickAddSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
    }

    const person = await createPerson(user.churchId, user.id, {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      source: "vision_meeting",
      status: "prospect",
      country: "US",
    });

    const record = await addAttendee(user.churchId, meetingId, {
      personId: person.id,
      attendanceType: parsed.data.attendanceType,
      invitedById: parsed.data.invitedById,
    });

    revalidatePath("/people");
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: record };
  } catch (error) {
    console.error("quickAddAttendeeAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
    return { success: false, error: "An unexpected error occurred while adding the attendee" };
  }
}

export async function removeAttendeeAction(
  meetingId: string,
  personId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to manage attendance" };

    await removeAttendee(user.churchId, meetingId, personId);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("removeAttendeeAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
      if (error.message === "Attendance record not found") return { success: false, error: "Attendance record not found or already removed" };
    }
    return { success: false, error: "An unexpected error occurred while removing the attendee" };
  }
}

export async function finalizeAttendanceAction(
  meetingId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to finalize attendance" };

    await finalizeAttendance(user.churchId, meetingId, user.id);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("finalizeAttendanceAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
    return { success: false, error: "An unexpected error occurred while finalizing attendance" };
  }
}

export async function recordAttendanceBatchAction(
  meetingId: string,
  records: { personId: string; status: "attended" | "absent" | "excused" }[]
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to record attendance" };

    const parsed = attendanceBatchSchema.safeParse({ records });
    if (!parsed.success) {
      return { success: false, error: "Validation failed" };
    }

    await recordAttendanceBatch(user.churchId, meetingId, parsed.data.records, user.id);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/teams");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("recordAttendanceBatchAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
    return { success: false, error: "An unexpected error occurred while recording attendance" };
  }
}

// ============================================================================
// Invitation Actions
// ============================================================================

export async function createInvitationAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<Invitation>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to create invitations" };

    const rawData = formDataToObject(formData);
    const parsed = invitationCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
    }

    const invitation = await createInvitation(user.churchId, meetingId, parsed.data);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath(`/meetings/${meetingId}/invitations`);
    return { success: true, data: invitation };
  } catch (error) {
    console.error("createInvitationAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
    return { success: false, error: "An unexpected error occurred while creating the invitation" };
  }
}

export async function updateInvitationStatusAction(
  invitationId: string,
  formData: FormData
): Promise<ActionResult<Invitation>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to update invitation status" };

    const rawData = formDataToObject(formData);
    const parsed = invitationStatusUpdateSchema.safeParse(rawData);
    if (!parsed.success) return { success: false, error: "Invalid invitation status" };

    const invitation = await updateInvitationStatus(user.churchId, invitationId, parsed.data.status);
    revalidatePath("/meetings");
    return { success: true, data: invitation };
  } catch (error) {
    console.error("updateInvitationStatusAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
      if (error.message === "Invitation not found") return { success: false, error: "Invitation not found or has been deleted" };
    }
    return { success: false, error: "An unexpected error occurred while updating invitation status" };
  }
}

// ============================================================================
// Evaluation Actions
// ============================================================================

export async function createEvaluationAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingEvaluation>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "You must be associated with a church to evaluate meetings" };

    const rawData = formDataToObject(formData);
    const parsed = evaluationCreateSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
    }

    const evaluation = await createEvaluation(user.churchId, meetingId, user.id, parsed.data);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath(`/meetings/${meetingId}/evaluation`);
    return { success: true, data: evaluation };
  } catch (error) {
    console.error("createEvaluationAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") return { success: false, error: "You must be logged in" };
    return { success: false, error: "An unexpected error occurred while saving the evaluation" };
  }
}

// ============================================================================
// Checklist Actions
// ============================================================================

export async function toggleChecklistItemAction(
  itemId: string,
  isChecked: boolean
): Promise<ActionResult<MeetingChecklistItem>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const item = await updateChecklistItem(user.churchId, itemId, { isChecked });
    revalidatePath("/meetings");
    return { success: true, data: item };
  } catch (error) {
    console.error("toggleChecklistItemAction error:", error);
    if (error instanceof Error && error.message === "Checklist item not found") return { success: false, error: "Checklist item not found" };
    return { success: false, error: "Failed to update checklist item" };
  }
}

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
      return { success: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
    }

    const item = await updateChecklistItem(user.churchId, itemId, parsed.data);
    revalidatePath("/meetings");
    return { success: true, data: item };
  } catch (error) {
    console.error("updateChecklistItemAction error:", error);
    if (error instanceof Error && error.message === "Checklist item not found") return { success: false, error: "Checklist item not found" };
    return { success: false, error: "Failed to update checklist item" };
  }
}

// ============================================================================
// Guest List Actions
// ============================================================================

export async function addToGuestListAction(
  meetingId: string,
  personId: string
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "No church" };

    const { addToGuestList } = await import("@/lib/meetings/guest-list");
    const record = await addToGuestList(user.churchId, meetingId, personId, user.id);
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: record };
  } catch (error) {
    console.error("addToGuestListAction error:", error);
    return { success: false, error: "Failed to add to guest list" };
  }
}

export async function removeFromGuestListAction(
  meetingId: string,
  personId: string
): Promise<ActionResult<null>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "No church" };

    const { removeFromGuestList } = await import("@/lib/meetings/guest-list");
    await removeFromGuestList(user.churchId, meetingId, personId);
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: null };
  } catch (error) {
    console.error("removeFromGuestListAction error:", error);
    return { success: false, error: "Failed to remove from guest list" };
  }
}

export async function updateRsvpStatusAction(
  meetingId: string,
  personId: string,
  status: string
): Promise<ActionResult<null>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "No church" };

    const { updateRsvpStatus } = await import("@/lib/meetings/guest-list");
    const { responseStatuses } = await import("@/db/schema/meetings");
    if (!responseStatuses.includes(status as any)) {
      return { success: false, error: "Invalid status" };
    }
    await updateRsvpStatus(user.churchId, meetingId, personId, status as any);
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: null };
  } catch (error) {
    console.error("updateRsvpStatusAction error:", error);
    return { success: false, error: "Failed to update RSVP status" };
  }
}

export async function quickAddPersonToGuestListAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "No church" };

    const firstName = (formData.get("firstName") as string)?.trim();
    const lastName = (formData.get("lastName") as string)?.trim();
    const email = (formData.get("email") as string)?.trim() || undefined;
    const phone = (formData.get("phone") as string)?.trim() || undefined;

    if (!firstName || !lastName) {
      return { success: false, error: "First and last name are required" };
    }

    // Create person in the People database
    const person = await createPerson(user.churchId, user.id, {
      firstName,
      lastName,
      email,
      phone,
      country: "US",
      status: "prospect",
    });

    // Add to guest list
    const { addToGuestList } = await import("@/lib/meetings/guest-list");
    const record = await addToGuestList(user.churchId, meetingId, person.id, user.id);

    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/people");
    return { success: true, data: record };
  } catch (error) {
    console.error("quickAddPersonToGuestListAction error:", error);
    return { success: false, error: "Failed to add person" };
  }
}

/**
 * Toggle a guest's attendance status between "attended" and "absent".
 */
export async function toggleAttendanceStatusAction(
  meetingId: string,
  personId: string,
  attended: boolean
): Promise<ActionResult<null>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "No church" };

    await db
      .update(meetingAttendance)
      .set({
        status: attended ? "attended" : "absent",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(meetingAttendance.churchId, user.churchId),
          eq(meetingAttendance.meetingId, meetingId),
          eq(meetingAttendance.personId, personId)
        )
      );

    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: null };
  } catch (error) {
    console.error("toggleAttendanceStatusAction error:", error);
    return { success: false, error: "Failed to toggle attendance" };
  }
}

/**
 * Add a walk-in attendee: adds to guest list + marks as attended.
 */
export async function addWalkInAttendeeAction(
  meetingId: string,
  personId: string
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "No church" };

    const { addToGuestList } = await import("@/lib/meetings/guest-list");
    const record = await addToGuestList(user.churchId, meetingId, personId, user.id);

    // Mark as attended immediately
    await db
      .update(meetingAttendance)
      .set({ status: "attended", updatedAt: new Date() })
      .where(eq(meetingAttendance.id, record.id));

    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: record };
  } catch (error) {
    console.error("addWalkInAttendeeAction error:", error);
    return { success: false, error: "Failed to add walk-in" };
  }
}

/**
 * Quick-add a new person as a walk-in attendee: creates person + adds to guest list + marks attended.
 */
export async function quickAddWalkInAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "No church" };

    const firstName = (formData.get("firstName") as string)?.trim();
    const lastName = (formData.get("lastName") as string)?.trim();
    const email = (formData.get("email") as string)?.trim() || undefined;
    const phone = (formData.get("phone") as string)?.trim() || undefined;

    if (!firstName || !lastName) {
      return { success: false, error: "First and last name are required" };
    }

    const person = await createPerson(user.churchId, user.id, {
      firstName,
      lastName,
      email,
      phone,
      country: "US",
      status: "prospect",
    });

    const { addToGuestList } = await import("@/lib/meetings/guest-list");
    const record = await addToGuestList(user.churchId, meetingId, person.id, user.id);

    // Mark as attended
    await db
      .update(meetingAttendance)
      .set({ status: "attended", updatedAt: new Date() })
      .where(eq(meetingAttendance.id, record.id));

    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/people");
    return { success: true, data: record };
  } catch (error) {
    console.error("quickAddWalkInAction error:", error);
    return { success: false, error: "Failed to add walk-in" };
  }
}
