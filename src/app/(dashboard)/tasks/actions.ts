"use server";

import type { Task } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import {
  bulkCompleteTasks,
  bulkRescheduleTasks,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  reopenTask,
  updateTask,
  SUBTASK_DEPTH_ERROR,
  SUBTASK_HAS_CHILDREN_ERROR,
  SUBTASK_PARENT_MISSING_ERROR,
  SUBTASK_SELF_ERROR,
  type BulkTaskResult,
} from "@/lib/tasks/service";
import { parseRecurrenceForm } from "@/lib/tasks/recurrence";
import type { ActionResult } from "@/lib/tasks/types";
import {
  bulkRescheduleSchema,
  bulkTaskIdsSchema,
  taskCreateSchema,
  taskQuickAddSchema,
  taskUpdateSchema,
} from "@/lib/validations/tasks";
import { refresh, revalidatePath } from "next/cache";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Service errors that are safe to show a user verbatim.
 *
 * The refusals the subtask rules raise are ABOUT the user's request — "this
 * task already has subtasks" — so echoing them is more useful than the generic
 * fallback. Everything not on this list still collapses to a generic message,
 * so provider and constraint text can never reach the browser.
 */
const USER_FACING_SERVICE_ERRORS = new Set<string>([
  SUBTASK_PARENT_MISSING_ERROR,
  SUBTASK_SELF_ERROR,
  SUBTASK_DEPTH_ERROR,
  SUBTASK_HAS_CHILDREN_ERROR,
]);

function userFacingError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return USER_FACING_SERVICE_ERRORS.has(error.message) ? error.message : null;
}

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
// Task Actions
// ============================================================================

/**
 * Create a new task from full form data.
 */
export async function createTaskAction(
  formData: FormData
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create tasks",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = taskCreateSchema.safeParse(rawData);

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

    const task = await createTask(
      user.churchId,
      user.id,
      parsed.data,
      // Recurrence rides in the same form but is parsed separately: absent
      // fields must mean "unchanged", which a merged schema cannot express.
      parseRecurrenceForm(rawData) ?? undefined
    );

    revalidatePath("/tasks");

    return { success: true, data: task };
  } catch (error) {
    console.error("createTaskAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in to create tasks" };
    }

    const known = userFacingError(error);
    if (known) return { success: false, error: known };

    return {
      success: false,
      error: "Failed to create task. Please try again.",
    };
  }
}

/**
 * Quick-add a task with minimal fields (title, due date, priority).
 */
export async function quickAddTaskAction(
  formData: FormData
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to create tasks",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = taskQuickAddSchema.safeParse(rawData);

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

    // Quick-add tasks default to assigned to the current user with not_started status
    const task = await createTask(user.churchId, user.id, {
      ...parsed.data,
      status: "not_started",
      assignedToId: user.id,
    });

    revalidatePath("/tasks");

    return { success: true, data: task };
  } catch (error) {
    console.error("quickAddTaskAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in to create tasks" };
    }

    return {
      success: false,
      error: "Failed to create task. Please try again.",
    };
  }
}

/**
 * Update an existing task.
 */
export async function updateTaskAction(
  taskId: string,
  formData: FormData
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to update tasks",
      };
    }

    const rawData = formDataToObject(formData);
    const parsed = taskUpdateSchema.safeParse(rawData);

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

    const task = await updateTask(
      user.churchId,
      taskId,
      parsed.data,
      parseRecurrenceForm(rawData) ?? undefined
    );

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("updateTaskAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in to update tasks" };
    }

    if (error instanceof Error && error.message === "Task not found") {
      return { success: false, error: "Task not found" };
    }

    const known = userFacingError(error);
    if (known) return { success: false, error: known };

    return {
      success: false,
      error: "Failed to update task. Please try again.",
    };
  }
}

/**
 * Mark a task as complete.
 */
export async function completeTaskAction(
  taskId: string
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const { task } = await completeTask(user.churchId, taskId, user.id);

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("completeTaskAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to complete tasks",
      };
    }

    if (error instanceof Error && error.message === "Task not found") {
      return { success: false, error: "Task not found" };
    }

    if (
      error instanceof Error &&
      error.message === "Task is already complete"
    ) {
      return { success: false, error: "Task is already complete" };
    }

    return {
      success: false,
      error: "Failed to complete task. Please try again.",
    };
  }
}

/**
 * Reopen a completed task.
 */
export async function reopenTaskAction(
  taskId: string
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const task = await reopenTask(user.churchId, taskId);

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("reopenTaskAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to reopen tasks",
      };
    }

    if (error instanceof Error && error.message === "Task is not complete") {
      return { success: false, error: "Task is not complete" };
    }

    return {
      success: false,
      error: "Failed to reopen task. Please try again.",
    };
  }
}

/**
 * Delete (soft delete) a task.
 */
export async function deleteTaskAction(
  taskId: string
): Promise<ActionResult<void>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    await deleteTask(user.churchId, taskId);

    revalidatePath("/tasks");

    return { success: true, data: undefined };
  } catch (error) {
    console.error("deleteTaskAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to delete tasks",
      };
    }

    if (error instanceof Error && error.message === "Task not found") {
      return { success: false, error: "Task not found" };
    }

    return {
      success: false,
      error: "Failed to delete task. Please try again.",
    };
  }
}

