"use server";

import { db } from "@/db";
import {
  personActivities,
  type Assessment,
  type Commitment,
  type Interview,
} from "@/db/schema";
import { persons } from "@/db/schema/people";
import { verifySession } from "@/lib/auth/session";
import { getActivities } from "@/lib/people/activity";
import { createAssessment, createInterview } from "@/lib/people/assessments";
import { createCommitment, getCommitment } from "@/lib/people/commitments";
import { checkForDuplicates } from "@/lib/people/duplicates";
import { emitPersonStatusChanged } from "@/lib/people/events";
import {
  executeBulkImport,
  generateCsvTemplate,
  parseCsvImport,
} from "@/lib/people/import";
import {
  createPerson,
  deletePerson,
  getPerson,
  updatePerson,
} from "@/lib/people/service";
import { changeStatus } from "@/lib/people/status";
import { isBackwardProgression } from "@/lib/people/status.shared";
import {
  assignTag,
  createTag,
  deleteTag,
  listTags,
  removeTag,
  updateTag,
} from "@/lib/people/tags";
import type {
  ActionResult,
  DuplicateCheck,
  ImportPreview,
  ImportRow,
  ImportSummary,
  Person,
  PersonStatus,
  StatusTransition,
  Tag,
} from "@/lib/people/types";
import {
  getExtensionFromMimeType,
  getSignedDownloadUrl,
  isAllowedCommitmentFileType,
  isValidCommitmentFileSize,
  uploadFile,
} from "@/lib/storage";
import {
  assessmentCreateSchema,
  commitmentCreateSchema,
  interviewCreateSchema,
  personCreateSchema,
  personQuickAddSchema,
  personStatusSchema,
  personUpdateSchema,
  tagCreateSchema,
  tagUpdateSchema,
} from "@/lib/validations/people";
import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";

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

/**
 * Create a new person
 */
export async function createPersonAction(
  formData: FormData
): Promise<ActionResult<Person>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create people",
      };
    }

    // Parse and validate form data
    const rawData = formDataToObject(formData);
    const parsed = personCreateSchema.safeParse(rawData);

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

    // Create the person
    const person = await createPerson(user.churchId, user.id, parsed.data);

    // Revalidate the people list
    revalidatePath("/people");

    return {
      success: true,
      data: person,
    };
  } catch (error) {
    console.error("createPersonAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to create people",
      };
    }

    return {
      success: false,
      error: "An unexpected error occurred while creating the person",
    };
  }
}

/**
 * Update an existing person
 */
export async function updatePersonAction(
  personId: string,
  formData: FormData
): Promise<ActionResult<Person>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update people",
      };
    }

    // Parse and validate form data
    const rawData = formDataToObject(formData);
    const parsed = personUpdateSchema.safeParse(rawData);

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

    // Get the existing person to detect status changes
    const existing = await getPerson(user.churchId, personId);
    if (!existing) {
      return {
        success: false,
        error: "Person not found or has been deleted",
      };
    }

    const oldStatus = existing.status;
    const newStatus = parsed.data.status;

    // Update the person
    const person = await updatePerson(user.churchId, personId, parsed.data);

    // Log status change activity if status changed
    if (newStatus && newStatus !== oldStatus) {
      const isBackward = isBackwardProgression(oldStatus, newStatus);

      // Build activity metadata
      const metadata: Record<string, unknown> = {
        oldStatus,
        newStatus,
        source: "profile_edit", // Track that this came from profile edit
      };

      // Log the activity
      await db.insert(personActivities).values({
        churchId: user.churchId,
        personId: personId,
        activityType: "status_changed",
        metadata,
        performedBy: user.id,
      });

      // Emit event
      await emitPersonStatusChanged(person, oldStatus, newStatus);

      // If backward movement, we still log it but user wasn't prompted for reason
      // The activity will show it was from profile edit
      if (isBackward) {
        console.log(
          `[STATUS] Backward movement via profile edit: ${oldStatus} -> ${newStatus} for person ${personId}`
        );
      }
    }

    // Revalidate the people list and detail page
    revalidatePath("/people");
    revalidatePath(`/people/${personId}`);

    return {
      success: true,
      data: person,
    };
  } catch (error) {
    console.error("updatePersonAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in to update people",
        };
      }

      if (error.message === "Person not found") {
        return {
          success: false,
          error: "Person not found or has been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while updating the person",
    };
  }
}

