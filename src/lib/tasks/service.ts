import { db } from "@/db";
import {
  tasks,
  users,
  type NewTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskCategory,
} from "@/db/schema";
import type { TaskCreateInput, TaskUpdateInput } from "@/lib/validations/tasks";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { ListTasksResult, TaskCounts, TaskWithAssignee } from "./types";
import { MAX_BULK_TASKS } from "./types";
import { emitTaskCompleted } from "./events";

// ============================================================================
// Types
// ============================================================================

export interface ListTasksOptions {
  cursor?: string;
  limit?: number; // default 50, max 100
  status?: TaskStatus[];
  priority?: TaskPriority[];
  category?: TaskCategory[];
  assignedToId?: string; // filter to specific user's tasks
  dueDateFrom?: string; // ISO date
  dueDateTo?: string; // ISO date
  search?: string;
  includeCompleted?: boolean; // default false
  sortBy?: "due_date" | "priority" | "status" | "created_at" | "title";
  sortDir?: "asc" | "desc";
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single task by ID with assignee info.
 * Returns null if not found or soft-deleted.
 */
export async function getTask(
  churchId: string,
  taskId: string
): Promise<TaskWithAssignee | null> {
  const result = await db
    .select({
      id: tasks.id,
      churchId: tasks.churchId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      assignedToId: tasks.assignedToId,
      category: tasks.category,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      parentTaskId: tasks.parentTaskId,
      isRecurring: tasks.isRecurring,
      recurrenceRule: tasks.recurrenceRule,
      completedAt: tasks.completedAt,
      completedById: tasks.completedById,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      deletedAt: tasks.deletedAt,
      assigneeName: users.name,
      assigneeEmail: users.email,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);

  return (result[0] as TaskWithAssignee) ?? null;
}

/**
 * List tasks with filtering, sorting, and cursor-based pagination.
 * By default excludes completed and soft-deleted tasks.
 */
export async function listTasks(
  churchId: string,
  options: ListTasksOptions = {}
): Promise<ListTasksResult> {
  const {
    cursor,
    limit = 50,
    status,
    priority,
    category,
    assignedToId,
    dueDateFrom,
    dueDateTo,
    search,
    includeCompleted = false,
    sortBy = "due_date",
    sortDir = "asc",
  } = options;

  const safeLimit = Math.min(Math.max(1, limit), 100);

  // Build base conditions
  const baseConditions = [
    eq(tasks.churchId, churchId),
    isNull(tasks.deletedAt),
  ];

  // Exclude completed unless requested
  if (!includeCompleted) {
    baseConditions.push(ne(tasks.status, "complete"));
  }

  // Filter by status
  if (status && status.length > 0) {
    baseConditions.push(inArray(tasks.status, status));
  }

  // Filter by priority
  if (priority && priority.length > 0) {
    baseConditions.push(inArray(tasks.priority, priority));
  }

  // Filter by category
  if (category && category.length > 0) {
    baseConditions.push(inArray(tasks.category, category));
  }

  // Filter by assignee
  if (assignedToId) {
    baseConditions.push(eq(tasks.assignedToId, assignedToId));
  }

  // Filter by due date range
  if (dueDateFrom) {
    baseConditions.push(gte(tasks.dueDate, dueDateFrom));
  }
  if (dueDateTo) {
    baseConditions.push(lte(tasks.dueDate, dueDateTo));
  }

  // Filter by search term
  if (search) {
    const searchLike = `%${search}%`;
    const searchCondition = ilike(tasks.title, searchLike);
    baseConditions.push(searchCondition);
  }

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(...baseConditions));

  const total = countResult?.count ?? 0;

  // Build sort order
  const priorityOrder = sql`CASE ${tasks.priority}
    WHEN 'urgent' THEN 0
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
  END`;

  const getSortColumn = () => {
    switch (sortBy) {
      case "due_date":
        // Null due dates go to the end
        return sql`COALESCE(${tasks.dueDate}, '9999-12-31')`;
      case "priority":
        return priorityOrder;
      case "status":
        return tasks.status;
      case "title":
        return tasks.title;
      case "created_at":
      default:
        return tasks.createdAt;
    }
  };

  const sortColumn = getSortColumn();
  const orderFn = sortDir === "desc" ? desc : asc;

  // Cursor-based pagination
  const queryConditions = [...baseConditions];
  if (cursor) {
    const cursorTask = await db
      .select({ createdAt: tasks.createdAt })
      .from(tasks)
      .where(and(eq(tasks.id, cursor), eq(tasks.churchId, churchId)))
      .limit(1);

    if (cursorTask[0]) {
      queryConditions.push(
        sql`(${tasks.createdAt}, ${tasks.id}) < (${cursorTask[0].createdAt}, ${cursor})`
      );
    }
  }

  // Fetch tasks with assignee info
  const result = await db
    .select({
      id: tasks.id,
      churchId: tasks.churchId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      assignedToId: tasks.assignedToId,
      category: tasks.category,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      parentTaskId: tasks.parentTaskId,
      isRecurring: tasks.isRecurring,
      recurrenceRule: tasks.recurrenceRule,
      completedAt: tasks.completedAt,
      completedById: tasks.completedById,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      deletedAt: tasks.deletedAt,
      assigneeName: users.name,
      assigneeEmail: users.email,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .where(and(...queryConditions))
    .orderBy(orderFn(sortColumn), desc(tasks.id))
    .limit(safeLimit + 1);

  const hasMore = result.length > safeLimit;
  const resultTasks = hasMore ? result.slice(0, safeLimit) : result;
  const nextCursor = hasMore
    ? (resultTasks[resultTasks.length - 1]?.id ?? null)
    : null;

  return {
    tasks: resultTasks as TaskWithAssignee[],
    total,
    nextCursor,
  };
}

/**
 * Get task counts grouped by status for a church.
 * Optionally filtered to a specific user's assigned tasks.
 */
export async function getTaskCounts(
  churchId: string,
  userId?: string
): Promise<TaskCounts> {
  const baseConditions = [
    eq(tasks.churchId, churchId),
    isNull(tasks.deletedAt),
  ];

  if (userId) {
    baseConditions.push(eq(tasks.assignedToId, userId));
  }

  const today = new Date().toISOString().split("T")[0];

  const result = await db
    .select({
      notStarted: sql<number>`count(*) filter (where ${tasks.status} = 'not_started')::int`,
      inProgress: sql<number>`count(*) filter (where ${tasks.status} = 'in_progress')::int`,
      blocked: sql<number>`count(*) filter (where ${tasks.status} = 'blocked')::int`,
      complete: sql<number>`count(*) filter (where ${tasks.status} = 'complete')::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.status} != 'complete' and ${tasks.dueDate} < ${today})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(and(...baseConditions));

  return (
    result[0] ?? {
      notStarted: 0,
      inProgress: 0,
      blocked: 0,
      complete: 0,
      overdue: 0,
      total: 0,
    }
  );
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new task.
 */
export async function createTask(
  churchId: string,
  userId: string,
  data: TaskCreateInput
): Promise<Task> {
  const values: NewTask = {
    churchId,
    createdById: userId,
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    dueDate: data.dueDate ?? null,
    dueTime: data.dueTime ?? null,
    assignedToId: data.assignedToId || null,
    category: data.category ?? null,
    relatedType: data.relatedType ?? null,
    relatedId: data.relatedId || null,
    parentTaskId: data.parentTaskId || null,
  };

  const [task] = await db.insert(tasks).values(values).returning();

  return task;
}

/**
 * Update an existing task.
 * Throws error if task not found or soft-deleted.
 */
export async function updateTask(
  churchId: string,
  taskId: string,
  data: TaskUpdateInput
): Promise<Task> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  const updateData: Partial<NewTask> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined)
    updateData.description = data.description ?? null;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ?? null;
  if (data.dueTime !== undefined) updateData.dueTime = data.dueTime ?? null;
  if (data.assignedToId !== undefined)
    updateData.assignedToId = data.assignedToId ?? null;
  if (data.category !== undefined) updateData.category = data.category ?? null;
  if (data.relatedType !== undefined)
    updateData.relatedType = data.relatedType ?? null;
  if (data.relatedId !== undefined)
    updateData.relatedId = data.relatedId ?? null;
  if (data.parentTaskId !== undefined)
    updateData.parentTaskId = data.parentTaskId ?? null;

  const [updated] = await db
    .update(tasks)
    .set(updateData)
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update task");
  }

  return updated;
}

/**
 * Mark a task as complete with timestamp and user.
 * Emits task.completed event.
 */
export async function completeTask(
  churchId: string,
  taskId: string,
  userId: string
): Promise<Task> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  if (existing.status === "complete") {
    throw new Error("Task is already complete");
  }

  const [completed] = await db
    .update(tasks)
    .set({
      status: "complete",
      completedAt: new Date(),
      completedById: userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt)
      )
    )
    .returning();

  if (!completed) {
    throw new Error("Failed to complete task");
  }

  // Emit task.completed event
  await emitTaskCompleted(
    completed.id,
    completed.churchId,
    completed.category,
    completed.relatedType,
    completed.relatedId,
    userId
  );

  return completed;
}

/**
 * Reopen a completed task (set status back to not_started).
 */
export async function reopenTask(
  churchId: string,
  taskId: string
): Promise<Task> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  if (existing.status !== "complete") {
    throw new Error("Task is not complete");
  }

  const [reopened] = await db
    .update(tasks)
    .set({
      status: "not_started",
      completedAt: null,
      completedById: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt)
      )
    )
    .returning();

  if (!reopened) {
    throw new Error("Failed to reopen task");
  }

  return reopened;
}

/**
 * Soft delete a task.
 */
export async function deleteTask(
  churchId: string,
  taskId: string
): Promise<void> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  await db
    .update(tasks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt)
      )
    );
}

// ============================================================================
// Bulk Operations (T-019)
// ============================================================================
//
// Two rules shape this section:
//
// 1. NOTHING IS SILENTLY DROPPED. Every requested task id comes back in the
//    result either as a success or as a failure carrying a human reason. The
//    write itself is a single statement (one round trip, not N), and the ids
//    it returns are reconciled against the ids we asked for — anything the
//    statement did not touch is reported, not assumed.
//
// 2. DOWNSTREAM CONSUMERS ARE NOT STAMPEDED. A bulk complete emits one
//    `task.completed` per task (auto-completion + Phase Engine dirty-marking
//    subscribe to it, and skipping any would lose a material event). They are
//    emitted SEQUENTIALLY — awaited one at a time — so a 100-task bulk write
//    never fans 100 concurrent handler chains at the DB. Dirty-marking is
//    idempotent per church, so repeated stamps are cheap and safe.
//
// The pure planner/reconciler below is exported so the partial-failure
// behaviour is unit-testable without a database.
// ============================================================================

/**
 * Upper bound on a single bulk operation. Defined in `./types` so the selection
 * UI can import the value too; re-exported here because this is where callers
 * of the bulk operations already look.
 */
export { MAX_BULK_TASKS };

/** One requested task that did not make it through the operation, and why. */
export interface BulkTaskFailure {
  taskId: string;
  title: string | null;
  reason: string;
}

/** Outcome of a bulk operation over a set of requested task ids. */
export interface BulkTaskResult {
  /** How many distinct task ids the caller asked for. */
  requested: number;
  /** Ids that were actually written. */
  succeeded: string[];
  /** Ids that were not written, each with a reason. */
  failed: BulkTaskFailure[];
  /** How many `task.completed` events were emitted (bulk complete only). */
  eventsEmitted: number;
}

/** The minimal row shape bulk operations need to plan and emit events. */
export interface BulkTaskCandidate {
  id: string;
  churchId: string;
  title: string;
  status: TaskStatus;
  category: TaskCategory | null;
  relatedType: string | null;
  relatedId: string | null;
}

/** What a bulk operation intends to do, before it touches anything. */
export interface BulkTaskPlan {
  /** Distinct requested ids, in request order. */
  requested: string[];
  /** Rows that exist, are in scope, and are eligible for the operation. */
  actionable: BulkTaskCandidate[];
  /** Requested ids rejected before the write (missing, ineligible). */
  failures: BulkTaskFailure[];
}

/**
 * Pure: decide which of the requested ids can be operated on.
 *
 * A requested id that was not loaded is a failure ("Task not found") — that
 * covers ids from another church, soft-deleted rows, and stale client state.
 */
export function planBulkTaskOperation(
  requestedIds: string[],
  found: BulkTaskCandidate[],
  options: { rejectCompleted?: boolean; completedReason?: string } = {}
): BulkTaskPlan {
  const requested = [...new Set(requestedIds)];
  const byId = new Map(found.map((row) => [row.id, row]));

  const actionable: BulkTaskCandidate[] = [];
  const failures: BulkTaskFailure[] = [];

  for (const id of requested) {
    const row = byId.get(id);

    if (!row) {
      failures.push({ taskId: id, title: null, reason: "Task not found" });
      continue;
    }

    if (options.rejectCompleted && row.status === "complete") {
      failures.push({
        taskId: id,
        title: row.title,
        reason: options.completedReason ?? "Task is already complete",
      });
      continue;
    }

    actionable.push(row);
  }

  return { requested, actionable, failures };
}

/**
 * Pure: fold the ids a write actually returned back into the plan.
 *
 * Anything the plan considered actionable but the write did not return is
 * reported as a failure — a bulk operation never quietly loses a row.
 */
export function reconcileBulkTaskOperation(
  plan: BulkTaskPlan,
  writtenIds: string[],
  missedReason = "Task could not be updated"
): { result: BulkTaskResult; written: BulkTaskCandidate[] } {
  const writtenSet = new Set(writtenIds);

  const written = plan.actionable.filter((row) => writtenSet.has(row.id));
  const missed = plan.actionable
    .filter((row) => !writtenSet.has(row.id))
    .map((row) => ({
      taskId: row.id,
      title: row.title,
      reason: missedReason,
    }));

  return {
    result: {
      requested: plan.requested.length,
      succeeded: written.map((row) => row.id),
      failed: [...plan.failures, ...missed],
      eventsEmitted: 0,
    },
    written,
  };
}

/**
 * The database/event surface a bulk operation needs. Injectable so the
 * partial-failure and event-fan-out behaviour can be unit-tested without a DB.
 */
export interface BulkTaskDeps {
  loadCandidates(
    churchId: string,
    taskIds: string[]
  ): Promise<BulkTaskCandidate[]>;
  completeMany(
    churchId: string,
    taskIds: string[],
    userId: string
  ): Promise<string[]>;
  rescheduleMany(
    churchId: string,
    taskIds: string[],
    dueDate: string
  ): Promise<string[]>;
  emitCompleted(task: BulkTaskCandidate, userId: string): Promise<void>;
}

export const defaultBulkTaskDeps: BulkTaskDeps = {
  async loadCandidates(churchId, taskIds) {
    if (taskIds.length === 0) return [];

    return db
      .select({
        id: tasks.id,
        churchId: tasks.churchId,
        title: tasks.title,
        status: tasks.status,
        category: tasks.category,
        relatedType: tasks.relatedType,
        relatedId: tasks.relatedId,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          inArray(tasks.id, taskIds),
          isNull(tasks.deletedAt)
        )
      );
  },

  async completeMany(churchId, taskIds, userId) {
    const now = new Date();

    const updated = await db
      .update(tasks)
      .set({
        status: "complete",
        completedAt: now,
        completedById: userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(tasks.churchId, churchId),
          inArray(tasks.id, taskIds),
          isNull(tasks.deletedAt),
          ne(tasks.status, "complete")
        )
      )
      .returning({ id: tasks.id });

    return updated.map((row) => row.id);
  },

  async rescheduleMany(churchId, taskIds, dueDate) {
    const updated = await db
      .update(tasks)
      .set({ dueDate, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.churchId, churchId),
          inArray(tasks.id, taskIds),
          isNull(tasks.deletedAt),
          // Mirrors the planner's rejectCompleted guard. Belt and braces: if a
          // task is completed between the load and this write, it is reported
          // as a failure rather than quietly given a new due date.
          ne(tasks.status, "complete")
        )
      )
      .returning({ id: tasks.id });

    return updated.map((row) => row.id);
  },

  async emitCompleted(task, userId) {
    await emitTaskCompleted(
      task.id,
      task.churchId,
      task.category,
      task.relatedType,
      task.relatedId,
      userId
    );
  },
};

function emptyBulkResult(): BulkTaskResult {
  return { requested: 0, succeeded: [], failed: [], eventsEmitted: 0 };
}

function assertBulkSize(requested: string[]): void {
  if (requested.length > MAX_BULK_TASKS) {
    throw new Error(`Cannot update more than ${MAX_BULK_TASKS} tasks at once`);
  }
}

/**
 * Complete many tasks in one operation.
 *
 * Emits one `task.completed` event per task that was actually completed —
 * sequentially, so downstream subscribers (auto-completion, Phase Engine
 * dirty-marking) see every task without being hit concurrently. Tasks that
 * could not be completed are returned in `failed`, never dropped.
 */
export async function bulkCompleteTasks(
  churchId: string,
  taskIds: string[],
  userId: string,
  deps: BulkTaskDeps = defaultBulkTaskDeps
): Promise<BulkTaskResult> {
  const requested = [...new Set(taskIds)];
  if (requested.length === 0) return emptyBulkResult();
  assertBulkSize(requested);

  const found = await deps.loadCandidates(churchId, requested);
  const plan = planBulkTaskOperation(requested, found, {
    rejectCompleted: true,
  });

  let writtenIds: string[] = [];
  // The raw error is logged server-side only — provider/constraint text must
  // never reach the user-facing failure reason.
  const missedReason = "Task could not be completed";

  if (plan.actionable.length > 0) {
    try {
      writtenIds = await deps.completeMany(
        churchId,
        plan.actionable.map((row) => row.id),
        userId
      );
    } catch (error) {
      console.error("bulkCompleteTasks write failed:", error);
    }
  }

  const { result, written } = reconcileBulkTaskOperation(
    plan,
    writtenIds,
    missedReason
  );

  // One event per completed task, emitted one at a time (see header note).
  for (const task of written) {
    try {
      await deps.emitCompleted(task, userId);
      result.eventsEmitted += 1;
    } catch (error) {
      // The write already landed — a failed emit degrades downstream
      // freshness, it does not un-complete the task.
      console.error(
        `bulkCompleteTasks failed to emit task.completed for ${task.id}:`,
        error
      );
    }
  }

  return result;
}

/**
 * Set the same due date on many tasks in one operation.
 *
 * Rescheduling is not a material event (no status change), so it emits no
 * events. Tasks that could not be rescheduled are returned in `failed`.
 *
 * Completed tasks are refused, not re-dated. A due date on a finished task
 * means nothing, and the task list renders a "Completed" group with its own
 * select-all — so without this guard one click there would silently hand a
 * batch of done tasks a fresh deadline and drag them back into the Overdue or
 * Today group. Refusing them surfaces as a named partial failure, which is the
 * honest outcome rather than a silent one.
 */
export async function bulkRescheduleTasks(
  churchId: string,
  taskIds: string[],
  dueDate: string,
  deps: BulkTaskDeps = defaultBulkTaskDeps
): Promise<BulkTaskResult> {
  const requested = [...new Set(taskIds)];
  if (requested.length === 0) return emptyBulkResult();
  assertBulkSize(requested);

  const found = await deps.loadCandidates(churchId, requested);
  const plan = planBulkTaskOperation(requested, found, {
    rejectCompleted: true,
    completedReason: "Task is complete — reopen it before rescheduling",
  });

  let writtenIds: string[] = [];
  const missedReason = "Task could not be rescheduled";

  if (plan.actionable.length > 0) {
    try {
      writtenIds = await deps.rescheduleMany(
        churchId,
        plan.actionable.map((row) => row.id),
        dueDate
      );
    } catch (error) {
      console.error("bulkRescheduleTasks write failed:", error);
    }
  }

  return reconcileBulkTaskOperation(plan, writtenIds, missedReason).result;
}
