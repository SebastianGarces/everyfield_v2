"use server";

import { requireSeat } from "@/lib/auth/seats";
import { SeatRefusalError } from "@/lib/auth/seat-rules";
import type { Task } from "@/db/schema";
import {
  bulkCompleteTasks,
  bulkRescheduleTasks,
  completeTask,
  createTask,
  deleteTask,
  assertMayActOnTask,
  getTask,
  reopenTask,
  updateTask,
  SUBTASK_DEPTH_ERROR,
  SUBTASK_HAS_CHILDREN_ERROR,
  SUBTASK_PARENT_MISSING_ERROR,
  SUBTASK_SELF_ERROR,
  type BulkTaskResult,
} from "@/lib/tasks/service";
import {
  DEPENDENCY_CROSS_CHURCH_ERROR,
  DEPENDENCY_CYCLE_ERROR,
  DEPENDENCY_SELF_ERROR,
  DEPENDENCY_TASK_MISSING_ERROR,
  setTaskPrerequisites,
} from "@/lib/tasks/dependencies";
import { parseRecurrenceForm } from "@/lib/tasks/recurrence";
import { UNKNOWN_TEMPLATE_ERROR, importTaskTemplate } from "@/lib/tasks/import";
import { findTaskTemplate } from "@/lib/tasks/templates";
import type { ActionResult } from "@/lib/tasks/types";
import {
  bulkRescheduleSchema,
  bulkTaskIdsSchema,
  prerequisiteTaskIdsSchema,
  taskCreateSchema,
  taskQuickAddSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from "@/lib/validations/tasks";
import { refresh, revalidatePath } from "next/cache";

// ============================================================================
// EVERY EXPORT HERE MINTS ITS ACTOR ABOVE ITS `try` (#411).
//
// `memory/invariants.md` → Authentication asks for that shape, and the six
// parsing exports of this module were six of the 45 named try-wrapped mints —
// a residual "recorded rather than rushed" because the mint still preceded the
// parse, so there was no shape-oracle. Recorded is not fixed: inside the `try`,
// the catch converts a sessionless POST into a handled
// `{ success: false, error: "You must be logged in …" }`, which is an anonymous
// caller being answered rather than rejected. Above it the rejection escapes.
//
// The lift DELETES code rather than adding it: seven `if (error.message ===
// "Unauthorized")` branches in seven catches are unreachable once the mint is
// outside, so they are gone, and no catch in this module may grow one back
// (`importTaskTemplateAction`'s comment has said so since T-011). The six
// entries this module held in `TRY_WRAPPED_MINTS`
// (`src/lib/auth/server-action-surface.test.ts`) are retired with them; that
// list is a closed set asserted with `deepEqual`, so it fails if a new action
// here is written the old way.
// ============================================================================

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
  UNKNOWN_TEMPLATE_ERROR,
  DEPENDENCY_CYCLE_ERROR,
  DEPENDENCY_CROSS_CHURCH_ERROR,
  DEPENDENCY_SELF_ERROR,
  DEPENDENCY_TASK_MISSING_ERROR,
]);

/** What a Member is told when the task they aimed at is somebody else's. */
const NOT_YOUR_TASK_MESSAGE =
  "That task is assigned to somebody else, so you cannot change it.";