/**
 * Update task status inline (e.g., from task card dropdown).
 */
export async function updateTaskStatusAction(
  taskId: string,
  status: string
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    // If marking complete, use completeTask for proper event emission
    if (status === "complete") {
      const { task } = await completeTask(user.churchId, taskId, user.id);
      revalidatePath("/tasks");
      return { success: true, data: task };
    }

    const task = await updateTask(user.churchId, taskId, {
      status: status as "not_started" | "in_progress" | "blocked",
    });

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("updateTaskStatusAction error:", error);
    return {
      success: false,
      error: "Failed to update task status. Please try again.",
    };
  }
}

// ============================================================================
// Subtask Actions (T-016)
// ============================================================================
//
// Subtasks get their own two endpoints rather than reusing the generic task
// actions, for one reason: both of them assert the target really is a subtask
// of a task in the caller's church before writing. Every export of this module
// is a POST endpoint reachable with no UI, so "the checklist only shows you
// your own subtasks" is not a guard — this is.
//
// Revalidation splits the way `contracts/data-patterns.md` prescribes:
// `refresh()` for the page the caller is on (the parent's detail view, where
// the checklist lives) and `revalidatePath` for the task list, which is
// somewhere else.
// ============================================================================

/**
 * Add a subtask to a task.
 *
 * The one-level-nesting rule is enforced in the service, not here, so it holds
 * for every caller.
 */
export async function addSubtaskAction(
  parentTaskId: string,
  formData: FormData
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to add subtasks",
      };
    }

    const parsed = taskCreateSchema.safeParse({
      ...formDataToObject(formData),
      // Never taken from the form: the parent is the action's subject.
      parentTaskId,
    });

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const subtask = await createTask(user.churchId, user.id, parsed.data);

    refresh();
    revalidatePath("/tasks");

    return { success: true, data: subtask };
  } catch (error) {
    console.error("addSubtaskAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in to add subtasks" };
    }

    const known = userFacingError(error);
    if (known) return { success: false, error: known };

    return {
      success: false,
      error: "Failed to add subtask. Please try again.",
    };
  }
}

/**
 * Tick or untick a subtask.
 *
 * Note what this does NOT do: it never touches the parent. Finishing the last
 * item on a checklist is not the same claim as finishing the work, and the
 * ruling on #90 is that the planter makes the second one (see the subtasks
 * note in `src/lib/tasks/service.ts`).
 */
export async function setSubtaskCompletionAction(
  subtaskId: string,
  complete: boolean
): Promise<ActionResult<Task>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const subtask = await getTask(user.churchId, subtaskId);
    if (!subtask) {
      return { success: false, error: "Subtask not found" };
    }

    if (!subtask.parentTaskId) {
      return { success: false, error: "That task is not a subtask" };
    }

    const task = complete
      ? (await completeTask(user.churchId, subtaskId, user.id)).task
      : await reopenTask(user.churchId, subtaskId);

    refresh();
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${subtask.parentTaskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("setSubtaskCompletionAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to update subtasks",
      };
    }

    if (
      error instanceof Error &&
      (error.message === "Task is already complete" ||
        error.message === "Task is not complete")
    ) {
      // Somebody else already moved it. The list re-renders from the server on
      // refresh, so the user's next click acts on the true state.
      return { success: false, error: "That subtask already changed" };
    }

    return {
      success: false,
      error: "Failed to update the subtask. Please try again.",
    };
  }
}

// ============================================================================
// Bulk Actions (T-019)
// ============================================================================

/**
 * Complete every selected task.
 *
 * Returns the full outcome — which ids succeeded and which failed and why — so
 * the UI can report partial failure instead of pretending everything worked.
 */
export async function bulkCompleteTasksAction(
  taskIds: string[]
): Promise<ActionResult<BulkTaskResult>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const parsed = bulkTaskIdsSchema.safeParse(taskIds);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid task selection",
      };
    }

    const result = await bulkCompleteTasks(user.churchId, parsed.data, user.id);

    revalidatePath("/tasks");

    return { success: true, data: result };
  } catch (error) {
    console.error("bulkCompleteTasksAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to complete tasks",
      };
    }

    return {
      success: false,
      error: "Failed to complete the selected tasks. Please try again.",
    };
  }
}

/**
 * Set the same due date on every selected task.
 */
export async function bulkRescheduleTasksAction(
  taskIds: string[],
  dueDate: string
): Promise<ActionResult<BulkTaskResult>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const parsed = bulkRescheduleSchema.safeParse({ taskIds, dueDate });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid reschedule request",
      };
    }

    const result = await bulkRescheduleTasks(
      user.churchId,
      parsed.data.taskIds,
      parsed.data.dueDate
    );

    revalidatePath("/tasks");

    return { success: true, data: result };
  } catch (error) {
    console.error("bulkRescheduleTasksAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to reschedule tasks",
      };
    }

    return {
      success: false,
      error: "Failed to reschedule the selected tasks. Please try again.",
    };
  }
}