/**
 * Delete (soft delete) a person
 */
export async function deletePersonAction(
  personId: string
): Promise<ActionResult<void>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to delete people",
      };
    }

    // Delete (soft) the person
    await deletePerson(user.churchId, personId);

    // Revalidate the people list
    revalidatePath("/people");

    return {
      success: true,
      data: undefined,
    };
  } catch (error) {
    console.error("deletePersonAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in to delete people",
        };
      }

      if (error.message === "Person not found") {
        return {
          success: false,
          error: "Person not found or has already been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while deleting the person",
    };
  }
}

/**
 * Change a person's status (for drag-and-drop in pipeline view)
 * Uses the status service for validation, activity logging, and event emission.
 */
export async function changeStatusAction(
  personId: string,
  newStatus: PersonStatus
): Promise<ActionResult<{ person: Person }>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update people",
      };
    }

    // Validate the newStatus
    const statusResult = personStatusSchema.safeParse(newStatus);
    if (!statusResult.success) {
      return {
        success: false,
        error: "Invalid status value",
      };
    }

    // Use the status service to change status (handles validation, logging, events)
    const result = await changeStatus(
      user.churchId,
      personId,
      user.id,
      newStatus
    );

    // Revalidate the people pages
    revalidatePath("/people");

    return {
      success: true,
      data: { person: result.person },
    };
  } catch (error) {
    console.error("changeStatusAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in to update people",
        };
      }
      if (error.message === "Person not found") {
        return {
          success: false,
          error: "Person not found or has been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while updating the person status",
    };
  }
}

/**
 * Change a person's status with an optional reason (for manual status changes via modal).
 * Returns transition details including any warnings that were shown.
 */
export async function changeStatusWithReasonAction(
  personId: string,
  newStatus: PersonStatus,
  reason?: string
): Promise<ActionResult<{ person: Person; transition: StatusTransition }>> {
  try {
    // Verify session - throws if unauthorized
    const { user } = await verifySession();

    // Ensure user has a church
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update people",
      };
    }

    // Validate the newStatus
    const statusResult = personStatusSchema.safeParse(newStatus);
    if (!statusResult.success) {
      return {
        success: false,
        error: "Invalid status value",
      };
    }

    // Use the status service to change status with reason
    const result = await changeStatus(
      user.churchId,
      personId,
      user.id,
      newStatus,
      reason
    );

    // Revalidate the people pages - this invalidates the cache so next
    // navigation or router refresh will fetch fresh data
    revalidatePath("/people");
    revalidatePath(`/people/${personId}`);

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error("changeStatusWithReasonAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in to update people",
        };
      }
      if (error.message === "Person not found") {
        return {
          success: false,
          error: "Person not found or has been deleted",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while updating the person status",
    };
  }
}

/**
 * Add a note to a person's activity timeline.
 * Uses refresh() to update the client router with fresh server state.
 * Client uses useOptimistic for instant UI feedback.
 */
export async function addNoteAction(
  personId: string,
  note: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "Unauthorized" };
    }

    if (!note || note.trim().length === 0) {
      return { success: false, error: "Note cannot be empty" };
    }

    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId: personId,
      activityType: "note_added",
      metadata: { note },
      performedBy: user.id,
    });

    // Refresh the client router to show the new note
    // This reconciles the optimistic update with actual server state
    refresh();

    return { success: true, data: undefined };
  } catch (error) {
    console.error("addNoteAction error:", error);
    return { success: false, error: "Failed to add note" };
  }
}

/**
 * Delete a note from a person's activity timeline.
 * Uses refresh() to update the client router with fresh server state.
 * Client uses useOptimistic for instant UI feedback.
 */
