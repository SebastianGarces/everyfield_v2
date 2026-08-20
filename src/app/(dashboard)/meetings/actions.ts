"use server";

import { requireSeat } from "@/lib/auth/seats";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  churchMeetings,
  meetingAttendance,
  responseStatuses,
} from "@/db/schema/meetings";
import { personActivities } from "@/db/schema/people";
// Statically imported, not `await import(…)` per call. Six actions below each
// lazy-imported one of these — including `responseStatuses`, which arrived by a
// SECOND import of a module this file already imports statically. Nothing here
// is optional, this module never reaches a browser, and a dynamic import of a
// static dependency only hides the dependency from a reader and from every
// import-graph walk the repo runs.
import {
  addToGuestList,
  removeFromGuestList,
  updateRsvpStatus,
} from "@/lib/meetings/guest-list";
import { deriveAttendanceType } from "@/lib/meetings/attendance-type";
import type { AgendaSaveResult, AgendaSection } from "@/lib/meetings/agenda";
import type {
  ChurchMeeting,
  Location,
  MeetingAttendanceRecord,
  MeetingChecklistItem,
  MeetingEvaluation,
} from "@/db/schema";
import type { ResponseStatus } from "@/db/schema/meetings";
import { createPerson } from "@/lib/people/service";
import { setMeetingAgenda } from "@/lib/meetings/service";
import {
  attendanceCreateSchema,
  attendanceBatchSchema,
  attendeeQuickAddSchema,
  checklistItemUpdateSchema,
  evaluationCreateSchema,
  locationCreateSchema,
  locationUpdateSchema,
  meetingCreateSchema,
  meetingStatusSchema,
  meetingUpdateSchema,
  responseCardRecordSchema,
} from "@/lib/validations/meetings";
import { createLocation, updateLocation } from "@/lib/meetings/locations";
import {
  addAttendee,
  createEvaluation,
  createMeeting,
  deleteMeeting,
  finalizeAttendance,
  FinalizeAttendanceError,
  recordAttendanceBatch,
  removeAttendee,
  updateChecklistItem,
  updateMeeting,
  updateMeetingStatus,
} from "@/lib/meetings/service";
import {
  clearMeetingResponse,
  MeetingResponseError,
  recordMeetingResponse,
} from "@/lib/meetings/response-queries";
import type { ActionResult } from "@/lib/meetings/types";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

/**
 * Resolve the attendance_type for a person being marked attended at a meeting,
 * scoped to the church. Returns null if the meeting can't be found for this
 * church (caller should leave attendance_type untouched in that case).
 */
async function resolveAttendanceType(
  churchId: string,
  meetingId: string,
  personId: string
) {
  const [meeting] = await db
    .select({ datetime: churchMeetings.datetime })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.id, meetingId),
        eq(churchMeetings.churchId, churchId)
      )
    )
    .limit(1);

  if (!meeting) return null;

  return deriveAttendanceType(personId, meetingId, meeting.datetime, db);
}

// ============================================================================
// Meeting Actions
// ============================================================================

export async function createMeetingAction(
  prevState: ActionResult<ChurchMeeting> | null,
  formData: FormData
): Promise<ActionResult<ChurchMeeting>> {
  let meetingId: string;

  try {
    const { user } = await requireSeat("meetings.write");

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create meetings",
      };
    }

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

    const meeting = await createMeeting(user.churchId, user.id, parsed.data);
    revalidatePath("/meetings");
    meetingId = meeting.id;
  } catch (error) {
    console.error("createMeetingAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }
    return {
      success: false,
      error: "An unexpected error occurred while creating the meeting",
    };
  }

  redirect(`/meetings/${meetingId}`);
}

export async function updateMeetingAction(
  meetingId: string,
  prevState: ActionResult<ChurchMeeting> | null,
  formData: FormData
): Promise<ActionResult<ChurchMeeting>> {
  try {
    const { user } = await requireSeat("meetings.write");

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update meetings",
      };
    }

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

    const meeting = await updateMeeting(user.churchId, meetingId, parsed.data);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);

    return { success: true, data: meeting };
  } catch (error) {
    console.error("updateMeetingAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized")
        return { success: false, error: "You must be logged in" };
      if (error.message === "Meeting not found")
        return {
          success: false,
          error: "Meeting not found or has been deleted",
        };
    }
    return {
      success: false,
      error: "An unexpected error occurred while updating the meeting",
    };
  }
}

