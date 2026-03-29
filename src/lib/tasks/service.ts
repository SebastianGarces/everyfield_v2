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
import type {
  TaskCreateInput,
  TaskUpdateInput,
} from "@/lib/validations/tasks";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { ListTasksResult, TaskCounts, TaskWithAssignee } from "./types";
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
