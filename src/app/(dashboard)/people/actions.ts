"use server";

import { checkForDuplicates } from "@/lib/people/duplicates";
import { profilePhotoRefusal } from "@/lib/profile-photo";
import { emitPersonStatusChanged } from "@/lib/people/events";
import {
  parsePeopleListSearchParams,
  PEOPLE_PAGE_SIZE,
  type PeopleListSearchParams,
} from "@/lib/people/list-params";
import {
  createPerson,
  deletePerson,
  getPerson,
  listPeople,
  updatePerson,
  type ListPeopleResult,
} from "@/lib/people/service";
import { getPersonPhotoKey, setPersonPhoto } from "@/lib/people/person-photo";
import { changeStatus, recordStatusChange } from "@/lib/people/status";
import { isCommittedStatus } from "@/lib/people/status.shared";
import {
  planFollowUpHandoff,
  type FollowUpHandoff,
} from "@/lib/tasks/follow-up-ownership";
import type {
  ActionResult,
  DuplicateCheck,
  PersonForClient,
  PersonStatus,
  StatusTransition,
} from "@/lib/people/types";
import {
  getExtensionFromMimeType,
  personPhotoStorageKey,
  uploadFile,
} from "@/lib/storage";
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
): Promise<ActionResult<PersonForClient>> {
  return withChurchSession(
    "people.write",
    "createPersonAction",
    {
      noChurch: "You must be associated with a church to create people",
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
): Promise<ActionResult<PersonForClient>> {
  return withChurchSession(
    "people.write",
    "updatePersonAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
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
 * The next page of `/people` for the "Load more" button (P-006a).
 *
 * TAKES THE URL, NOT A FILTER OBJECT. The page's filters live in the address
 * bar, and the appended rows have to come from the SAME query the first page
 * came from — so the client hands back the search params it is rendering under
 * and this action reads them through `parsePeopleListSearchParams`, the one
 * reader. A filter object marshalled by the client would be a second reading of
 * the URL, free to drift from the page's.
 *
 * The cursor is explicit rather than taken from those params: the URL's
 * `cursor` is where the FIRST page started, and the button is walking on from
 * wherever the client has got to.
 */
export async function loadMorePeopleAction(
  params: PeopleListSearchParams,
  cursor: string
): Promise<ActionResult<ListPeopleResult>> {
  return withChurchSession(
    "read",
    "loadMorePeopleAction",
    {
      noChurch: "You must be associated with a church to view people",
      fallback: "Failed to load more people",
    },
    async ({ churchId }) => {
      const { search, status, source, tagIds } =
        parsePeopleListSearchParams(params);

      const page = await listPeople(churchId, {
        cursor,
        search,
        status,
        source,
        tagIds,
        limit: PEOPLE_PAGE_SIZE,
      });

      return { success: true, data: page };
    }
  );
}

/**
 * Upload (or replace) a person's photo (P-024a).
 *
 * The object goes up BEFORE the row points at it — the same asymmetry the
 * generated documents path argues (`memory/invariants.md` → Generated
 * Documents). The other half, dropping the object the row has stopped pointing
 * at, belongs to `setPersonPhoto` and is not this function's to remember.
 *
 * The church scope is checked before a byte is written: `personId` arrives from
 * the client, so an id from another tenant must fail here rather than land a
 * file under this church's prefix.
 */
export async function uploadPersonPhotoAction(
  personId: string,
  formData: FormData
): Promise<ActionResult<PersonForClient>> {
  return withChurchSession(
    "people.write",
    "uploadPersonPhotoAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
        "Person not found": "Person not found or has been deleted",
      },
      fallback: "An unexpected error occurred while uploading the photo",
    },
    async ({ churchId }) => {
      const file = formData.get("photo");

      if (!(file instanceof File) || file.size === 0) {
        return { success: false, error: "Choose a photo to upload." };
      }

      // THE GATE, and the same rule the picker applied before sending. A POST
      // that never saw the picker meets it here for the first time.
      const refusal = profilePhotoRefusal(file);
      if (refusal) {
        return { success: false, error: refusal };
      }

      // Never write against a personId the caller's church does not own —
      // checked BEFORE the upload so no file lands for a foreign person.
      //
      // A SCOPED EXISTENCE CHECK, not a person. This read used to be
      // `getPerson`, whose answer was thrown away except for its truthiness —
      // and since #654 that answer also runs the strip and builds a photo route
      // for nobody. `getPersonPhotoKey` asks the question this line is actually
      // asking, and it is the same read `setPersonPhoto` makes next.
      const existing = await getPersonPhotoKey(churchId, personId);
      if (!existing) {
        return {
          success: false,
          error: "Person not found or has been deleted",
        };
      }

      const key = personPhotoStorageKey(
        churchId,
        personId,
        getExtensionFromMimeType(file.type)
      );

      await uploadFile(key, Buffer.from(await file.arrayBuffer()), file.type);

      const updated = await setPersonPhoto(churchId, personId, key);
      if (!updated) {
        return {
          success: false,
          error: "Person not found or has been deleted",
        };
      }

      revalidatePath("/people");
      revalidatePath(`/people/${personId}`);

      return { success: true, data: updated };
    }
  );
}

/**
 * Remove a person's photo (P-024b).
 *
 * The same writer as the upload with a null key, which is what makes the
 * ordering the invariant demands impossible to get wrong from here:
 * `setPersonPhoto` drops the object the row has stopped naming itself. Church
 * scope is checked inside its own lookup, so a `personId` from another tenant
 * reads as missing and no object of theirs is ever deleted.
 */
export async function removePersonPhotoAction(
  personId: string
): Promise<ActionResult<PersonForClient>> {
  return withChurchSession(
    "people.write",
    "removePersonPhotoAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
        "Person not found": "Person not found or has been deleted",
      },
      fallback: "An unexpected error occurred while removing the photo",
    },
    async ({ churchId }) => {
      const updated = await setPersonPhoto(churchId, personId, null);
      if (!updated) {
        return {
          success: false,
          error: "Person not found or has been deleted",
        };
      }

      revalidatePath("/people");
      revalidatePath(`/people/${personId}`);

      return { success: true, data: updated };
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
): Promise<ActionResult<{ person: PersonForClient }>> {
  return withChurchSession(
    "people.write",
    "changeStatusAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
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
): Promise<
  ActionResult<{
    person: PersonForClient;
    transition: StatusTransition;
    /**
     * What this change left ownerless (#470 Q2). Non-null only when the person
     * just LEFT the committed set while holding open follow-ups — the caller
     * opens the handoff dialog on it. `null` is the overwhelming case and means
     * there is nothing to offer.
     */
    followUpHandoff: FollowUpHandoff | null;
  }>
> {
  return withChurchSession(
    "people.write",
    "changeStatusWithReasonAction",
    {
      noChurch: "You must be associated with a church to update people",
      known: {
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

      // LEAVING the committed set is the only direction that matters here:
      // only committed members may own a follow-up (#470 D2), so a demotion is
      // what makes work ownerless. Arriving into it, or moving within it,
      // costs no extra read.
      const leftCommittedSet =
        isCommittedStatus(result.transition.from) &&
        !isCommittedStatus(result.transition.to);

      return {
        success: true,
        data: {
          ...result,
          followUpHandoff: leftCommittedSet
            ? await planFollowUpHandoff(churchId, personId)
            : null,
        },
      };
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
}): Promise<ActionResult<PersonForClient>> {
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
