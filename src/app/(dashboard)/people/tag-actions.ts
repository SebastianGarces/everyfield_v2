"use server";

import { assertPersonInChurch } from "@/lib/people/service";
import {
  assignTag,
  createTag,
  deleteTag,
  listTags,
  removeTag,
  updateTag,
} from "@/lib/people/tags";
import type { ActionResult, Tag } from "@/lib/people/types";
import { tagCreateSchema, tagUpdateSchema } from "@/lib/validations/people";
import { revalidatePath } from "next/cache";
import { toFieldErrors, withChurchSession } from "./action-context";

/**
 * List all tags for the church
 */
export async function listTagsAction(): Promise<ActionResult<Tag[]>> {
  return withChurchSession(
    "read",
    "listTagsAction",
    { fallback: "Failed to list tags" },
    async ({ churchId }) => {
      const tags = await listTags(churchId);
      return { success: true, data: tags };
    }
  );
}

/**
 * Create a new tag
 */
export async function createTagAction(
  name: string,
  color?: string
): Promise<ActionResult<Tag>> {
  return withChurchSession(
    "people.write",
    "createTagAction",
    { fallback: "Failed to create tag" },
    async ({ churchId }) => {
      // Validate input
      const parsed = tagCreateSchema.safeParse({ name, color });
      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      const tag = await createTag(
        churchId,
        parsed.data.name,
        parsed.data.color
      );
      revalidatePath("/people");
      return { success: true, data: tag };
    }
  );
}

/**
 * Update an existing tag
 */
export async function updateTagAction(
  tagId: string,
  data: { name?: string; color?: string | null }
): Promise<ActionResult<Tag>> {
  return withChurchSession(
    "people.write",
    "updateTagAction",
    {
      fallback: "Failed to update tag",
    },
    async ({ churchId }) => {
      // Validate input
      const parsed = tagUpdateSchema.safeParse(data);
      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Convert null to undefined for service layer
      const updateData = {
        name: parsed.data.name,
        color: parsed.data.color ?? undefined,
      };

      const tag = await updateTag(churchId, tagId, updateData);
      revalidatePath("/people");
      return { success: true, data: tag };
    }
  );
}

/**
 * Assign a tag to a person
 */
export async function assignTagAction(
  personId: string,
  tagId: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "people.write",
    "assignTagAction",
    {
      fallback: "Failed to assign tag",
    },
    async ({ user, churchId }) => {
      // Never write against a personId the caller's church does not own
      await assertPersonInChurch(churchId, personId);

      await assignTag(churchId, personId, tagId, user.id);

      revalidatePath(`/people/${personId}`);
      revalidatePath("/people");
      return { success: true, data: undefined };
    }
  );
}

/**
 * Remove a tag from a person
 */
export async function removeTagAction(
  personId: string,
  tagId: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "people.write",
    "removeTagAction",
    {
      fallback: "Failed to remove tag",
    },
    async ({ user, churchId }) => {
      // Never write against a personId the caller's church does not own
      await assertPersonInChurch(churchId, personId);

      await removeTag(churchId, personId, tagId, user.id);

      revalidatePath(`/people/${personId}`);
      revalidatePath("/people");
      return { success: true, data: undefined };
    }
  );
}

/**
 * Delete a tag
 */
export async function deleteTagAction(
  tagId: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "people.write",
    "deleteTagAction",
    { fallback: "Failed to delete tag" },
    async ({ churchId }) => {
      await deleteTag(churchId, tagId);

      revalidatePath("/people");
      return { success: true, data: undefined };
    }
  );
}
