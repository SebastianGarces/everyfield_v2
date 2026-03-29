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
}

/**
 * Result of a listTasks query with pagination info.
 */
export interface ListTasksResult {
  tasks: TaskWithAssignee[];
  total: number;
  nextCursor: string | null;
}
