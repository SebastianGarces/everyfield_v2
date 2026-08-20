"use server";

import { requireSeat } from "@/lib/auth/seats";
import { db } from "@/db";
import { personActivities } from "@/db/schema";
import {
  authoredNoteCondition,
  getActivities,
  logPersonActivity,
} from "@/lib/people/activity";
import { assertPersonInChurch } from "@/lib/people/service";
import type { ActionResult } from "@/lib/people/types";
import { eq } from "drizzle-orm";
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
    "people.write",
    "addNoteAction",
    {
      fallback: "Failed to add note",
    },
    async ({ user, churchId }) => {
      if (!note || note.trim().length === 0) {
        return { success: false, error: "Note cannot be empty" };
      }

      // Never write against a personId the caller's church does not own
      await assertPersonInChurch(churchId, personId);

      await logPersonActivity({
        churchId,
        personId,
        activityType: "note_added",
        metadata: { note },
        performedBy: user.id,
      });

      // Refresh the client router to show the new note
      // This reconciles the optimistic update with actual server state
      refresh();

      return { success: true, data: undefined };
    }
  );
}

/**
 * Edit the body of a note the caller wrote (P-010e).
 *
 * The same four-part predicate the delete below uses IS the authorization: the
 * row must be a `note_added`, in the caller's church, written by the caller.
 * A note in another church matches nothing and reads as missing — an
 * `activityId` is a client-supplied uuid, so the church term is the tenancy
 * boundary, not decoration.
 *
 * `created_at` is NOT touched, deliberately: the timeline is ordered by it, so
 * an edit that moved the row would rewrite the person's history to make a
 * correction look like a new note. `editedAt` goes in the metadata beside the
 * body, which is what the item renders as "edited …". No revision history —
 * ruled out of scope on #320; a timestamp is enough.
 */
export async function editNoteAction(
  personId: string,
  activityId: string,
  note: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "people.write",
    "editNoteAction",
    { fallback: "Failed to edit note" },
    async ({ user, churchId }) => {
      if (!note || note.trim().length === 0) {
        return { success: false, error: "Note cannot be empty" };
      }

      const existing = await db.query.personActivities.findFirst({
        where: authoredNoteCondition(churchId, activityId, user.id),
      });

      if (!existing) {
        return {
          success: false,
          error: "Note not found or you don't have permission to edit it",
        };
      }

      // Spread what is already there: a note written from a meeting carries
      // `meetingId`/`meetingType`, and `getLatestPersonNote` reads them.
      const metadata = (existing.metadata ?? {}) as Record<string, unknown>;

      await db
        .update(personActivities)
        .set({
          metadata: {
            ...metadata,
            note: note.trim(),
            editedAt: new Date().toISOString(),
          },
        })
        .where(eq(personActivities.id, activityId));

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
    "people.write",
    "deleteNoteAction",
    { fallback: "Failed to delete note" },
    async ({ user, churchId }) => {
      // Check if the activity exists and is a note created by the user
      const existing = await db.query.personActivities.findFirst({
        where: authoredNoteCondition(churchId, activityId, user.id),
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
  const { user } = await requireSeat("read");
  if (!user.churchId) throw new Error("Unauthorized");
  return getActivities(user.churchId, personId, { cursor, limit: 10 });
}