export async function deleteNoteAction(
  personId: string,
  activityId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "Unauthorized" };
    }

    // Check if the activity exists and is a note created by the user
    const existing = await db.query.personActivities.findFirst({
      where: and(
        eq(personActivities.id, activityId),
        eq(personActivities.churchId, user.churchId),
        eq(personActivities.activityType, "note_added"),
        eq(personActivities.performedBy, user.id)
      ),
    });

    if (!existing) {
      return {
        success: false,
        error: "Note not found or you don't have permission to delete it",
      };
    }

    await db
      .delete(personActivities)
      .where(eq(personActivities.id, activityId));

    // Refresh the client router to reflect the deletion
    refresh();

    return { success: true, data: undefined };
  } catch (error) {
    console.error("deleteNoteAction error:", error);
    return { success: false, error: "Failed to delete note" };
  }
}

/**
 * Fetch more activities for pagination
 */
export async function getMoreActivitiesAction(personId: string, cursor: Date) {
  const { user } = await verifySession();
  if (!user.churchId) throw new Error("Unauthorized");
  return getActivities(user.churchId, personId, { cursor, limit: 10 });
}

/**
 * List all tags for the church
 */
export async function listTagsAction(): Promise<ActionResult<Tag[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const tags = await listTags(user.churchId);
    return { success: true, data: tags };
  } catch (error) {
    console.error("listTagsAction error:", error);
    return { success: false, error: "Failed to list tags" };
  }
}

/**
 * Create a new tag
 */
export async function createTagAction(
  name: string,
  color?: string
): Promise<ActionResult<Tag>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Validate input
    const parsed = tagCreateSchema.safeParse({ name, color });
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

    const tag = await createTag(
      user.churchId,
      parsed.data.name,
      parsed.data.color
    );
    revalidatePath("/people");
    return { success: true, data: tag };
  } catch (error) {
    console.error("createTagAction error:", error);
    return { success: false, error: "Failed to create tag" };
  }
}

/**
 * Update an existing tag
 */
export async function updateTagAction(
  tagId: string,
  data: { name?: string; color?: string | null }
): Promise<ActionResult<Tag>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Validate input
    const parsed = tagUpdateSchema.safeParse(data);
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

    // Convert null to undefined for service layer
    const updateData = {
      name: parsed.data.name,
      color: parsed.data.color ?? undefined,
    };

    const tag = await updateTag(user.churchId, tagId, updateData);
    revalidatePath("/people");
    return { success: true, data: tag };
  } catch (error) {
    console.error("updateTagAction error:", error);

    if (error instanceof Error && error.message === "Tag not found") {
      return { success: false, error: "Tag not found" };
    }

    return { success: false, error: "Failed to update tag" };
  }
}

/**
 * Assign a tag to a person
 */
export async function assignTagAction(
  personId: string,
  tagId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    await assignTag(user.churchId, personId, tagId, user.id);

    revalidatePath(`/people/${personId}`);
    revalidatePath("/people");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("assignTagAction error:", error);
    return { success: false, error: "Failed to assign tag" };
  }
}

/**
 * Remove a tag from a person
 */
export async function removeTagAction(
  personId: string,
  tagId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    await removeTag(user.churchId, personId, tagId, user.id);

    revalidatePath(`/people/${personId}`);
    revalidatePath("/people");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("removeTagAction error:", error);
    return { success: false, error: "Failed to remove tag" };
  }
}

/**
 * Delete a tag
 */
export async function deleteTagAction(
  tagId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    await deleteTag(user.churchId, tagId);

    revalidatePath("/people");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("deleteTagAction error:", error);
    return { success: false, error: "Failed to delete tag" };
  }
}

// ============================================================================
// Assessment Actions (4 C's)
// ============================================================================

/**
 * Create a 4 C's assessment for a person.
 * Logs assessment_completed activity.
 */
export async function createAssessmentAction(
  personId: string,
  data: {
    committedScore: number;
    committedNotes?: string;
    compelledScore: number;
    compelledNotes?: string;
    contagiousScore: number;
    contagiousNotes?: string;
    courageousScore: number;
    courageousNotes?: string;
    assessmentDate: string;
  }
): Promise<ActionResult<Assessment>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Validate input
    const parsed = assessmentCreateSchema.safeParse({
      personId,
      ...data,
    });

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

    // Create the assessment
    const assessment = await createAssessment(
      user.churchId,
      user.id,
      parsed.data
    );

    // Log activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId,
      activityType: "assessment_completed",
      metadata: {
        assessmentId: assessment.id,
        totalScore: assessment.totalScore,
        committedScore: assessment.committedScore,
        compelledScore: assessment.compelledScore,
        contagiousScore: assessment.contagiousScore,
        courageousScore: assessment.courageousScore,
      },
      performedBy: user.id,
    });

    revalidatePath(`/people/${personId}`);
    revalidatePath(`/people/${personId}/assessments`);

    return { success: true, data: assessment };
  } catch (error) {
    console.error("createAssessmentAction error:", error);
    return { success: false, error: "Failed to create assessment" };
  }
}