export async function deleteMeetingAction(
  meetingId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await requireSeat("meetings.write");

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to delete meetings",
      };
    }

    await deleteMeeting(user.churchId, meetingId);
    revalidatePath("/meetings");

    return { success: true, data: undefined };
  } catch (error) {
    console.error("deleteMeetingAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized")
        return { success: false, error: "You must be logged in" };
      if (error.message === "Meeting not found")
        return {
          success: false,
          error: "Meeting not found or has already been deleted",
        };
    }
    return {
      success: false,
      error: "An unexpected error occurred while deleting the meeting",
    };
  }
}

export async function updateMeetingStatusAction(
  meetingId: string,
  newStatus: string
): Promise<ActionResult<ChurchMeeting>> {
  try {
    const { user } = await requireSeat("meetings.write");

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update meetings",
      };
    }

    const statusResult = meetingStatusSchema.safeParse(newStatus);
    if (!statusResult.success) {
      return { success: false, error: "Invalid meeting status value" };
    }

    const meeting = await updateMeetingStatus(
      user.churchId,
      meetingId,
      statusResult.data
    );
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);

    return { success: true, data: meeting };
  } catch (error) {
    console.error("updateMeetingStatusAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized")
        return { success: false, error: "You must be logged in" };
      if (error.message === "Meeting not found")
        return {
          success: false,
          error: "Meeting not found or has been deleted",
        };
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

export async function createLocationAction(
  formData: FormData
): Promise<ActionResult<Location>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to create locations",
      };

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

    const location = await createLocation(user.churchId, parsed.data);
    revalidatePath("/meetings");
    return { success: true, data: location };
  } catch (error) {
    console.error("createLocationAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return {
      success: false,
      error: "An unexpected error occurred while creating the location",
    };
  }
}

export async function updateLocationAction(
  locationId: string,
  formData: FormData
): Promise<ActionResult<Location>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to update locations",
      };

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

    const location = await updateLocation(
      user.churchId,
      locationId,
      parsed.data
    );
    revalidatePath("/meetings");
    return { success: true, data: location };
  } catch (error) {
    console.error("updateLocationAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized")
        return { success: false, error: "You must be logged in" };
      if (error.message === "Location not found")
        return {
          success: false,
          error: "Location not found or has been deleted",
        };
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

export async function addAttendeeAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to record attendance",
      };

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
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: record };
  } catch (error) {
    console.error("addAttendeeAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return {
      success: false,
      error: "An unexpected error occurred while adding the attendee",
    };
  }
}

export async function quickAddAttendeeAction(
  meetingId: string,
  formData: FormData
): Promise<ActionResult<MeetingAttendanceRecord>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to record attendance",
      };

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

    const person = await createPerson(
      user.churchId,
      user.id,
      {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        phone: parsed.data.phone,
        source: "vision_meeting",
        status: "prospect",
        country: "US",
      },
      "meeting_attendance"
    );

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
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return {
      success: false,
      error: "An unexpected error occurred while adding the attendee",
    };
  }
}

export async function removeAttendeeAction(
  meetingId: string,
  personId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to manage attendance",
      };

    await removeAttendee(user.churchId, meetingId, personId);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("removeAttendeeAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Unauthorized")
        return { success: false, error: "You must be logged in" };
      if (error.message === "Attendance record not found")
        return {
          success: false,
          error: "Attendance record not found or already removed",
        };
    }
    return {
      success: false,
      error: "An unexpected error occurred while removing the attendee",
    };
  }
}

/**
 * Finalize attendance for a meeting.
 *
 * `finalizeAttendance` is idempotent and never leaves a meeting half-finalized
 * (see the block comment above it in `src/lib/meetings/service.ts`), so this
 * action is safe to retry: a repeat click reconciles the count at most, and a
 * downstream failure leaves the meeting un-finalized with a message that says
 * so rather than a generic error.
 */
export async function finalizeAttendanceAction(
  meetingId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to finalize attendance",
      };

    await finalizeAttendance(user.churchId, meetingId);
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("finalizeAttendanceAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    if (error instanceof FinalizeAttendanceError)
      return {
        success: false,
        error:
          "We couldn't create the follow-up tasks, so this meeting was not finalized. Please try again.",
      };
    return {
      success: false,
      error: "An unexpected error occurred while finalizing attendance",
    };
  }
}

