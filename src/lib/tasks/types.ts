import type { Task } from "@/db/schema";

// ============================================================================
// Action Result
// ============================================================================

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// ============================================================================
// Extended Types
// ============================================================================

/**
 * Task with assignee name resolved from the users table.
 */
export interface TaskWithAssignee extends Task {
  assigneeName: string | null;
  assigneeEmail: string | null;
}

/**
 * Counts of tasks grouped by status for a church (or user).
 */
export interface TaskCounts {
  notStarted: number;
  inProgress: number;
  blocked: number;
  complete: number;
  overdue: number;
  total: number;
  /**
   * Checklist items belonging to the tasks in scope, counted separately from
   * the task numbers above (T-016).
   *
   * Kept apart on purpose: a ticked checklist item is not a completed task, so
   * folding it into `complete` would make one task look like six. The UI
   * reports these on their own quiet line, and only when `checklistTotal > 0`.
   */
  checklistComplete: number;
  checklistTotal: number;
}

/**
 * Result of a listTasks query with pagination info.
 */
export interface ListTasksResult {
  tasks: TaskWithAssignee[];
  total: number;
  nextCursor: string | null;
}

/**
 * Upper bound on a single bulk operation (T-019). Keeps one bulk write to one
 * SQL statement.
 *
 * It lives here, rather than in `service.ts`, because the selection UI needs it
 * to disable the bulk actions *before* the click — and this module is
 * type-only at runtime, so a client component can import the value without
 * pulling the database-backed service into the browser bundle.
 */
export const MAX_BULK_TASKS = 100;