// ============================================================================
// Interview Actions
// ============================================================================

/**
 * Create an interview record for a person.
 * Logs interview_completed activity and auto-advances to 'interviewed' status.
 */
export async function createInterviewAction(
  personId: string,
  data: {
    interviewDate: string;
    maturityStatus: "pass" | "fail" | "concern";
    maturityNotes?: string;
    giftedStatus: "pass" | "fail" | "concern";
    giftedNotes?: string;
    chemistryStatus: "pass" | "fail" | "concern";
    chemistryNotes?: string;
    rightReasonsStatus: "pass" | "fail" | "concern";
    rightReasonsNotes?: string;
    seasonStatus: "pass" | "fail" | "concern";
    seasonNotes?: string;
    overallResult:
      | "qualified"
      | "qualified_with_notes"
      | "not_qualified"
      | "follow_up";
    nextSteps?: string;
  }
): Promise<ActionResult<Interview>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Validate input
    const parsed = interviewCreateSchema.safeParse({
      personId,
      ...data,
    });

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

    // Create the interview
    const interview = await createInterview(
      user.churchId,
      user.id,
      parsed.data
    );

    // Log interview_completed activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId,
      activityType: "interview_completed",
      metadata: {
        interviewId: interview.id,
        overallResult: interview.overallResult,
        maturityStatus: interview.maturityStatus,
        giftedStatus: interview.giftedStatus,
        chemistryStatus: interview.chemistryStatus,
        rightReasonsStatus: interview.rightReasonsStatus,
        seasonStatus: interview.seasonStatus,
      },
      performedBy: user.id,
    });

    // Auto-advance to 'interviewed' status
    // changeStatus handles activity logging and event emission
    await changeStatus(user.churchId, personId, user.id, "interviewed");

    revalidatePath(`/people/${personId}`);
    revalidatePath(`/people/${personId}/assessments`);
    revalidatePath("/people");

    return { success: true, data: interview };
  } catch (error) {
    console.error("createInterviewAction error:", error);
    return { success: false, error: "Failed to create interview" };
  }
}

// ============================================================================
// Commitment Actions
// ============================================================================

/**
 * Create a commitment record for a person.
 * Handles file upload if a document is provided.
 * Logs commitment_recorded activity and auto-advances to 'core_group' status.
 */
export async function createCommitmentAction(
  formData: FormData
): Promise<ActionResult<Commitment>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Extract form fields
    const personId = formData.get("personId") as string;
    const commitmentType = formData.get("commitmentType") as string;
    const signedDate = formData.get("signedDate") as string;
    const witnessedBy = formData.get("witnessedBy") as string | null;
    const notes = formData.get("notes") as string | null;
    const file = formData.get("document") as File | null;

    // Validate input
    const parsed = commitmentCreateSchema.safeParse({
      personId,
      commitmentType,
      signedDate,
      witnessedBy: witnessedBy || undefined,
      notes: notes || undefined,
    });

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

    // Handle file upload if provided
    let documentKey: string | undefined;

    if (file && file.size > 0) {
      // Validate file type
      if (!isAllowedCommitmentFileType(file.type)) {
        return {
          success: false,
          error: "Invalid file type. Only PDF, JPG, and PNG files are allowed.",
        };
      }

      // Validate file size
      if (!isValidCommitmentFileSize(file.size)) {
        return {
          success: false,
          error: "File is too large. Maximum size is 10MB.",
        };
      }

      // Generate a temporary ID for the file key (will be replaced with actual commitment ID)
      const tempId = crypto.randomUUID();
      const extension = getExtensionFromMimeType(file.type);
      documentKey = `commitments/${user.churchId}/${personId}/${tempId}.${extension}`;

      // Upload the file
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      await uploadFile(documentKey, fileBuffer, file.type);
    }

    // Create the commitment
    const commitment = await createCommitment(
      user.churchId,
      user.id,
      parsed.data,
      documentKey
    );

    // Log commitment_recorded activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId,
      activityType: "commitment_recorded",
      metadata: {
        commitmentId: commitment.id,
        commitmentType: commitment.commitmentType,
        signedDate: commitment.signedDate,
        hasDocument: !!documentKey,
      },
      performedBy: user.id,
    });

    // Auto-advance to 'core_group' status (commitment = Core Group entry)
    // changeStatus handles activity logging and event emission
    await changeStatus(user.churchId, personId, user.id, "core_group");

    revalidatePath(`/people/${personId}`);
    revalidatePath(`/people/${personId}/assessments`);
    revalidatePath("/people");

    return { success: true, data: commitment };
  } catch (error) {
    console.error("createCommitmentAction error:", error);
    return { success: false, error: "Failed to create commitment" };
  }
}

