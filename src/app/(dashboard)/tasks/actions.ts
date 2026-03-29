"use server";

import type { Task } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import {
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  updateTask,
} from "@/lib/tasks/service";
import type { ActionResult } from "@/lib/tasks/types";
import {
  taskCreateSchema,
  taskQuickAddSchema,
  taskUpdateSchema,
} from "@/lib/validations/tasks";
import { revalidatePath } from "next/cache";

// ============================================================================
// Helpers
// ============================================================================

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

    const task = await createTask(user.churchId, user.id, parsed.data);

    revalidatePath("/tasks");

    return { success: true, data: task };
  } catch (error) {
    console.error("createTaskAction error:", error);

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

    const task = await updateTask(user.churchId, taskId, parsed.data);

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

    const task = await completeTask(user.churchId, taskId, user.id);

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
      const task = await completeTask(user.churchId, taskId, user.id);
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