export async function recordAttendanceBatchAction(
  meetingId: string,
  records: { personId: string; status: "attended" | "absent" | "excused" }[]
): Promise<ActionResult<void>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to record attendance",
      };

    const parsed = attendanceBatchSchema.safeParse({ records });
    if (!parsed.success) {
      return { success: false, error: "Validation failed" };
    }

    await recordAttendanceBatch(
      user.churchId,
      meetingId,
      parsed.data.records,
      user.id
    );
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/teams");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("recordAttendanceBatchAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return {
      success: false,
      error: "An unexpected error occurred while recording attendance",
    };
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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId)
      return {
        success: false,
        error: "You must be associated with a church to evaluate meetings",
      };

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
    revalidatePath("/meetings");
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath(`/meetings/${meetingId}/evaluation`);
    return { success: true, data: evaluation };
  } catch (error) {
    console.error("createEvaluationAction error:", error);
    if (error instanceof Error && error.message === "Unauthorized")
      return { success: false, error: "You must be logged in" };
    return {
      success: false,
      error: "An unexpected error occurred while saving the evaluation",
    };
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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const item = await updateChecklistItem(user.churchId, itemId, {
      isChecked,
    });
    revalidatePath("/meetings");
    return { success: true, data: item };
  } catch (error) {
    console.error("toggleChecklistItemAction error:", error);
    if (error instanceof Error && error.message === "Checklist item not found")
      return { success: false, error: "Checklist item not found" };
    return { success: false, error: "Failed to update checklist item" };
  }
}

export async function updateChecklistItemAction(
  itemId: string,
  formData: FormData
): Promise<ActionResult<MeetingChecklistItem>> {
  try {
    const { user } = await requireSeat("meetings.write");
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
    revalidatePath("/meetings");
    return { success: true, data: item };
  } catch (error) {
    console.error("updateChecklistItemAction error:", error);
    if (error instanceof Error && error.message === "Checklist item not found")
      return { success: false, error: "Checklist item not found" };
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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

    const record = await addToGuestList(
      user.churchId,
      meetingId,
      personId,
      user.id
    );
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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

    if (!responseStatuses.includes(status as ResponseStatus)) {
      return { success: false, error: "Invalid status" };
    }
    await updateRsvpStatus(
      user.churchId,
      meetingId,
      personId,
      status as ResponseStatus
    );
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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

    const firstName = (formData.get("firstName") as string)?.trim();
    const lastName = (formData.get("lastName") as string)?.trim();
    const email = (formData.get("email") as string)?.trim() || undefined;
    const phone = (formData.get("phone") as string)?.trim() || undefined;

    if (!firstName || !lastName) {
      return { success: false, error: "First and last name are required" };
    }

    // Create person in the People database
    const person = await createPerson(
      user.churchId,
      user.id,
      {
        firstName,
        lastName,
        email,
        phone,
        country: "US",
        status: "prospect",
      },
      "meeting_guest_list"
    );

    // Add to guest list
    const record = await addToGuestList(
      user.churchId,
      meetingId,
      person.id,
      user.id
    );

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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

    // Only set attendance_type when marking attended; clear it when un-marking.
    const attendanceType = attended
      ? await resolveAttendanceType(user.churchId, meetingId, personId)
      : null;

    await db
      .update(meetingAttendance)
      .set({
        status: attended ? "attended" : "absent",
        attendanceType,
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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

    const record = await addToGuestList(
      user.churchId,
      meetingId,
      personId,
      user.id
    );

    // Mark as attended immediately
    const attendanceType = await resolveAttendanceType(
      user.churchId,
      meetingId,
      personId
    );
    await db
      .update(meetingAttendance)
      .set({ status: "attended", attendanceType, updatedAt: new Date() })
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
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

    const firstName = (formData.get("firstName") as string)?.trim();
    const lastName = (formData.get("lastName") as string)?.trim();
    const email = (formData.get("email") as string)?.trim() || undefined;
    const phone = (formData.get("phone") as string)?.trim() || undefined;

    if (!firstName || !lastName) {
      return { success: false, error: "First and last name are required" };
    }

    const person = await createPerson(
      user.churchId,
      user.id,
      {
        firstName,
        lastName,
        email,
        phone,
        country: "US",
        status: "prospect",
      },
      "meeting_guest_list"
    );

    const record = await addToGuestList(
      user.churchId,
      meetingId,
      person.id,
      user.id
    );

    // Mark as attended
    const attendanceType = await resolveAttendanceType(
      user.churchId,
      meetingId,
      person.id
    );
    await db
      .update(meetingAttendance)
      .set({ status: "attended", attendanceType, updatedAt: new Date() })
      .where(eq(meetingAttendance.id, record.id));

    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/people");
    return { success: true, data: record };
  } catch (error) {
    console.error("quickAddWalkInAction error:", error);
    return { success: false, error: "Failed to add walk-in" };
  }
}

// ============================================================================
// Attendee Note Action
// ============================================================================

/**
 * Add a note for an individual attendee during meeting evaluation.
 * Creates a person_activities record with activityType "note_added"
 * and metadata linking to the meeting.
 */
export async function addAttendeeNoteAction(
  personId: string,
  meetingId: string,
  meetingType: string,
  note: string
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireSeat("meetings.write");
    if (!user.churchId) return { success: false, error: "No church" };

    const trimmedNote = note.trim();
    if (!trimmedNote) {
      return { success: false, error: "Note cannot be empty" };
    }

    if (trimmedNote.length > 5000) {
      return { success: false, error: "Note must be under 5000 characters" };
    }

    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId,
      activityType: "note_added",
      metadata: {
        note: trimmedNote,
        meetingId,
        meetingType,
      },
      performedBy: user.id,
    });

    revalidatePath(`/meetings/${meetingId}/evaluation`);
    revalidatePath(`/people/${personId}`);
    return { success: true, data: null };
  } catch (error) {
    console.error("addAttendeeNoteAction error:", error);
    return { success: false, error: "Failed to save note" };
  }
}