/**
 * Get a signed download URL for a commitment document.
 * The URL triggers a browser download when accessed.
 */
export async function getCommitmentDownloadUrlAction(
  commitmentId: string
): Promise<ActionResult<{ url: string }>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Get the commitment to verify access and get the document key
    const commitment = await getCommitment(user.churchId, commitmentId);

    if (!commitment) {
      return { success: false, error: "Commitment not found" };
    }

    if (!commitment.documentUrl) {
      return {
        success: false,
        error: "No document attached to this commitment",
      };
    }

    // Generate filename for download
    const extension = commitment.documentUrl.split(".").pop() || "pdf";
    const filename = `commitment-${commitment.commitmentType}-${commitment.signedDate}.${extension}`;

    // Generate signed URL with Content-Disposition header
    const url = await getSignedDownloadUrl(
      commitment.documentUrl,
      filename,
      3600 // 1 hour expiry
    );

    return { success: true, data: { url } };
  } catch (error) {
    console.error("getCommitmentDownloadUrlAction error:", error);
    return { success: false, error: "Failed to generate download URL" };
  }
}

// ============================================================================
// Household Actions
// ============================================================================

import type {
  Household,
  HouseholdRole,
  SkillCategory,
  SkillInventory,
  SkillProficiency,
} from "@/db/schema";
import {
  addToHousehold,
  createHousehold,
  createHouseholdFromPerson,
  deleteHousehold,
  getHousehold,
  getHouseholdMembers,
  listHouseholds,
  propagateAddress,
  removeFromHousehold,
  updateHousehold,
} from "@/lib/people/household";
import {
  addSkill,
  getPersonSkills,
  getSkill,
  removeSkill,
  updateSkill,
} from "@/lib/people/skills";
import {
  householdCreateSchema,
  householdUpdateSchema,
  skillCreateSchema,
} from "@/lib/validations/people";

/**
 * List all households for the church
 */
export async function listHouseholdsAction(): Promise<
  ActionResult<Household[]>
> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const households = await listHouseholds(user.churchId);
    return { success: true, data: households };
  } catch (error) {
    console.error("listHouseholdsAction error:", error);
    return { success: false, error: "Failed to list households" };
  }
}

/**
 * Create a new household
 */
export async function createHouseholdAction(data: {
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}): Promise<ActionResult<Household>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const parsed = householdCreateSchema.safeParse(data);
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

    const household = await createHousehold(user.churchId, parsed.data);
    revalidatePath("/people");
    return { success: true, data: household };
  } catch (error) {
    console.error("createHouseholdAction error:", error);
    return { success: false, error: "Failed to create household" };
  }
}

/**
 * Create a household from a person's address and add them as head
 */
