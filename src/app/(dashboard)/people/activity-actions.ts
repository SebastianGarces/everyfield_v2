"use server";

import { db } from "@/db";
import { personActivities } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { getActivities, logPersonActivity } from "@/lib/people/activity";
import { assertPersonInChurch } from "@/lib/people/service";
import type { ActionResult } from "@/lib/people/types";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { withChurchSession } from "./action-context";

/**
 * Add a note to a person's activity timeline.
 * Uses refresh() to update the client router with fresh server state.
 * Client uses useOptimistic for instant UI feedback.
 */
export async function addNoteAction(
  personId: string,
  note: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "addNoteAction",
    {
      known: { "Person not found": "Person not found" },
      fallback: "Failed to add note",
    },
    async ({ user, churchId }) => {
      if (!note || note.trim().length === 0) {
        return { success: false, error: "Note cannot be empty" };
      }

      // Never write against a personId the caller's church does not own
      await assertPersonInChurch(churchId, personId);

      await logPersonActivity(
        churchId,
        personId,
        "note_added",
        { note },
        user.id
      );

      // Refresh the client router to show the new note
      // This reconciles the optimistic update with actual server state
      refresh();

      return { success: true, data: undefined };
    }
  );
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
  return withChurchSession(
    "deleteNoteAction",
    { fallback: "Failed to delete note" },
    async ({ user, churchId }) => {
      // Check if the activity exists and is a note created by the user
      const existing = await db.query.personActivities.findFirst({
        where: and(
          eq(personActivities.id, activityId),
          eq(personActivities.churchId, churchId),
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
    }
  );
}

/**
 * Fetch more activities for pagination
 */
export async function getMoreActivitiesAction(personId: string, cursor: Date) {
  const { user } = await verifySession();
  if (!user.churchId) throw new Error("Unauthorized");
  return getActivities(user.churchId, personId, { cursor, limit: 10 });
}