// ============================================================================
// Response Card Actions (VM-014)
// ============================================================================
//
// SESSION FIRST, ABOVE THE `try`, on both exports (memory/invariants.md →
// Authentication). Every export of this module is a POSTable endpoint reachable
// with no session and no UI, so a sessionless caller must THROW rather than
// become a handled `{ success: false }` — which is what a mint inside the `try`
// turns it into. The 45 older exports above that do mint inside their `try` are
// the named residual `TRY_WRAPPED_MINTS`; nothing new joins it.
//
// THEN THE PARSE, and it is a `z.strictObject`: `responseCardRecordSchema` is
// built from the one response-card vocabulary, so what the control offers and
// what this accepts cannot drift, and an unknown key is a refusal rather than
// something silently dropped on its way to a SET.

export async function recordResponseCardAction(
  meetingId: string,
  input: unknown
): Promise<ActionResult<null>> {
  const { user } = await requireSeat("meetings.write");

  try {
    if (!user.churchId) return { success: false, error: "No church" };

    const parsed = responseCardRecordSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid response card" };
    }

    await recordMeetingResponse(user.churchId, meetingId, {
      personId: parsed.data.personId,
      responseType: parsed.data.responseType,
      notes: parsed.data.notes ?? null,
      recordedById: user.id,
    });

    revalidatePath(`/meetings/${meetingId}/attendance`);
    revalidatePath(`/meetings/${meetingId}/outcomes`);
    return { success: true, data: null };
  } catch (error) {
    console.error("recordResponseCardAction error:", error);
    if (error instanceof MeetingResponseError) {
      return { success: false, error: "That person is not on this meeting" };
    }
    return { success: false, error: "Failed to record the response card" };
  }
}

/**
 * Take a card back off an attendee — the way back to "no card recorded", which
 * is a different state from every value in the vocabulary, `not_interested`
 * included. Without it a mis-key could only be corrected to another response,
 * forcing the planter to assert something nobody said.
 */
export async function clearResponseCardAction(
  meetingId: string,
  personId: string
): Promise<ActionResult<null>> {
  const { user } = await requireSeat("meetings.write");

  try {
    if (!user.churchId) return { success: false, error: "No church" };

    await clearMeetingResponse(user.churchId, meetingId, personId);

    revalidatePath(`/meetings/${meetingId}/attendance`);
    revalidatePath(`/meetings/${meetingId}/outcomes`);
    return { success: true, data: null };
  } catch (error) {
    console.error("clearResponseCardAction error:", error);
    return { success: false, error: "Failed to clear the response card" };
  }
}

/**
 * Save this meeting's running order (VM-013).
 *
 * IT WAS AN INLINE `"use server"` CLOSURE in `meetings/[id]/page.tsx` (#498
 * review). A function-level directive publishes a POST endpoint just as a
 * module-level one does, but it is invisible to the export-walk that enforces
 * the seat guard — so this write sat outside the auth surface that walk claims
 * to cover. Here it is an export like every other meetings write, guarded the
 * same way.
 *
 * It takes no actor — the church comes from the guard and `setMeetingAgenda`
 * puts it in the `WHERE`, so a meeting id from another tenant matches nothing.
 * `refresh()`, not `revalidatePath` (memory/contracts/data-patterns.md).
 */
export async function saveAgendaAction(
  meetingId: string,
  sections: AgendaSection[]
): Promise<AgendaSaveResult> {
  const { user } = await requireSeat("meetings.write");

  if (!user.churchId) {
    return { success: false, error: "This account has no church yet." };
  }

  try {
    await setMeetingAgenda(user.churchId, meetingId, sections);
  } catch {
    return {
      success: false,
      error: "The agenda could not be saved. Try again.",
    };
  }

  refresh();
  return { success: true };
}