export async function createHouseholdFromPersonAction(
  personId: string,
  householdName: string
): Promise<ActionResult<{ household: Household; person: Person }>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const result = await createHouseholdFromPerson(
      user.churchId,
      personId,
      householdName
    );

    // Log activity for household creation
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId,
      activityType: "household_created",
      metadata: {
        householdName: result.household.name,
        householdId: result.household.id,
        role: "head",
      },
      performedBy: user.id,
    });

    revalidatePath("/people");
    revalidatePath(`/people/${personId}`);
    return { success: true, data: result };
  } catch (error) {
    console.error("createHouseholdFromPersonAction error:", error);
    if (error instanceof Error && error.message === "Person not found") {
      return { success: false, error: "Person not found" };
    }
    return { success: false, error: "Failed to create household" };
  }
}

/**
 * Update an existing household
 */
export async function updateHouseholdAction(
  householdId: string,
  data: {
    name?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }
): Promise<ActionResult<Household>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const parsed = householdUpdateSchema.safeParse(data);
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

    const household = await updateHousehold(
      user.churchId,
      householdId,
      parsed.data
    );
    revalidatePath("/people");
    return { success: true, data: household };
  } catch (error) {
    console.error("updateHouseholdAction error:", error);
    if (error instanceof Error && error.message === "Household not found") {
      return { success: false, error: "Household not found" };
    }
    return { success: false, error: "Failed to update household" };
  }
}

/**
 * Delete a household (only if empty)
 */
export async function deleteHouseholdAction(
  householdId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    await deleteHousehold(user.churchId, householdId);
    revalidatePath("/people");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("deleteHouseholdAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Household not found") {
        return { success: false, error: "Household not found" };
      }
      if (error.message.includes("Cannot delete household with members")) {
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: "Failed to delete household" };
  }
}

/**
 * Add a person to a household
 */
export async function addToHouseholdAction(
  personId: string,
  householdId: string,
  role: HouseholdRole
): Promise<ActionResult<Person>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Get household info for activity logging
    const household = await getHousehold(user.churchId, householdId);
    if (!household) {
      return { success: false, error: "Household not found" };
    }

    const person = await addToHousehold(
      user.churchId,
      personId,
      householdId,
      role
    );

    // Log activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId,
      activityType: "household_joined",
      metadata: {
        householdName: household.name,
        householdId: household.id,
        role,
      },
      performedBy: user.id,
    });

    revalidatePath("/people");
    revalidatePath(`/people/${personId}`);
    return { success: true, data: person };
  } catch (error) {
    console.error("addToHouseholdAction error:", error);
    if (error instanceof Error) {
      if (error.message === "Household not found") {
        return { success: false, error: "Household not found" };
      }
      if (error.message === "Person not found") {
        return { success: false, error: "Person not found" };
      }
    }
    return { success: false, error: "Failed to add to household" };
  }
}

/**
 * Remove a person from their household
 */
export async function removeFromHouseholdAction(
  personId: string
): Promise<ActionResult<Person>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Get person's current household info before removing
    const existingPerson = await getPerson(user.churchId, personId);
    if (!existingPerson) {
      return { success: false, error: "Person not found" };
    }

    let householdName: string | undefined;
    if (existingPerson.householdId) {
      const household = await getHousehold(
        user.churchId,
        existingPerson.householdId
      );
      householdName = household?.name;
    }

    const person = await removeFromHousehold(user.churchId, personId);

    // Log activity if they were in a household
    if (householdName) {
      await db.insert(personActivities).values({
        churchId: user.churchId,
        personId,
        activityType: "household_left",
        metadata: {
          householdName,
          householdId: existingPerson.householdId,
        },
        performedBy: user.id,
      });
    }

    revalidatePath("/people");
    revalidatePath(`/people/${personId}`);
    return { success: true, data: person };
  } catch (error) {
    console.error("removeFromHouseholdAction error:", error);
    if (error instanceof Error && error.message === "Person not found") {
      return { success: false, error: "Person not found" };
    }
    return { success: false, error: "Failed to remove from household" };
  }
}

/**
 * Copy household address to all members
 */
export async function propagateAddressAction(
  householdId: string
): Promise<ActionResult<number>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const count = await propagateAddress(user.churchId, householdId);
    revalidatePath("/people");
    return { success: true, data: count };
  } catch (error) {
    console.error("propagateAddressAction error:", error);
    if (error instanceof Error && error.message === "Household not found") {
      return { success: false, error: "Household not found" };
    }
    return { success: false, error: "Failed to propagate address" };
  }
}