function userFacingError(error: unknown): string | null {
  // The own-duty refusal (AS-006) is a SENTENCE, not the generic "please try
  // again" every other throw becomes: the press did not fail, it was refused,
  // and a caller told to retry will retry. An `instanceof` and not a message
  // prefix — the refusal's own text names the capability, which is a log line.
  if (error instanceof SeatRefusalError) return NOT_YOUR_TASK_MESSAGE;

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

/**
 * Prerequisite ids from the task form's hidden input. `null` means the
 * field was not posted (quick-add, bulk, anything that does not own the
 * dependency editor) and the existing edges must be left alone.
 */
function parsePostedPrerequisiteIds(
  rawData: Record<string, unknown>
):
  | { ok: true; ids: string[] }
  | { ok: false; fieldErrors: Record<string, string[]> }
  | null {
  if (!Object.hasOwn(rawData, "prerequisiteTaskIds")) return null;

  const parsed = prerequisiteTaskIdsSchema.safeParse(
    rawData.prerequisiteTaskIds ?? ""
  );
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: {
        prerequisiteTaskIds: ["Choose valid tasks"],
      },
    };
  }
  return { ok: true, ids: parsed.data };
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
  const { user } = await requireSeat("tasks.write");

  try {
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

    const prerequisites = parsePostedPrerequisiteIds(rawData);
    if (prerequisites && !prerequisites.ok) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: prerequisites.fieldErrors,
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

    if (prerequisites?.ok && prerequisites.ids.length > 0) {
      try {
        await setTaskPrerequisites(user.churchId, task.id, prerequisites.ids);
      } catch (error) {
        await deleteTask(user.churchId, task.id);
        throw error;
      }
    }

    refresh();
    revalidatePath("/tasks");

    return { success: true, data: task };
  } catch (error) {
    console.error("createTaskAction error:", error);

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
  const { user } = await requireSeat("tasks.write");

  try {
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
  const { user } = await requireSeat("tasks.write");

  try {
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

    const prerequisites = parsePostedPrerequisiteIds(rawData);
    if (prerequisites && !prerequisites.ok) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: prerequisites.fieldErrors,
      };
    }

    const task = await updateTask(
      user.churchId,
      taskId,
      parsed.data,
      parseRecurrenceForm(rawData) ?? undefined
    );

    if (prerequisites?.ok) {
      await setTaskPrerequisites(user.churchId, taskId, prerequisites.ids);
    }

    refresh();
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("updateTaskAction error:", error);

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
  const { user } = await requireSeat("tasks.own");

  try {
    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const { task } = await completeTask(user.churchId, taskId, user);

    // `refresh()` updates the page the planter is standing on — completing
    // the last prerequisite must clear the dependent's blocked badge without
    // a full navigation. `revalidatePath` covers the other task surfaces.
    refresh();
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("completeTaskAction error:", error);

    if (error instanceof SeatRefusalError) {
      return { success: false, error: NOT_YOUR_TASK_MESSAGE };
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
  const { user } = await requireSeat("tasks.own");

  try {
    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const task = await reopenTask(user.churchId, taskId, user);

    refresh();
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("reopenTaskAction error:", error);

    if (error instanceof SeatRefusalError) {
      return { success: false, error: NOT_YOUR_TASK_MESSAGE };
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
  const { user } = await requireSeat("tasks.write");

  try {
    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    await deleteTask(user.churchId, taskId);

    revalidatePath("/tasks");

    return { success: true, data: undefined };
  } catch (error) {
    console.error("deleteTaskAction error:", error);

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
 *
 * THE STATUS IS PARSED, NOT CAST (#411). This export is a POST endpoint that
 * never saw the dropdown, and the argument used to be asserted into the union
 * (`status as "not_started" | …`) on its way into `updateTask`. `tasks.status`
 * is guarded by a CHECK over the four legal values, so an unrecognised string
 * reached Postgres, was refused, and came back as the generic
 * "Please try again" — a validation answer delivered as a write failure. The
 * enum is the same one the write schemas use.
 */
export async function updateTaskStatusAction(
  taskId: string,
  status: string
): Promise<ActionResult<Task>> {
  const { user } = await requireSeat("tasks.own");

  try {
    if (!user.churchId) {
      return { success: false, error: "No church association" };
    }

    const parsed = taskStatusSchema.safeParse(status);
    if (!parsed.success) {
      return { success: false, error: "That is not a status a task can have" };
    }

    // If marking complete, use completeTask for proper event emission — and
    // that path asks the own-duty question itself.
    if (parsed.data === "complete") {
      const { task } = await completeTask(user.churchId, taskId, user);
      revalidatePath("/tasks");
      return { success: true, data: task };
    }

    // Every OTHER status goes through the generic `updateTask`, which is a
    // `tasks.write` door with no subject of its own — so the own-duty question
    // is asked here, against the row this call is about (AS-006).
    const existing = await getTask(user.churchId, taskId);
    if (!existing) {
      return { success: false, error: "Task not found" };
    }
    assertMayActOnTask(user, existing);

    const task = await updateTask(user.churchId, taskId, {
      status: parsed.data,
    });

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("updateTaskStatusAction error:", error);

    if (error instanceof SeatRefusalError) {
      return { success: false, error: NOT_YOUR_TASK_MESSAGE };
    }

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
  const { user } = await requireSeat("tasks.own");

  try {
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to add subtasks",
      };
    }

    // The parent IS the subject of this write, so it is the row the own-duty
    // rule is asked about: a Member may add a step to a task assigned to them,
    // and an Admin to anybody's. Loaded before the parse only because the parse
    // needs nothing from it — the seat guard already ran on line one.
    const parent = await getTask(user.churchId, parentTaskId);
    if (!parent) {
      return { success: false, error: "Task not found" };
    }
    assertMayActOnTask(user, parent);

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
  const { user } = await requireSeat("tasks.own");

  try {
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
      ? (await completeTask(user.churchId, subtaskId, user)).task
      : await reopenTask(user.churchId, subtaskId, user);

    refresh();
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${subtask.parentTaskId}`);

    return { success: true, data: task };
  } catch (error) {
    console.error("setSubtaskCompletionAction error:", error);

    if (error instanceof SeatRefusalError) {
      return { success: false, error: NOT_YOUR_TASK_MESSAGE };
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
  const { user } = await requireSeat("tasks.own");

  try {
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

    const result = await bulkCompleteTasks(user.churchId, parsed.data, user);

    revalidatePath("/tasks");

    return { success: true, data: result };
  } catch (error) {
    console.error("bulkCompleteTasksAction error:", error);

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
  const { user } = await requireSeat("tasks.write");

  try {
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

    return {
      success: false,
      error: "Failed to reschedule the selected tasks. Please try again.",
    };
  }
}

// ============================================================================
// Template Import (T-011 / T-012)
// ============================================================================

/** What the picker reports after a successful import. */
export interface TemplateImportSummary {
  templateKey: string;
  templateName: string;
  /** How many tasks were created. */
  created: number;
  /** The day the due dates were measured from, `YYYY-MM-DD`. */
  importedOn: string;
  /** The last due date in the imported set, `YYYY-MM-DD`. */
  lastDueDate: string | null;
}

/**
 * Import a checklist template as tasks for the caller's church.
 *
 * The ONLY argument is the template key. The church and the actor are minted
 * from the session, never accepted (`memory/invariants.md` → Authentication) —
 * this export is a POSTable endpoint with no UI in front of it, so a supplied
 * church id would be a way to write tasks into someone else's plant.
 *
 * The key is checked against the catalog before anything is written, so an
 * unknown key is a refusal rather than an empty import that reports success.
 *
 * THE MINT IS ABOVE THE `try`, not merely first inside it, which is the shape
 * `memory/invariants.md` → Authentication requires of a NEW action. Inside the
 * `try` the catch converts a sessionless POST into a handled
 * `{ success: false }`; above it the rejection escapes, which is what an
 * anonymous caller is owed. The 45 older try-wrapped mints are a closed,
 * pinned residual (`TRY_WRAPPED_MINTS` in
 * `src/lib/auth/server-action-surface.test.ts`) and this export is not one of
 * them — it also takes a bare `string` and parses nothing, so the repo-wide
 * walk, which only follows exports containing `.safeParse(`, would never have
 * seen it. The rule is the authority here, not the walk.
 *
 * The only caller, `template-picker.tsx`, already wraps the call in
 * `try`/`catch` and renders `IMPORT_FAILED_MESSAGE` on an outright rejection.
 */
export async function importTaskTemplateAction(
  templateKey: string
): Promise<ActionResult<TemplateImportSummary>> {
  const { user } = await requireSeat("tasks.write");

  try {
    // Not part of the auth check: a session with no church is a signed-in user
    // with nothing to import INTO, which is a data condition and gets a
    // sentence.
    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to import a checklist",
      };
    }

    if (typeof templateKey !== "string" || !findTaskTemplate(templateKey)) {
      return { success: false, error: UNKNOWN_TEMPLATE_ERROR };
    }

    const result = await importTaskTemplate({
      churchId: user.churchId,
      userId: user.id,
      templateKey,
    });

    const dueDates = result.created
      .map((task) => task.dueDate)
      .filter((dueDate): dueDate is string => dueDate !== null)
      .sort();

    // The picker lives on /tasks, so the list under it reconciles through
    // `refresh()`; `revalidatePath` covers the same page for anyone who
    // reaches the import from elsewhere (`memory/contracts/data-patterns.md`).
    refresh();
    revalidatePath("/tasks");

    return {
      success: true,
      data: {
        templateKey: result.templateKey,
        templateName: result.templateName,
        created: result.created.length,
        importedOn: result.importedOn,
        lastDueDate: dueDates.at(-1) ?? null,
      },
    };
  } catch (error) {
    console.error("importTaskTemplateAction error:", error);

    // No `Unauthorized` branch here, and there must not be one: the mint is
    // above this `try`, so that rejection never reaches this catch. Re-adding
    // it would be the first half of moving the mint back down.
    const known = userFacingError(error);
    if (known) return { success: false, error: known };

    return {
      success: false,
      error: "Failed to import the checklist. Please try again.",
    };
  }
}
