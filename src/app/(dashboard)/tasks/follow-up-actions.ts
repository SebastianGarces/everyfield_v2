"use server";

import { revalidatePath } from "next/cache";

import { requireSeat } from "@/lib/auth/seats";
import {
  FOLLOW_UP_ASSIGNEE_ERROR,
  OWNED_TASK_CATEGORY,
  listFollowUpTaskIdsOwnedBy,
} from "@/lib/tasks/follow-up-ownership";
import { createTask, updateTask } from "@/lib/tasks/service";
import type { ActionResult } from "@/lib/tasks/types";

// ============================================================================
// The three writes the ownership surfaces perform (#470).
//
// Each one is an ASSIGNMENT and nothing else — the assignments view, the
// one-click create-and-assign on an uncovered contact (Q1), and the handoff a
// demotion offers (Q2). All three go through `createTask`/`updateTask`, the
// task domain's write doors, so the D2 guard and the assignee-change
// notification re-sync (N-011) apply once rather than three times.
//
// EVERY EXPORT MINTS ITS ACTOR ABOVE ITS `try` (`actions.ts` header, #411).
// ============================================================================

/** The refusal text is the guard's own — it names what the planter must do. */
function assignmentError(error: unknown): string {
  return error instanceof Error && error.message === FOLLOW_UP_ASSIGNEE_ERROR
    ? FOLLOW_UP_ASSIGNEE_ERROR
    : "Could not change the follow-up owner. Please try again.";
}

/** Hand one open follow-up to a committed member. */
export async function assignFollowUpAction(
  taskId: string,
  assigneeId: string
): Promise<ActionResult<null>> {
  const { user } = await requireSeat("tasks.write");

  try {
    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church" };
    }

    await updateTask(user.churchId, taskId, { assignedToId: assigneeId });

    revalidatePath("/tasks");
    return { success: true, data: null };
  } catch (error) {
    console.error("assignFollowUpAction error:", error);
    return { success: false, error: assignmentError(error) };
  }
}

/**
 * Q1 — a stale contact with no open follow-up task gets one, owned.
 *
 * The title names the contact rather than repeating a template, because this
 * task is created from a list where the contact's name is what the planter just
 * clicked. Due today: the point of the row is that this person has been waiting.
 */
export async function createAndAssignFollowUpAction(
  personId: string,
  personName: string,
  assigneeId: string
): Promise<ActionResult<null>> {
  const { user } = await requireSeat("tasks.write");

  try {
    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church" };
    }

    await createTask(user.churchId, user.id, {
      title: `Follow up with ${personName}`.trim(),
      status: "not_started",
      priority: "medium",
      category: OWNED_TASK_CATEGORY,
      relatedType: "person",
      relatedId: personId,
      assignedToId: assigneeId,
    });

    revalidatePath("/tasks");
    return { success: true, data: null };
  } catch (error) {
    console.error("createAndAssignFollowUpAction error:", error);
    return { success: false, error: assignmentError(error) };
  }
}

/**
 * Q2 — move everything a demoted member was carrying to one person.
 *
 * "One select, all move together." Sequential rather than one UPDATE because
 * each task owes a notification re-sync; neon-http has no interactive
 * transaction to make the set atomic anyway (`memory/invariants.md` →
 * Transactions), so a partial move is reported rather than pretended away — and
 * whatever did not move is still in "Needs owner", which is where the demotion
 * put it.
 */
export async function handOffFollowUpsAction(
  fromUserId: string,
  toUserId: string
): Promise<ActionResult<{ moved: number }>> {
  const { user } = await requireSeat("tasks.write");

  try {
    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church" };
    }

    const taskIds = await listFollowUpTaskIdsOwnedBy(user.churchId, fromUserId);

    let moved = 0;
    for (const taskId of taskIds) {
      await updateTask(user.churchId, taskId, { assignedToId: toUserId });
      moved += 1;
    }

    revalidatePath("/tasks");
    revalidatePath("/people");
    return { success: true, data: { moved } };
  } catch (error) {
    console.error("handOffFollowUpsAction error:", error);
    return { success: false, error: assignmentError(error) };
  }
}