/**
 * Get household members (for display)
 */
export async function getHouseholdMembersAction(
  householdId: string
): Promise<ActionResult<Person[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const members = await getHouseholdMembers(user.churchId, householdId);
    return { success: true, data: members };
  } catch (error) {
    console.error("getHouseholdMembersAction error:", error);
    return { success: false, error: "Failed to get household members" };
  }
}

// ============================================================================
// Skills Actions
// ============================================================================

/**
 * Add a skill to a person
 */
export async function addSkillAction(data: {
  personId: string;
  skillCategory: string;
  skillName: string;
  proficiency?: string;
  notes?: string;
}): Promise<ActionResult<SkillInventory>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const parsed = skillCreateSchema.safeParse(data);
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

    const skill = await addSkill(user.churchId, parsed.data);

    // Log activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId: data.personId,
      activityType: "skill_added",
      metadata: {
        skillName: skill.skillName,
        skillCategory: skill.skillCategory,
        proficiency: skill.proficiency,
      },
      performedBy: user.id,
    });

    revalidatePath(`/people/${data.personId}`);
    return { success: true, data: skill };
  } catch (error) {
    console.error("addSkillAction error:", error);
    return { success: false, error: "Failed to add skill" };
  }
}

/**
 * Update an existing skill
 */
export async function updateSkillAction(
  skillId: string,
  data: {
    skillCategory?: SkillCategory;
    skillName?: string;
    proficiency?: SkillProficiency | null;
    notes?: string | null;
  }
): Promise<ActionResult<SkillInventory>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Get existing skill for activity logging
    const existingSkill = await getSkill(user.churchId, skillId);
    if (!existingSkill) {
      return { success: false, error: "Skill not found" };
    }

    const skill = await updateSkill(user.churchId, skillId, {
      skillCategory: data.skillCategory,
      skillName: data.skillName,
      proficiency: data.proficiency,
      notes: data.notes,
    });

    // Log activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId: skill.personId,
      activityType: "skill_updated",
      metadata: {
        skillName: skill.skillName,
        skillCategory: skill.skillCategory,
        proficiency: skill.proficiency,
        previousName:
          existingSkill.skillName !== skill.skillName
            ? existingSkill.skillName
            : undefined,
        previousProficiency:
          existingSkill.proficiency !== skill.proficiency
            ? existingSkill.proficiency
            : undefined,
      },
      performedBy: user.id,
    });

    revalidatePath("/people");
    return { success: true, data: skill };
  } catch (error) {
    console.error("updateSkillAction error:", error);
    if (error instanceof Error && error.message === "Skill not found") {
      return { success: false, error: "Skill not found" };
    }
    return { success: false, error: "Failed to update skill" };
  }
}

/**
 * Remove a skill from a person
 */
export async function removeSkillAction(
  skillId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    // Get skill info before deletion for activity logging
    const skill = await getSkill(user.churchId, skillId);
    if (!skill) {
      return { success: false, error: "Skill not found" };
    }

    await removeSkill(user.churchId, skillId);

    // Log activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId: skill.personId,
      activityType: "skill_removed",
      metadata: {
        skillName: skill.skillName,
        skillCategory: skill.skillCategory,
      },
      performedBy: user.id,
    });

    revalidatePath("/people");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("removeSkillAction error:", error);
    if (error instanceof Error && error.message === "Skill not found") {
      return { success: false, error: "Skill not found" };
    }
    return { success: false, error: "Failed to remove skill" };
  }
}

/**
 * Get all skills for a person
 */
export async function getPersonSkillsAction(
  personId: string
): Promise<ActionResult<SkillInventory[]>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const skills = await getPersonSkills(user.churchId, personId);
    return { success: true, data: skills };
  } catch (error) {
    console.error("getPersonSkillsAction error:", error);
    return { success: false, error: "Failed to get skills" };
  }
}

// ============================================================================
// Quick Add Actions
// ============================================================================

/**
 * Check for duplicates before creating a person
 */
