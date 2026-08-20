"use server";

import { checkForDuplicates } from "@/lib/people/duplicates";
import { emitPersonStatusChanged } from "@/lib/people/events";
import {
  createPerson,
  deletePerson,
  getPerson,
  updatePerson,
} from "@/lib/people/service";
import { changeStatus, recordStatusChange } from "@/lib/people/status";
import type {
  ActionResult,
  DuplicateCheck,
  Person,
  PersonStatus,
  StatusTransition,
} from "@/lib/people/types";
import {
  personCreateSchema,
  personQuickAddSchema,
  personStatusSchema,
  personUpdateSchema,
} from "@/lib/validations/people";
import { revalidatePath } from "next/cache";
import { toFieldErrors, withChurchSession } from "./action-context";

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
  return withChurchSession(
    "people.write",
    "createPersonAction",
    {
      noChurch: "You must be associated with a church to create people",
      known: { Unauthorized: "You must be logged in to create people" },
      fallback: "An unexpected error occurred while creating the person",
    },
    async ({ user, churchId }) => {
      // Parse and validate form data
      const rawData = formDataToObject(formData);
      const parsed = personCreateSchema.safeParse(rawData);

      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Create the person; the service logs the person_created activity
      // with this source
      const person = await createPerson(churchId, user.id, parsed.data, "form");

      // Revalidate the people list
      revalidatePath("/people");

      return { success: true, data: person };
    }
  );
}

/**
 * Update an existing person
 */
export async function updatePersonAction(
  personId: string,
  formData: FormData
): Promise<ActionResult<Person>> {
  return withChurchSession(
    "people.write",
    "updatePersonAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
        Unauthorized: "You must be logged in to update people",
        "Person not found": "Person not found or has been deleted",
      },
      fallback: "An unexpected error occurred while updating the person",
    },
    async ({ user, churchId }) => {
      // Parse and validate form data
      const rawData = formDataToObject(formData);
      const parsed = personUpdateSchema.safeParse(rawData);

      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Get the existing person to detect status changes
      const existing = await getPerson(churchId, personId);
      if (!existing) {
        return {
          success: false,
          error: "Person not found or has been deleted",
        };
      }

      const oldStatus = existing.status;
      const newStatus = parsed.data.status;

      // Update the person
      const person = await updatePerson(churchId, personId, parsed.data);

      // Log status change activity if status changed — through the one
      // status_changed writer, tagged with its profile-edit source
      if (newStatus && newStatus !== oldStatus) {
        await recordStatusChange(
          churchId,
          personId,
          user.id,
          oldStatus,
          newStatus,
          { source: "profile_edit" }
        );

        // Emit event
        await emitPersonStatusChanged(person, oldStatus, newStatus);
      }

      // Revalidate the people list and detail page
      revalidatePath("/people");
      revalidatePath(`/people/${personId}`);

      return { success: true, data: person };
    }
  );
}

/**
 * Delete (soft delete) a person
 */
export async function deletePersonAction(
  personId: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "people.write",
    "deletePersonAction",
    {
      noChurch: "You must be associated with a church to delete people",
      known: {
        Unauthorized: "You must be logged in to delete people",
        "Person not found": "Person not found or has already been deleted",
      },
      fallback: "An unexpected error occurred while deleting the person",
    },
    async ({ churchId }) => {
      // Delete (soft) the person
      await deletePerson(churchId, personId);

      // Revalidate the people list
      revalidatePath("/people");

      return { success: true, data: undefined };
    }
  );
}

/**
 * Change a person's status (for drag-and-drop in pipeline view)
 * Uses the status service for validation, activity logging, and event emission.
 */
export async function changeStatusAction(
  personId: string,
  newStatus: PersonStatus
): Promise<ActionResult<{ person: Person }>> {
  return withChurchSession(
    "people.write",
    "changeStatusAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
        Unauthorized: "You must be logged in to update people",
        "Person not found": "Person not found or has been deleted",
      },
      fallback: "An unexpected error occurred while updating the person status",
    },
    async ({ user, churchId }) => {
      // Validate the newStatus
      const statusResult = personStatusSchema.safeParse(newStatus);
      if (!statusResult.success) {
        return { success: false, error: "Invalid status value" };
      }

      // Use the status service to change status (handles validation, logging, events)
      const result = await changeStatus(churchId, personId, user.id, newStatus);

      // Revalidate the people pages
      revalidatePath("/people");

      return { success: true, data: { person: result.person } };
    }
  );
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
  return withChurchSession(
    "people.write",
    "changeStatusWithReasonAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
        Unauthorized: "You must be logged in to update people",
        "Person not found": "Person not found or has been deleted",
      },
      fallback: "An unexpected error occurred while updating the person status",
    },
    async ({ user, churchId }) => {
      // Validate the newStatus
      const statusResult = personStatusSchema.safeParse(newStatus);
      if (!statusResult.success) {
        return { success: false, error: "Invalid status value" };
      }

      // Use the status service to change status with reason
      const result = await changeStatus(
        churchId,
        personId,
        user.id,
        newStatus,
        reason
      );

      // Revalidate the people pages - this invalidates the cache so next
      // navigation or router refresh will fetch fresh data
      revalidatePath("/people");
      revalidatePath(`/people/${personId}`);

      return { success: true, data: result };
    }
  );
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
  return withChurchSession(
    "read",
    "checkForDuplicatesAction",
    { fallback: "Failed to check for duplicates" },
    async ({ churchId }) => {
      const duplicates = await checkForDuplicates(churchId, {
        email: data.email || null,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
      });

      return { success: true, data: duplicates };
    }
  );
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
  return withChurchSession(
    "people.write",
    "quickAddPersonAction",
    {
      noChurch: "You must be associated with a church to create people",
      fallback: "Failed to create person",
    },
    async ({ user, churchId }) => {
      // Validate input
      const parsed = personQuickAddSchema.safeParse(data);
      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Create person with defaults; the service logs the person_created
      // activity with this source
      const person = await createPerson(
        churchId,
        user.id,
        {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          email: parsed.data.email || undefined,
          phone: parsed.data.phone || undefined,
          source: parsed.data.source,
          status: "prospect",
          country: "US",
        },
        "quick_add"
      );

      revalidatePath("/people");
      return { success: true, data: person };
    }
  );
}