export async function checkForDuplicatesAction(data: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}): Promise<ActionResult<DuplicateCheck>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const duplicates = await checkForDuplicates(user.churchId, {
      email: data.email || null,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || null,
    });

    return { success: true, data: duplicates };
  } catch (error) {
    console.error("checkForDuplicatesAction error:", error);
    return { success: false, error: "Failed to check for duplicates" };
  }
}

/**
 * Quick add a person with minimal fields
 */
export async function quickAddPersonAction(data: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  source?: string;
}): Promise<ActionResult<Person>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create people",
      };
    }

    // Validate input
    const parsed = personQuickAddSchema.safeParse(data);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!fieldErrors[key]) fieldErrors[key] = [];
        fieldErrors[key].push(issue.message);
      }
      return {
        success: false,
        error: "Validation failed",
        fieldErrors,
      };
    }

    // Create person with defaults
    const person = await createPerson(user.churchId, user.id, {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email || undefined,
      phone: parsed.data.phone || undefined,
      source: parsed.data.source,
      status: "prospect",
      country: "US",
    });

    // Log activity
    await db.insert(personActivities).values({
      churchId: user.churchId,
      personId: person.id,
      activityType: "person_created",
      metadata: { source: "quick_add" },
      performedBy: user.id,
    });

    revalidatePath("/people");
    return { success: true, data: person };
  } catch (error) {
    console.error("quickAddPersonAction error:", error);
    return { success: false, error: "Failed to create person" };
  }
}

// ============================================================================
// Import Actions
// ============================================================================

/**
 * Download CSV template for bulk import
 */
export async function downloadCsvTemplateAction(): Promise<
  ActionResult<string>
> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const csv = generateCsvTemplate();
    return { success: true, data: csv };
  } catch (error) {
    console.error("downloadCsvTemplateAction error:", error);
    return { success: false, error: "Failed to generate template" };
  }
}

/**
 * Preview a CSV file for import (parse, validate, detect duplicates)
 */
export async function previewImportAction(
  formData: FormData
): Promise<ActionResult<ImportPreview>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) return { success: false, error: "Unauthorized" };

    const file = formData.get("file") as File | null;
    if (!file) {
      return { success: false, error: "No file provided" };
    }

    const csvContent = await file.text();
    const preview = await parseCsvImport(csvContent, user.churchId);

    return { success: true, data: preview };
  } catch (error) {
    console.error("previewImportAction error:", error);
    return { success: false, error: "Failed to process CSV file" };
  }
}

/**
 * Execute bulk import of people
 */
export async function executeBulkImportAction(
  rows: ImportRow[],
  duplicateResolutions: Record<number, "skip" | "create">
): Promise<ActionResult<ImportSummary>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) {
      return { success: false, error: "Unauthorized" };
    }

    const summary = await executeBulkImport(
      user.churchId,
      user.id,
      rows,
      duplicateResolutions
    );

    revalidatePath("/people");
    return { success: true, data: summary };
  } catch (error) {
    console.error("executeBulkImportAction error:", error);
    return { success: false, error: "Failed to execute import" };
  }
}

// ============================================================================
// Pipeline Reorder
// ============================================================================

/**
 * Persist the order of people within a pipeline column.
 * Each person ID in the array gets pipeline_sort_order = its index.
 */
export async function reorderPipelineAction(
  orderedPersonIds: string[]
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) {
      return { success: false, error: "Unauthorized" };
    }

    if (orderedPersonIds.length === 0) {
      return { success: true, data: undefined };
    }

    // Build a single UPDATE using a CASE expression for efficiency
    const churchId = user.churchId;
    const whenClauses = orderedPersonIds
      .map((id, idx) => sql`WHEN ${id} THEN ${idx}`)
      .reduce((acc, clause) => sql`${acc} ${clause}`);

    await db
      .update(persons)
      .set({
        pipelineSortOrder: sql<number>`CASE id ${whenClauses} ELSE ${persons.pipelineSortOrder} END`,
      })
      .where(
        and(
          eq(persons.churchId, churchId),
          inArray(persons.id, orderedPersonIds)
        )
      );

    revalidatePath("/people");
    return { success: true, data: undefined };
  } catch (error) {
    console.error("reorderPipelineAction error:", error);
    return { success: false, error: "Failed to reorder pipeline" };
  }
}
