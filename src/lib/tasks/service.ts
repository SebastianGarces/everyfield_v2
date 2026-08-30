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
import type { User } from "@/db/schema";
import { SeatRefusalError, holdsSeatFor } from "@/lib/auth/seat-rules";
import type { TaskCreateInput, TaskUpdateInput } from "@/lib/validations/tasks";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
// Task descriptions are rich text (T-021), sharing COM-017's editor and its
// sanitiser. `descriptions.ts` owns both halves of that — the write gate and
// the list surfaces' readable preview — and its header states the rules.
import {
  normalizeTaskDescription,
  withDescriptionPreviews,
  type WithDescriptionPreview,
} from "./descriptions";
import type { ListTasksResult, TaskCounts, TaskWithAssignee } from "./types";
import { MAX_BULK_TASKS } from "./types";
import { emitTaskCompleted } from "./events";
// T-018 — the F11 queue, consumed. `notifications.ts` owns every rule about
// what a task owes its assignee and when; this module only says WHEN the
// question is asked. Each call swallows its own failures, so a notification can
// never fail the write it follows.
import {
  cancelTaskNotificationsFor,
  syncTaskNotifications,
  syncTaskNotificationsFor,
  taskNotificationsDiffer,
  type TaskNotificationFacts,
} from "./notifications";
import { toCalendarDate } from "@/lib/datetime";
import { blockedTaskIdsAmong } from "./dependencies";
import { assertMayOwnFollowUp } from "./follow-up-ownership";
import { mayActOnTaskRow } from "./own-duty";
import {
  nextRecurrenceDueDate,
  parseRecurrenceRule,
  seriesIdOf,
  type TaskRecurrenceInput,
} from "./recurrence";

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
  /**
   * Let subtasks into the result as rows of their own. Default false.
   *
   * A subtask belongs to its parent's detail view, not to the task list: a
   * checklist item ("book the room", "print the flyers") is meaningless torn
   * out of the task it itemises, and letting the items in would make one piece
   * of work look like six. `total` respects this too, so the "showing N of M"
   * footer counts the same things the list shows.
   */
  includeSubtasks?: boolean; // default false
  sortBy?: TaskSortBy;
  sortDir?: "asc" | "desc";
}

/** The orders `/tasks` can be read in. */
export type TaskSortBy =
  | "due_date"
  | "priority"
  | "status"
  | "created_at"
  | "title";

/** The columns a sort key is computed from — every list row has them. */
export interface TaskSortableRow {
  id: string;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  title: string;
  createdAt: Date;
}

/**
 * THE ONE PLACE A SORT ORDER IS DEFINED (#320).
 *
 * Each entry names the SQL expression rows are ordered by AND the value that
 * expression produces for a row. `ORDER BY` and the keyset cursor predicate
 * below both read `.sql`, so they cannot describe different orders — which is
 * exactly what they used to do. The list was ordered by due date while the
 * cursor compared `created_at`, so "Load more" would have skipped rows whose
 * due date came after the cursor's but whose `created_at` came before it, and
 * repeated the ones the other way round. Nothing caught it because the button
 * was a disabled placeholder.
 *
 * `.of` is the same key in TypeScript, which is what lets the pagination test
 * page through a fixture without a database and still be testing the order the
 * query actually uses.
 */
export const TASK_SORT_KEYS: Record<
  TaskSortBy,
  { sql: SQL; of: (row: TaskSortableRow) => string }
> = {
  // Null due dates sort to the end, in SQL and in the key alike.
  due_date: {
    sql: sql`COALESCE(${tasks.dueDate}, '9999-12-31')`,
    of: (row) => row.dueDate ?? "9999-12-31",
  },
  priority: {
    sql: sql`CASE ${tasks.priority}
      WHEN 'urgent' THEN 0
      WHEN 'high' THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 3
    END`,
    of: (row) =>
      String(["urgent", "high", "medium", "low"].indexOf(row.priority)),
  },
  status: { sql: sql`${tasks.status}`, of: (row) => row.status },
  title: { sql: sql`${tasks.title}`, of: (row) => row.title },
  created_at: {
    sql: sql`${tasks.createdAt}`,
    of: (row) => row.createdAt.toISOString(),
  },
};

/**
 * A task as a LIST query returns it: everything `getTask` returns, plus the
 * readable summary of its description (T-021).
 *
 * A row type of its own rather than a second meaning for `description`. The
 * list readers used to overwrite that field with plain text while `getTask`
 * left it as HTML, both typed `TaskWithAssignee` — so which shape a caller was
 * holding depended on which query had produced it, and nothing in the type said
 * so. `description` is the stored markup on every row now; `descriptionPreview`
 * is the summary, and it is the field the card renders.
 */
export type TaskListRow = WithDescriptionPreview<TaskWithAssignee> & {
  /**
   * True while any live prerequisite is not complete (T-015). Derived from
   * the edge table, never stored as `status`. Completing the last
   * prerequisite clears this on the next render.
   */
  isBlocked: boolean;
};

/** `ListTasksResult` over the row type above. */
export interface TaskListResult extends Omit<ListTasksResult, "tasks"> {
  tasks: TaskListRow[];
}

// ============================================================================
// Queries
// ============================================================================

/**
 * THE ONE COLUMN LIST BEHIND EVERY `TaskWithAssignee` (#411).
 *
 * `getTask`, `listTasks` and `listSubtasks` each wrote out the same
 * twenty-odd `tasks.*` columns plus the two joined `users` ones, and each
 * finished with `as TaskWithAssignee`. Three hand-kept copies of one row shape,
 * with a cast at the end telling the compiler not to check them — so they had
 * already drifted: `listSubtasks` selected `completion_event` and the other two
 * did not, which made `getTask(...).completionEvent` a field the type promised
 * and the query never returned. Nothing read it yet, which is the only reason
 * it was not a bug.
 *
 * Declared once, `satisfies` the row type, and the casts are gone: a column
 * added to `tasks` is a compile error here until it is selected, and the three
 * readers cannot disagree about what a task row is.
 */
const taskWithAssigneeColumns = {
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
  completionEvent: tasks.completionEvent,
  completedAt: tasks.completedAt,
  completedById: tasks.completedById,
  createdById: tasks.createdById,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  deletedAt: tasks.deletedAt,
  assigneeName: users.name,
  assigneeEmail: users.email,
} satisfies Record<keyof TaskWithAssignee, unknown>;

/**
 * Get a single task by ID with assignee info.
 * Returns null if not found or soft-deleted.
 *
 * `description` comes back as the stored rich text (T-021) — this is what the
 * detail page renders and what the edit form loads. The list readers below hand
 * back the plain-text preview instead; see the Descriptions section.
 */
export async function getTask(
  churchId: string,
  taskId: string
): Promise<TaskWithAssignee | null> {
  const result = await db
    .select(taskWithAssigneeColumns)
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

  return result[0] ?? null;
}

/**
 * The condition that separates a task from a checklist item (T-016).
 *
 * Exported and shared rather than written out at each call site because the
 * list and the badges above it MUST agree on what they are counting. They
 * disagreed once — the badges read "3 completed" over a list with no completed
 * rows — and the ruling on #370 is that the badges mirror the list. Anything
 * that reports a number of *tasks* applies this.
 */
export function topLevelTasksOnly(table: TasksTable = tasks): SQL {
  return isNull(table.parentTaskId);
}

/**
 * The parent side of a checklist join — `tasks` again, under a second name, so
 * one query can constrain an item and the task it itemises at the same time.
 */
const checklistParent = alias(tasks, "checklist_parent");

/**
 * The `tasks` table, or an alias of it.
 *
 * The predicate builders below take the table they are speaking about, because
 * `getTaskCounts` has to constrain a parent by the same rules as its child.
 * Both members have the same columns; only the name in the SQL differs.
 *
 * Deliberately not exported: every caller outside this module wants the
 * default, and a type whose second arm nobody else can construct would read as
 * a choice it does not offer.
 */
type TasksTable = typeof tasks | typeof checklistParent;

/**
 * The filters a NUMBER of tasks is defined by.
 *
 * `listTasks`' options minus the four that belong to a reader walking rows
 * (`cursor`, `limit`, `sortBy`, `sortDir`), and minus the two the badges DECIDE
 * rather than accept. Those two are the whole point of the type:
 *
 * - `includeCompleted` is forced on. It is a display toggle over the
 *   population, not part of it, and the badges have to see completed rows to
 *   say how many "Show Completed" would reveal.
 * - there is no `includeSubtasks`, because a badge that says "3 completed"
 *   means three TASKS in every view (decision C on #370).
 *
 * Both were once unrepresentable, because the count query hard-coded them.
 * Handing the badges the list's full option type would have made them merely
 * documented again — an excess-property error is the version that holds.
 */
export type TaskCountScope = Omit<
  ListTasksOptions,
  | "cursor"
  | "limit"
  | "sortBy"
  | "sortDir"
  | "includeCompleted"
  | "includeSubtasks"
>;

/**
 * Every WHERE condition `listTasks` applies, as a list.
 *
 * Extracted so the count query and the page query cannot drift apart, and so a
 * test can render the conditions and compare them against `taskCountConditions`
 * without a database.
 */
export function taskListConditions(
  churchId: string,
  options: ListTasksOptions = {},
  table: TasksTable = tasks
): SQL[] {
  const {
    status,
    priority,
    category,
    assignedToId,
    dueDateFrom,
    dueDateTo,
    search,
    includeCompleted = false,
    includeSubtasks = false,
  } = options;

  const baseConditions: SQL[] = [
    eq(table.churchId, churchId),
    isNull(table.deletedAt),
  ];

  // Exclude completed unless requested
  if (!includeCompleted) {
    baseConditions.push(ne(table.status, "complete"));
  }

  // Top-level rows only unless requested (T-016). Applied to the count query
  // as well as the page query — both are built from `baseConditions`.
  if (!includeSubtasks) {
    baseConditions.push(topLevelTasksOnly(table));
  }

  // Filter by status
  if (status && status.length > 0) {
    baseConditions.push(inArray(table.status, status));
  }

  // Filter by priority
  if (priority && priority.length > 0) {
    baseConditions.push(inArray(table.priority, priority));
  }

  // Filter by category
  if (category && category.length > 0) {
    baseConditions.push(inArray(table.category, category));
  }

  // Filter by assignee
  if (assignedToId) {
    baseConditions.push(eq(table.assignedToId, assignedToId));
  }

  // Filter by due date range
  if (dueDateFrom) {
    baseConditions.push(gte(table.dueDate, dueDateFrom));
  }
  if (dueDateTo) {
    baseConditions.push(lte(table.dueDate, dueDateTo));
  }

  // Filter by search term
  if (search) {
    const searchLike = `%${search}%`;
    baseConditions.push(ilike(table.title, searchLike));
  }

  return baseConditions;
}

/**
 * List tasks with filtering, sorting, and cursor-based pagination.
 * By default excludes completed and soft-deleted tasks.
 */
export async function listTasks(
  churchId: string,
  options: ListTasksOptions = {}
): Promise<TaskListResult> {
  const { cursor, limit = 50, sortBy = "due_date", sortDir = "asc" } = options;

  const safeLimit = Math.min(Math.max(1, limit), 100);

  const baseConditions = taskListConditions(churchId, options);

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(...baseConditions));

  const total = countResult?.count ?? 0;

  // THE SORT KEY AND THE CURSOR ARE THE SAME EXPRESSION, from one entry in
  // TASK_SORT_KEYS. The id is the tie-break, in the SAME direction as the key,
  // so `(key, id)` is a total order a row-value comparison can walk.
  const sortKey = TASK_SORT_KEYS[sortBy];
  const orderFn = sortDir === "desc" ? desc : asc;

  // Cursor-based pagination. The cursor is a task id; its position is the
  // (key, id) pair, looked up church-scoped so a cursor cannot be aimed across
  // tenants.
  const queryConditions = [...baseConditions];
  if (cursor) {
    const cursorTask = await db
      .select({ sortValue: sortKey.sql })
      .from(tasks)
      .where(and(eq(tasks.id, cursor), eq(tasks.churchId, churchId)))
      .limit(1);

    if (cursorTask[0]) {
      queryConditions.push(
        sortDir === "desc"
          ? sql`(${sortKey.sql}, ${tasks.id}) < (${cursorTask[0].sortValue}, ${cursor})`
          : sql`(${sortKey.sql}, ${tasks.id}) > (${cursorTask[0].sortValue}, ${cursor})`
      );
    }
  }

  // Fetch tasks with assignee info
  const result = await db
    .select(taskWithAssigneeColumns)
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .where(and(...queryConditions))
    .orderBy(orderFn(sortKey.sql), orderFn(tasks.id))
    .limit(safeLimit + 1);

  const hasMore = result.length > safeLimit;
  const resultTasks = hasMore ? result.slice(0, safeLimit) : result;
  const nextCursor = hasMore
    ? (resultTasks[resultTasks.length - 1]?.id ?? null)
    : null;

  const blockedIds = await blockedTaskIdsAmong(
    churchId,
    resultTasks.map((task) => task.id)
  );

  return {
    // Readable text, never markup (T-021): the card renders every field it is
    // given as text, so an un-flattened description would print its own tags.
    tasks: withDescriptionPreviews(resultTasks).map((task) => ({
      ...task,
      isBlocked: blockedIds.has(task.id),
    })),
    total,
    nextCursor,
  };
}

/**
 * Every WHERE condition the status badges count over: the list's own.
 *
 * The badges mirror the list (decision C on #370), so they are not built from a
 * second hand-written predicate list — they are built from `taskListConditions`
 * itself, and whatever narrows the rows narrows the numbers with them. Written
 * out separately they drifted twice: first over subtasks, then over every
 * filter the URL carries, which is what #613 reported. `/tasks?category=
 * follow_up` counted the whole church and rendered "1 active / 2 completed"
 * above a "No tasks found" list.
 *
 * `includeCompleted` is the ONE option that does not carry over, and forcing it
 * on is the entire difference between the two readings. It is a display toggle
 * over the population rather than part of it: the badges have to see completed
 * rows in order to say how many "Show Completed" would reveal. A toggle whose
 * own badge reads "0 completed" explains itself; one that promises a task the
 * filter excludes is the dead control ruled on in #611.
 *
 * `TaskCountScope` is what makes both of those structural rather than stated:
 * neither option is on the type, so no caller can hand them in.
 */
export function taskCountConditions(
  churchId: string,
  options: TaskCountScope = {},
  table: TasksTable = tasks
): SQL[] {
  return taskListConditions(
    churchId,
    { ...options, includeCompleted: true },
    table
  );
}

/**
 * The "Checklists: N of M items done" line, as a query rather than a result.
 *
 * Handed back un-awaited — the technique `meetingFollowUpCountQuery` uses — so
 * a test can render its SQL without a database. It is the half of #613 that is
 * otherwise unreachable from outside this module, because the join it turns on
 * is against a private alias. The failure it guards is quiet: let
 * `includeCompleted` default through onto the PARENT side and every completed
 * task's checklist vanishes from the line, with nothing on screen to say so.
 *
 * Items are scoped by their PARENT rather than by their own assignee, and the
 * parent carries the badges' own conditions: the question the line answers is
 * "how much checklist work sits inside the tasks I am looking at", so an item
 * follows the task it itemises into or out of view.
 */
export function checklistCountQuery(
  churchId: string,
  options: TaskCountScope = {}
) {
  return db
    .select({
      checklistComplete: sql<number>`count(*) filter (where ${tasks.status} = 'complete')::int`,
      checklistTotal: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .innerJoin(checklistParent, eq(tasks.parentTaskId, checklistParent.id))
    .where(
      and(
        eq(tasks.churchId, churchId),
        isNull(tasks.deletedAt),
        isNotNull(tasks.parentTaskId),
        ...taskCountConditions(churchId, options, checklistParent)
      )
    );
}

/**
 * Get task counts grouped by status for a church, under the same filters the
 * list is read with — pass the scope the list was read under.
 *
 * Checklist items are counted separately, in `checklistTotal` /
 * `checklistComplete` — see `checklistCountQuery` for why they follow their
 * parent rather than their own assignee.
 */
export async function getTaskCounts(
  churchId: string,
  options: TaskCountScope = {}
): Promise<TaskCounts> {
  const baseConditions = taskCountConditions(churchId, options);

  // The domain's one spelling of "today, as a calendar day in APP_TIME_ZONE".
  const today = toCalendarDate(new Date());

  const [statusResult, checklistResult] = await Promise.all([
    db
      .select({
        notStarted: sql<number>`count(*) filter (where ${tasks.status} = 'not_started')::int`,
        inProgress: sql<number>`count(*) filter (where ${tasks.status} = 'in_progress')::int`,
        blocked: sql<number>`count(*) filter (where ${tasks.status} = 'blocked')::int`,
        complete: sql<number>`count(*) filter (where ${tasks.status} = 'complete')::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} != 'complete' and ${tasks.dueDate} < ${today})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(and(...baseConditions)),

    checklistCountQuery(churchId, options),
  ]);

  return {
    ...(statusResult[0] ?? {
      notStarted: 0,
      inProgress: 0,
      blocked: 0,
      complete: 0,
      overdue: 0,
      total: 0,
    }),
    ...(checklistResult[0] ?? { checklistComplete: 0, checklistTotal: 0 }),
  };
}

// ============================================================================
// Subtasks (T-016)
// ============================================================================
//
// Three rules define subtasks, and all three are enforced here rather than in
// the UI:
//
// 1. NESTING IS ONE LEVEL. `parent_task_id` is a self-FK, so the database
//    would happily accept a chain of any depth. It is refused below, in both
//    directions: a subtask cannot be given children, and a task that already
//    has children cannot be demoted into a subtask. Without the second half
//    the first is trivially bypassed.
//
// 2. SUBTASKS ARE NOT TOP-LEVEL WORK. `listTasks` filters them out (see
//    `includeSubtasks`); they surface only under their parent.
//
// 3. COMPLETING EVERY SUBTASK DOES NOT COMPLETE THE PARENT. There is
//    deliberately no code below that does it — the ruling on #90 is that the
//    planter decides when the parent is done. "All the checklist items are
//    ticked" and "this piece of work is finished" are different claims, and
//    only a person can make the second one. The UI says so out loud; this
//    comment is here so nobody later reads the absence as an oversight and
//    "fixes" it.
// ============================================================================

export const SUBTASK_PARENT_MISSING_ERROR = "Parent task not found";
export const SUBTASK_SELF_ERROR = "A task cannot be its own subtask";
export const SUBTASK_DEPTH_ERROR = "Subtasks cannot have their own subtasks";
export const SUBTASK_HAS_CHILDREN_ERROR =
  "A task with subtasks cannot become a subtask";

/** What the nesting check needs to know about the two tasks involved. */
export interface SubtaskNestingCheck {
  /** The task being parented. `null` when it does not exist yet (create). */
  child: { id: string; hasSubtasks: boolean } | null;
  /** The proposed parent, or `null` when no such task is in scope. */
  parent: { id: string; parentTaskId: string | null } | null;
}

/**
 * Pure: may `child` be filed under `parent`?
 *
 * Returns the reason it may not, or `null` when the parenting is legal.
 */
export function checkSubtaskNesting({
  child,
  parent,
}: SubtaskNestingCheck): string | null {
  if (!parent) return SUBTASK_PARENT_MISSING_ERROR;
  if (child && child.id === parent.id) return SUBTASK_SELF_ERROR;
  if (parent.parentTaskId !== null) return SUBTASK_DEPTH_ERROR;
  if (child?.hasSubtasks) return SUBTASK_HAS_CHILDREN_ERROR;

  return null;
}

/**
 * Pure: who owns a new subtask?
 *
 * A checklist item with no owner is invisible — it never reaches "My tasks",
 * never counts in an assignee filter, and nobody is accountable for it. So a
 * subtask starts on the parent's assignee (ruling on #370). This is a default,
 * not a lock: an explicit assignee on the form wins, and the subtask can be
 * reassigned afterwards like any other task.
 */
export function resolveSubtaskAssignee(
  requestedAssigneeId: string | null | undefined,
  parentAssignedToId: string | null
): string | null {
  return requestedAssigneeId || parentAssignedToId || null;
}

/**
 * Load the two rows `checkSubtaskNesting` needs and throw if the parenting is
 * illegal. Church-scoped, so a parent id from another tenant reads as missing.
 *
 * Returns the parent row, because the caller also needs its assignee.
 */
async function assertSubtaskNesting(
  churchId: string,
  parentTaskId: string,
  childId?: string
): Promise<{
  id: string;
  parentTaskId: string | null;
  assignedToId: string | null;
}> {
  const [parentRow] = await db
    .select({
      id: tasks.id,
      parentTaskId: tasks.parentTaskId,
      assignedToId: tasks.assignedToId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, parentTaskId),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);

  let child: SubtaskNestingCheck["child"] = null;
  if (childId) {
    const [existingChild] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          eq(tasks.parentTaskId, childId),
          isNull(tasks.deletedAt)
        )
      );

    child = { id: childId, hasSubtasks: (existingChild?.count ?? 0) > 0 };
  }

  const reason = checkSubtaskNesting({ child, parent: parentRow ?? null });
  if (reason) throw new Error(reason);

  // `checkSubtaskNesting` returns the missing-parent reason when `parentRow` is
  // undefined, so reaching here means it is present.
  return parentRow!;
}

/**
 * Every live subtask of a task, oldest first — checklist order, not due-date
 * order, because a checklist is read top to bottom.
 *
 * Completed subtasks are included: the parent's progress is completed-of-TOTAL,
 * so hiding the done ones would make the denominator shrink as work finishes.
 */
export async function listSubtasks(
  churchId: string,
  parentTaskId: string
): Promise<TaskListRow[]> {
  const result = await db
    .select(taskWithAssigneeColumns)
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.parentTaskId, parentTaskId),
        isNull(tasks.deletedAt)
      )
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id));

  // A checklist is a list surface too — same rule as `listTasks`.
  const blockedIds = await blockedTaskIdsAmong(
    churchId,
    result.map((task) => task.id)
  );
  return withDescriptionPreviews(result).map((task) => ({
    ...task,
    isBlocked: blockedIds.has(task.id),
  }));
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * The recurrence half of a create or update.
 *
 * Optional and separate from `TaskCreateInput`/`TaskUpdateInput` on purpose:
 * `undefined` means "this caller said nothing about recurrence", which must
 * leave an existing schedule alone rather than clearing it. Quick-add and the
 * meeting follow-up generator both fall into that case.
 */
export type TaskRecurrencePatch = Partial<TaskRecurrenceInput>;

/**
 * Fold a recurrence patch into the values of a write.
 *
 * Both columns move together or neither does — `is_recurring: true` with a
 * null rule is a task that claims to repeat and cannot say how, which would
 * silently end the chain at the next completion.
 */
function applyRecurrence<T extends Partial<NewTask>>(
  values: T,
  patch: TaskRecurrencePatch | undefined
): T {
  if (!patch || patch.isRecurring === undefined) return values;

  const isRecurring = patch.isRecurring && patch.recurrenceRule != null;

  return {
    ...values,
    isRecurring,
    recurrenceRule: isRecurring ? patch.recurrenceRule : null,
  };
}

/**
 * Create a new task.
 */
export async function createTask(
  churchId: string,
  userId: string,
  data: TaskCreateInput,
  recurrence?: TaskRecurrencePatch
): Promise<Task> {
  const parentTaskId = data.parentTaskId || null;

  // One level only, and the parent has to be ours. Checked before the insert
  // so an illegal parent is a refusal, not an orphan row (T-016).
  const parent = parentTaskId
    ? await assertSubtaskNesting(churchId, parentTaskId)
    : null;

  const assignedToId = parent
    ? resolveSubtaskAssignee(data.assignedToId, parent.assignedToId)
    : data.assignedToId || null;

  // #470 D2 — only a committed member owns a follow-up. Checked on the RESOLVED
  // assignee, so a subtask inheriting its parent's owner is checked too, and
  // before the insert, so a refusal is a refusal rather than a row to undo.
  await assertMayOwnFollowUp(churchId, data.category, assignedToId);

  const values: NewTask = applyRecurrence(
    {
      churchId,
      createdById: userId,
      title: data.title,
      // Sanitised HERE, not in the form (T-021). The action that calls this is
      // a POSTable endpoint the editor never touched, and the meeting follow-up
      // generator calls it with plain text — one door covers both.
      description: normalizeTaskDescription(data.description),
      status: data.status,
      priority: data.priority,
      dueDate: data.dueDate ?? null,
      dueTime: data.dueTime ?? null,
      assignedToId,
      category: data.category ?? null,
      relatedType: data.relatedType ?? null,
      relatedId: data.relatedId || null,
      parentTaskId,
    } satisfies NewTask,
    recurrence
  );

  const [task] = await db.insert(tasks).values(values).returning();

  // The row exists before anything is announced about it (T-018). A task with
  // no assignee or no due date enqueues nothing — the plan says so, not this
  // call site. `mustCancel: false` because a row a moment old can have nothing
  // pending, so the cancel half is skipped.
  await syncTaskNotifications(task, { mustCancel: false });

  return task;
}

/**
 * Update an existing task.
 * Throws error if task not found or soft-deleted.
 */
export async function updateTask(
  churchId: string,
  taskId: string,
  data: TaskUpdateInput,
  recurrence?: TaskRecurrencePatch
): Promise<Task> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  // Re-parenting is the other way a second level of nesting could appear, so
  // it runs the same check as create — plus the "already has subtasks" arm,
  // which only an update can trip.
  if (data.parentTaskId) {
    await assertSubtaskNesting(churchId, data.parentTaskId, taskId);
  }

  // The follow-up owner guard runs on the RESULTING task, not on the patch
  // (#470 D2). Both halves can arrive alone: assigning an ineligible member to
  // a follow-up, and re-categorising an already-assigned task INTO follow-up,
  // are the same violation and an undefined field means "keep what is stored".
  await assertMayOwnFollowUp(
    churchId,
    data.category !== undefined ? data.category : existing.category,
    data.assignedToId !== undefined ? data.assignedToId : existing.assignedToId
  );

  // Editing the schedule of an instance that is already mid-chain must not
  // orphan it from its series: a rule posted by the form carries no
  // `seriesId`, so the stored one is carried across. (A head instance has
  // none, and `seriesIdOf` reads that as "my own id" — still correct.)
  const carriedSeriesId = parseRecurrenceRule(
    existing.recurrenceRule
  )?.seriesId;
  const recurrencePatch: TaskRecurrencePatch | undefined =
    recurrence?.recurrenceRule
      ? {
          ...recurrence,
          recurrenceRule: {
            ...recurrence.recurrenceRule,
            seriesId: recurrence.recurrenceRule.seriesId ?? carriedSeriesId,
          },
        }
      : recurrence;

  const updateData: Partial<NewTask> & { updatedAt: Date } = applyRecurrence(
    { updatedAt: new Date() },
    recurrencePatch
  );

  if (data.title !== undefined) updateData.title = data.title;
  // Same gate as create — an edit is the second write path, and it is reachable
  // with no session and no UI just like the first (T-021).
  if (data.description !== undefined)
    updateData.description = normalizeTaskDescription(data.description);
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

  // An edit may have moved the due date, changed the assignee, or closed the
  // task. All three are the same operation to F11: cancel what is pending for
  // this task and re-enqueue what it now owes (N-011). `existing` was already
  // read above, so an edit that touched none of those leaves the live rows
  // alone instead of replacing them with identical ones.
  await syncTaskNotifications(updated, {
    mustCancel: taskNotificationsDiffer(existing, updated),
  });

  return updated;
}

/** What a completion produced: the finished task, and its successor if any. */
export interface TaskCompletionResult {
  task: Task;
  /**
   * The next instance of a recurring series, when this completion minted one.
   * `null` for a one-off task, and for a series that has reached its end date.
   */
  nextInstance: Task | null;
}

/** What the successor's checklist needs to know about each original item. */
export type RecurrenceChild = Pick<
  Task,
  | "title"
  | "description"
  | "priority"
  | "dueTime"
  | "assignedToId"
  | "category"
  | "relatedType"
  | "relatedId"
>;

/**
 * Pure: the checklist the successor starts life with (ruling on #370).
 *
 * The checklist is part of the task's template, not a record of one cycle, so
 * EVERY item comes across — the ticked ones and the ones nobody got to alike —
 * and all of them arrive unticked. That is deliberately one rule rather than
 * two: carrying open items forward as open and ticked items forward as fresh
 * would need a per-item "was this ever done" state, and would make a weekly
 * list that was half-finished once behave differently from an identical list
 * that was finished. A repeating task repeats whole.
 */
export function planRecurrenceChildren(
  children: RecurrenceChild[],
  successor: Pick<Task, "id" | "churchId" | "createdById">,
  createdAtBase: Date
): NewTask[] {
  return children.map((child, index) => ({
    churchId: successor.churchId,
    createdById: successor.createdById,
    title: child.title,
    description: child.description,
    // Every box unticked, whatever it was on the instance just completed.
    status: "not_started",
    completedAt: null,
    completedById: null,
    priority: child.priority,
    // The item's own due date is NOT carried: it belonged to the cycle that
    // just closed, and re-dating it would either invent a date or hand the new
    // checklist a set of already-overdue items. The parent carries the schedule.
    dueDate: null,
    dueTime: child.dueTime,
    assignedToId: child.assignedToId,
    category: child.category,
    relatedType: child.relatedType,
    relatedId: child.relatedId,
    parentTaskId: successor.id,
    // A checklist item never repeats on its own — the parent is the series.
    isRecurring: false,
    recurrenceRule: null,
    // `created_at` IS the checklist order (`listSubtasks` sorts by it), and one
    // multi-row INSERT stamps every default with the same transaction
    // timestamp, which would leave the order to a random-UUID tiebreak. A
    // millisecond per item keeps the list in the order it was written.
    createdAt: new Date(createdAtBase.getTime() + index),
  }));
}

/**
 * The database surface `createNextRecurrence` needs. Injectable so the
 * successor's shape — and its checklist — can be unit-tested without a DB.
 */
export interface RecurrenceDeps {
  /** Ids of open instances already in this series. */
  findOpenInSeries(churchId: string, seriesId: string): Promise<string[]>;
  insertSuccessor(values: NewTask): Promise<Task | null>;
  /** The completed instance's checklist, in checklist order. */
  listChildren(
    churchId: string,
    parentTaskId: string
  ): Promise<RecurrenceChild[]>;
  insertChildren(values: NewTask[]): Promise<void>;
}

export const defaultRecurrenceDeps: RecurrenceDeps = {
  async findOpenInSeries(churchId, seriesId) {
    const open = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          ne(tasks.status, "complete"),
          isNull(tasks.deletedAt),
          eq(tasks.isRecurring, true),
          sql`${tasks.recurrenceRule} ->> 'seriesId' = ${seriesId}`
        )
      )
      .limit(1);

    return open.map((row) => row.id);
  },

  async insertSuccessor(values) {
    const [next] = await db.insert(tasks).values(values).returning();
    return next ?? null;
  },

  async listChildren(churchId, parentTaskId) {
    return db
      .select({
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        dueTime: tasks.dueTime,
        assignedToId: tasks.assignedToId,
        category: tasks.category,
        relatedType: tasks.relatedType,
        relatedId: tasks.relatedId,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          eq(tasks.parentTaskId, parentTaskId),
          isNull(tasks.deletedAt)
        )
      )
      .orderBy(asc(tasks.createdAt), asc(tasks.id));
  },

  async insertChildren(values) {
    if (values.length === 0) return;
    await db.insert(tasks).values(values);
  },
};

/**
 * Mint the next instance of a recurring series (T-017).
 *
 * Called only after a completion has actually landed, so it is downstream of a
 * won compare-and-set — two concurrent completes cannot both get here for the
 * same task, and therefore cannot both insert.
 *
 * Returns `null` when nothing should be created: the task is not recurring,
 * its rule is unreadable, the series has passed its end date, or an instance
 * of the same series is somehow already open.
 *
 * COPIED to the successor: the task's own fields, and its whole checklist —
 * unticked (see `planRecurrenceChildren`).
 *
 * NOT copied to the successor: `completionEvent`. An auto-completion hook is
 * installed by whatever generated the task (a meeting finalize, say), and one
 * of them — `meeting.evaluation.completed` — is backed by a partial unique
 * index on (church_id, related_id). Copying it would abort the insert on the
 * second instance. Recurrence mints plain work; hooks stay with the generator.
 */
export async function createNextRecurrence(
  completed: Task,
  completedOn: string,
  deps: RecurrenceDeps = defaultRecurrenceDeps
): Promise<Task | null> {
  if (!completed.isRecurring) return null;

  const rule = parseRecurrenceRule(completed.recurrenceRule);
  if (!rule) return null;

  const nextDueDate = nextRecurrenceDueDate(
    rule,
    completed.dueDate,
    completedOn
  );
  // Past the end date: the series stops here. Every completed instance stays
  // in place — ending recurrence is not deleting history.
  if (!nextDueDate) return null;

  const seriesId = seriesIdOf(completed);

  // ONE open instance at a time. The chain shape already guarantees this (an
  // instance is minted only by completing its predecessor), so this is the
  // belt to that braces: it catches a series that was resurrected by reopening
  // and re-completing an older instance.
  const open = await deps.findOpenInSeries(completed.churchId, seriesId);
  if (open.length > 0) return null;

  const next = await deps.insertSuccessor({
    churchId: completed.churchId,
    title: completed.title,
    description: completed.description,
    status: "not_started",
    // Carried forward so the next occurrence is the same piece of work:
    // whoever owns it, how urgent it is, what it is about, and what it hangs
    // off. Only the schedule moves.
    priority: completed.priority,
    dueDate: nextDueDate,
    dueTime: completed.dueTime,
    assignedToId: completed.assignedToId,
    category: completed.category,
    relatedType: completed.relatedType,
    relatedId: completed.relatedId,
    parentTaskId: completed.parentTaskId,
    isRecurring: true,
    recurrenceRule: { ...rule, seriesId },
    createdById: completed.createdById,
  });

  if (!next) return null;

  // The checklist comes across with the task (ruling on #370). Failing here
  // must not report the successor as missing — it exists, and a checklist that
  // has to be retyped is a smaller loss than a completion that looks like it
  // did not happen.
  try {
    const children = await deps.listChildren(completed.churchId, completed.id);
    if (children.length > 0) {
      await deps.insertChildren(
        planRecurrenceChildren(children, next, new Date())
      );
    }
  } catch (error) {
    console.error(
      `createNextRecurrence copied no checklist onto ${next.id}:`,
      error
    );
  }

  // The successor is ordinary work with its own due date, so it gets its own
  // due/overdue rows (T-018). Done here rather than at the two call sites —
  // `completeTask` and the bulk complete both mint successors through this
  // function, and a successor announced from only one of them is a gap that
  // depends on which button the planter pressed.
  await syncTaskNotifications(next, { mustCancel: false });

  return next;
}

/**
 * Mark a task as complete with timestamp and user.
 *
 * Emits `task.completed`, and — for a recurring task — mints the next instance
 * of the series.
 *
 * ## Ordering
 *
 * The completion is written FIRST and the successor second, which is the
 * opposite of the usual "durable marker last" rule and is deliberate. The two
 * failure modes are not symmetric: a successor with no completion would leave
 * TWO open instances of the same series, breaking the one-at-a-time guarantee
 * a planter relies on; a completion with no successor leaves a gap that
 * reopening and re-completing the task repairs. We take the recoverable one.
 */

// ----------------------------------------------------------------------------
// The OWN-DUTY half of `tasks.own` (AS-006)
// ----------------------------------------------------------------------------

/**
 * May this account act on THIS task?
 *
 * The seat guard on the action decides half of it — `tasks.own` requires a seat
 * in the plant, which refuses a coach and an oversight account. This is the
 * other half, and it needs the argument, so it cannot be asked before the parse:
 * a Member may complete, reopen or restatus a task ASSIGNED TO THEM, and an
 * Admin or Owner may do it to anybody's (`tasks.write`).
 *
 * IT IS ASKED IN THE SERVICE, after the row is loaded, so it holds for every
 * caller rather than for the six actions somebody remembered. `/launch`'s
 * milestone ticks reach `completeTask` and `reopenTask` too.
 *
 * `assignedToId` REFERENCES `users.id`, which is what makes this rule writable
 * at all — the sibling own-duty verbs (`teams.own`, `meetings.rsvp`) name a
 * PERSON and have no link back to an account until AS-013 lands, so their
 * subject half is still an accepted residual.
 */
export function mayActOnTask(
  actor: User,
  task: Pick<Task, "assignedToId">
): boolean {
  // The rule itself is in `./own-duty`, which `TaskCard` calls too (#660).
  // This half only supplies the seat answer.
  return mayActOnTaskRow({
    canWrite: holdsSeatFor(actor, "tasks.write"),
    assignedToId: task.assignedToId,
    viewerId: actor.id,
  });
}

/**
 * {@link mayActOnTask}, refused loudly.
 *
 * The single-task paths want the throw — there is one subject and one answer.
 * The BULK path wants the predicate instead: a press over a mixed selection
 * turns each refused row into a named failure beside "Task is already complete"
 * rather than losing the whole batch to the first task somebody else owns.
 */
export function assertMayActOnTask(
  actor: User,
  task: Pick<Task, "assignedToId">
): void {
  if (!mayActOnTask(actor, task)) throw new SeatRefusalError("tasks.own");
}

export function completeTaskStatement(input: {
  churchId: string;
  taskId: string;
  actorUserId: string;
  completedAt: Date;
  expectedTitle?: string;
  expectedStatus?: TaskStatus;
  expectedAssignedToId?: string | null;
  expectedIsRecurring?: boolean;
  expectedDescription?: string | null;
  expectedPriority?: TaskPriority;
  expectedDueDate?: string | null;
  expectedDueTime?: string | null;
  expectedCategory?: TaskCategory | null;
  expectedRelatedType?: string | null;
  expectedRelatedId?: string | null;
  expectedParentTaskId?: string | null;
  expectedRecurrenceRule?: unknown;
  expectedCompletionEvent?: string | null;
  expectedCreatedById?: string;
  expectedUpdatedAt?: Date;
  launchMilestoneId?: string;
  /** Trusted outer write gate used by the Evry exact-effect transaction. */
  writeEligibility?: SQL;
}): SQL {
  return sql`
    update tasks t
    set status = 'complete', completed_at = ${input.completedAt},
        completed_by_id = ${input.actorUserId}::uuid,
        updated_at = ${input.completedAt}
    where t.church_id = ${input.churchId}::uuid
      and t.id = ${input.taskId}::uuid
      and t.deleted_at is null
      and t.status <> 'complete'
      ${input.expectedTitle ? sql`and t.title = ${input.expectedTitle}` : sql``}
      ${
        input.expectedDescription === undefined
          ? sql``
          : sql`and t.description is not distinct from ${input.expectedDescription}`
      }
      ${
        input.expectedPriority
          ? sql`and t.priority = ${input.expectedPriority}`
          : sql``
      }
      ${input.expectedStatus ? sql`and t.status = ${input.expectedStatus}` : sql``}
      ${
        input.expectedAssignedToId === undefined
          ? sql``
          : input.expectedAssignedToId === null
            ? sql`and t.assigned_to_id is null`
            : sql`and t.assigned_to_id = ${input.expectedAssignedToId}::uuid`
      }
      ${
        input.expectedIsRecurring === undefined
          ? sql``
          : sql`and t.is_recurring = ${input.expectedIsRecurring}`
      }
      ${
        input.expectedDueDate === undefined
          ? sql``
          : sql`and t.due_date is not distinct from ${input.expectedDueDate}::date`
      }
      ${
        input.expectedDueTime === undefined
          ? sql``
          : sql`and t.due_time is not distinct from ${input.expectedDueTime}::time`
      }
      ${
        input.expectedCategory === undefined
          ? sql``
          : sql`and t.category is not distinct from ${input.expectedCategory}::varchar`
      }
      ${
        input.expectedRelatedType === undefined
          ? sql``
          : sql`and t.related_type is not distinct from ${input.expectedRelatedType}::varchar`
      }
      ${
        input.expectedRelatedId === undefined
          ? sql``
          : input.expectedRelatedId === null
            ? sql`and t.related_id is null`
            : sql`and t.related_id = ${input.expectedRelatedId}::uuid`
      }
      ${
        input.expectedParentTaskId === undefined
          ? sql``
          : input.expectedParentTaskId === null
            ? sql`and t.parent_task_id is null`
            : sql`and t.parent_task_id = ${input.expectedParentTaskId}::uuid`
      }
      ${
        input.expectedRecurrenceRule === undefined
          ? sql``
          : input.expectedRecurrenceRule === null
            ? sql`and t.recurrence_rule is null`
            : sql`and t.recurrence_rule is not distinct from ${JSON.stringify(input.expectedRecurrenceRule)}::jsonb`
      }
      ${
        input.expectedCreatedById
          ? sql`and t.created_by_id = ${input.expectedCreatedById}::uuid`
          : sql``
      }
      ${
        input.expectedCompletionEvent === undefined
          ? sql``
          : sql`and t.completion_event is not distinct from ${input.expectedCompletionEvent}`
      }
      and ${input.writeEligibility ?? sql`true`}
      ${
        input.expectedUpdatedAt
          ? sql`and date_trunc('milliseconds', t.updated_at at time zone 'UTC') = ${input.expectedUpdatedAt}`
          : sql``
      }
      ${
        input.launchMilestoneId
          ? sql`and exists (
              select 1 from launch_milestone_tasks lmt
              where lmt.task_id = t.id
                and lmt.church_id = t.church_id
                and lmt.milestone_id = ${input.launchMilestoneId}::uuid
            )`
          : sql``
      }
    returning t.id, 1::int affected_count, 0::int excluded_count
  `;
}

export function reopenTaskStatement(input: {
  churchId: string;
  taskId: string;
  expectedTitle?: string;
  expectedStatus?: TaskStatus;
  expectedAssignedToId?: string | null;
  expectedIsRecurring?: boolean;
  expectedDescription?: string | null;
  expectedPriority?: TaskPriority;
  expectedDueDate?: string | null;
  expectedDueTime?: string | null;
  expectedCategory?: TaskCategory | null;
  expectedRelatedType?: string | null;
  expectedRelatedId?: string | null;
  expectedParentTaskId?: string | null;
  expectedRecurrenceRule?: unknown;
  expectedCompletionEvent?: string | null;
  expectedCreatedById?: string;
  expectedUpdatedAt?: Date;
  launchMilestoneId?: string;
  /** Trusted outer write gate used by the Evry exact-effect transaction. */
  writeEligibility?: SQL;
}): SQL {
  return sql`
    update tasks t
    set status = 'not_started', completed_at = null,
        completed_by_id = null, updated_at = transaction_timestamp()
    where t.church_id = ${input.churchId}::uuid
      and t.id = ${input.taskId}::uuid
      and t.deleted_at is null
      and t.status = 'complete'
      ${input.expectedTitle ? sql`and t.title = ${input.expectedTitle}` : sql``}
      ${
        input.expectedDescription === undefined
          ? sql``
          : sql`and t.description is not distinct from ${input.expectedDescription}`
      }
      ${
        input.expectedPriority
          ? sql`and t.priority = ${input.expectedPriority}`
          : sql``
      }
      ${input.expectedStatus ? sql`and t.status = ${input.expectedStatus}` : sql``}
      ${
        input.expectedAssignedToId === undefined
          ? sql``
          : input.expectedAssignedToId === null
            ? sql`and t.assigned_to_id is null`
            : sql`and t.assigned_to_id = ${input.expectedAssignedToId}::uuid`
      }
      ${
        input.expectedIsRecurring === undefined
          ? sql``
          : sql`and t.is_recurring = ${input.expectedIsRecurring}`
      }
      ${
        input.expectedDueDate === undefined
          ? sql``
          : sql`and t.due_date is not distinct from ${input.expectedDueDate}::date`
      }
      ${
        input.expectedDueTime === undefined
          ? sql``
          : sql`and t.due_time is not distinct from ${input.expectedDueTime}::time`
      }
      ${
        input.expectedCategory === undefined
          ? sql``
          : sql`and t.category is not distinct from ${input.expectedCategory}::varchar`
      }
      ${
        input.expectedRelatedType === undefined
          ? sql``
          : sql`and t.related_type is not distinct from ${input.expectedRelatedType}::varchar`
      }
      ${
        input.expectedRelatedId === undefined
          ? sql``
          : input.expectedRelatedId === null
            ? sql`and t.related_id is null`
            : sql`and t.related_id = ${input.expectedRelatedId}::uuid`
      }
      ${
        input.expectedParentTaskId === undefined
          ? sql``
          : input.expectedParentTaskId === null
            ? sql`and t.parent_task_id is null`
            : sql`and t.parent_task_id = ${input.expectedParentTaskId}::uuid`
      }
      ${
        input.expectedRecurrenceRule === undefined
          ? sql``
          : input.expectedRecurrenceRule === null
            ? sql`and t.recurrence_rule is null`
            : sql`and t.recurrence_rule is not distinct from ${JSON.stringify(input.expectedRecurrenceRule)}::jsonb`
      }
      ${
        input.expectedCreatedById
          ? sql`and t.created_by_id = ${input.expectedCreatedById}::uuid`
          : sql``
      }
      ${
        input.expectedCompletionEvent === undefined
          ? sql``
          : sql`and t.completion_event is not distinct from ${input.expectedCompletionEvent}`
      }
      and ${input.writeEligibility ?? sql`true`}
      ${
        input.expectedUpdatedAt
          ? sql`and date_trunc('milliseconds', t.updated_at at time zone 'UTC') = ${input.expectedUpdatedAt}`
          : sql``
      }
      ${
        input.launchMilestoneId
          ? sql`and exists (
              select 1 from launch_milestone_tasks lmt
              where lmt.task_id = t.id
                and lmt.church_id = t.church_id
                and lmt.milestone_id = ${input.launchMilestoneId}::uuid
            )`
          : sql``
      }
    returning t.id, 1::int affected_count, 0::int excluded_count
  `;
}

/**
 * Finish the owner-side work owed by a durable task completion.
 *
 * This is deliberately replay-safe: notification cancellation and completion
 * event consumers converge on the task identity, while recurring successors
 * are guarded by the series' single-open-instance invariant. Evry can therefore
 * retry this after its task row and execution outcome committed together.
 */
async function reconcileTaskCompletionEffects(
  completed: Pick<
    Task,
    "id" | "churchId" | "category" | "relatedType" | "relatedId"
  >,
  completedById: string,
  completedAt?: Date,
  occurrenceKey?: string
): Promise<void> {
  await emitTaskCompleted(
    completed.id,
    completed.churchId,
    completed.category,
    completed.relatedType,
    completed.relatedId,
    completedById,
    completedAt,
    occurrenceKey
  );
  // Reconcile from the live projection, not from the historical completion.
  // A crash retry after a later reopen must restore the reopened task's rows,
  // never cancel them using stale completion facts.
  await syncTaskNotificationsFor(completed.churchId, [completed.id], {
    mustCancel: true,
    now: completedAt,
    failureMode: occurrenceKey ? "required" : "best_effort",
  });
}

/** Exact completion effects for a reviewed task that cannot recur. */
export async function reconcileNonRecurringCompletedTaskAfterWrite(
  completed: Pick<
    Task,
    "id" | "churchId" | "category" | "relatedType" | "relatedId" | "isRecurring"
  >,
  completedById: string,
  completedAt?: Date
): Promise<void> {
  if (completed.isRecurring) {
    throw new Error("Recurring task completion needs a successor-aware plan");
  }
  await reconcileTaskCompletionEffects(completed, completedById, completedAt);
}

export type ReviewedRecurringTaskRow = Pick<
  Task,
  | "id"
  | "churchId"
  | "title"
  | "description"
  | "status"
  | "priority"
  | "dueDate"
  | "dueTime"
  | "assignedToId"
  | "category"
  | "relatedType"
  | "relatedId"
  | "parentTaskId"
  | "isRecurring"
  | "recurrenceRule"
  | "createdById"
  | "createdAt"
>;

export type ReviewedTaskRecurrencePlan = Readonly<{
  successor: ReviewedRecurringTaskRow;
  children: readonly ReviewedRecurringTaskRow[];
}>;

function sameReviewedRecurringTask(
  current: ReviewedRecurringTaskRow,
  reviewed: ReviewedRecurringTaskRow
): boolean {
  return (
    current.id === reviewed.id &&
    current.churchId === reviewed.churchId &&
    current.title === reviewed.title &&
    current.description === reviewed.description &&
    current.status === reviewed.status &&
    current.priority === reviewed.priority &&
    current.dueDate === reviewed.dueDate &&
    current.dueTime === reviewed.dueTime &&
    current.assignedToId === reviewed.assignedToId &&
    current.category === reviewed.category &&
    current.relatedType === reviewed.relatedType &&
    current.relatedId === reviewed.relatedId &&
    current.parentTaskId === reviewed.parentTaskId &&
    current.isRecurring === reviewed.isRecurring &&
    JSON.stringify(current.recurrenceRule) ===
      JSON.stringify(reviewed.recurrenceRule) &&
    current.createdById === reviewed.createdById &&
    current.createdAt.getTime() === reviewed.createdAt.getTime()
  );
}

async function reconcileReviewedRecurrence(
  completed: Task,
  reviewed: ReviewedTaskRecurrencePlan,
  occurrenceKey?: string
): Promise<Task> {
  await db
    .insert(tasks)
    .values(reviewed.successor)
    // The exact same reviewed successor races on both its primary key and the
    // recurrence-series arbiter. PostgreSQL is free to report either unique
    // index first, so targeting only the primary key makes an otherwise
    // identical replay intermittently throw on the series index. Suppress any
    // unique collision, then prove the stored row below is the exact reviewed
    // successor; a different-series winner therefore still fails closed.
    .onConflictDoNothing();

  const [successor] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, reviewed.successor.id),
        eq(tasks.churchId, completed.churchId),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);
  if (!successor || !sameReviewedRecurringTask(successor, reviewed.successor)) {
    throw new Error("Reviewed recurring successor no longer matches");
  }

  if (reviewed.children.length > 0) {
    await db
      .insert(tasks)
      .values([...reviewed.children])
      .onConflictDoNothing({ target: tasks.id });
    const storedChildren = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, completed.churchId),
          inArray(
            tasks.id,
            reviewed.children.map(({ id }) => id)
          ),
          isNull(tasks.deletedAt)
        )
      );
    const byId = new Map(storedChildren.map((row) => [row.id, row]));
    if (
      reviewed.children.some((child) => {
        const stored = byId.get(child.id);
        return !stored || !sameReviewedRecurringTask(stored, child);
      })
    ) {
      throw new Error("Reviewed recurring checklist no longer matches");
    }
  }

  await syncTaskNotifications(successor, {
    mustCancel: false,
    failureMode: occurrenceKey ? "required" : "best_effort",
  });
  return successor;
}

export async function reconcileCompletedTaskAfterWrite(
  completed: Task,
  completedById: string,
  reviewedRecurrence?: ReviewedTaskRecurrencePlan | null,
  reviewedCompletedAt?: Date,
  occurrenceKey?: string
): Promise<Task | null> {
  await reconcileTaskCompletionEffects(
    completed,
    completedById,
    reviewedCompletedAt,
    occurrenceKey
  );

  if (reviewedRecurrence !== undefined) {
    if (!completed.isRecurring) {
      if (reviewedRecurrence !== null) {
        throw new Error("A non-recurring task cannot have a successor plan");
      }
      return null;
    }
    return reviewedRecurrence
      ? reconcileReviewedRecurrence(
          completed,
          reviewedRecurrence,
          occurrenceKey
        )
      : null;
  }

  try {
    return await createNextRecurrence(
      completed,
      toCalendarDate(completed.completedAt ?? new Date())
    );
  } catch (error) {
    // The completion is already durable. A missing successor is repaired by
    // replaying this reconciliation (or by reopening and completing again).
    console.error(
      `completeTask failed to create the next recurrence of ${completed.id}:`,
      error
    );
    return null;
  }
}

/** Re-enqueue the notifications owed by a durable reopen; safe on replay. */
export async function reconcileReopenedTaskAfterWrite(
  reopened: TaskNotificationFacts,
  mustCancel: boolean
): Promise<void> {
  await syncTaskNotifications(reopened, { mustCancel });
}

export async function completeTask(
  churchId: string,
  taskId: string,
  actor: User
): Promise<TaskCompletionResult> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  assertMayActOnTask(actor, existing);

  if (existing.status === "complete") {
    throw new Error("Task is already complete");
  }

  const completedAt = new Date();

  // `ne(status, 'complete')` makes this a compare-and-set rather than a blind
  // write: the read above is a snapshot and two concurrent callers both pass
  // it, but only one gets a row back here. Everything downstream — the event,
  // and the next recurrence instance — happens exactly once because it hangs
  // off this rowcount.
  const [completed] = await db
    .update(tasks)
    .set({
      status: "complete",
      completedAt,
      completedById: actor.id,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt),
        ne(tasks.status, "complete")
      )
    )
    .returning();

  if (!completed) {
    // The CAS lost: somebody else completed it between the read and the write.
    throw new Error("Task is already complete");
  }

  const nextInstance = await reconcileCompletedTaskAfterWrite(
    completed,
    actor.id
  );

  return { task: completed, nextInstance };
}

/**
 * Reopen a completed task (set status back to not_started).
 */
export async function reopenTask(
  churchId: string,
  taskId: string,
  actor: User
): Promise<Task> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  assertMayActOnTask(actor, existing);

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

  // Reopen is a re-enqueue, and it works because cancelling RELEASED the dedupe
  // key: the unique index is partial on `status <> 'cancelled'`, so the rows
  // this task's completion cancelled do not block the ones it now owes again.
  await syncTaskNotifications(reopened, {
    mustCancel: taskNotificationsDiffer(existing, reopened),
  });

  return reopened;
}

/**
 * Soft delete a task, and with it any subtasks it owns.
 *
 * The cascade is not a convenience. A subtask is invisible outside its
 * parent's detail view — `listTasks` filters it out of the list on purpose —
 * so deleting the parent alone would leave live rows that nothing renders and
 * nobody can reach: work that still counts in `getTaskCounts` and can never be
 * closed. One statement, so parent and children go together or not at all
 * (there are no interactive transactions here — `invariants/transactions-
 * atomicity.md`).
 *
 * THE SOFT DELETE IS STILL THIS FUNCTION'S JOB (#405 D5). Migration 0038 added
 * `tasks_parent_task_id_tasks_id_fk … ON DELETE CASCADE`, but a cascade fires
 * on a row being REMOVED and nothing here removes one — the statement below
 * stamps `deleted_at`, which Postgres sees as an ordinary UPDATE. The FK covers
 * the paths that delete outright (`planWipe()`'s seed sweep, hand-run repairs)
 * and, more usefully day to day, makes a `parent_task_id` naming no task
 * unrepresentable. Do not read the cascade as licence to drop the `or(...)`
 * clause below.
 */
export async function deleteTask(
  churchId: string,
  taskId: string
): Promise<void> {
  const existing = await getTask(churchId, taskId);
  if (!existing) {
    throw new Error("Task not found");
  }

  const now = new Date();

  const deleted = await db
    .update(tasks)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(tasks.churchId, churchId),
        or(eq(tasks.id, taskId), eq(tasks.parentTaskId, taskId)),
        isNull(tasks.deletedAt)
      )
    )
    .returning({ id: tasks.id });

  // Every row the statement actually touched — the parent AND its checklist
  // items, which are tasks with due dates of their own. The ids come from the
  // write's own `returning()` rather than from a second SELECT, so a subtask
  // added between the read and the write is still covered.
  await cancelTaskNotificationsFor(
    churchId,
    deleted.map((row) => row.id)
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
  /** The own-duty subject (AS-006). `users.id`, or null for an unassigned task. */
  assignedToId: string | null;
}

/**
 * What a Member is told about a task that is not theirs.
 *
 * It names the reason rather than saying "could not be completed": the row IS
 * completable, by somebody else, and a press that reports nothing actionable
 * teaches the planter to press again.
 */
export const NOT_YOUR_TASK_REASON = "That task is assigned to somebody else";

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
  options: {
    rejectCompleted?: boolean;
    completedReason?: string;
    /**
     * When given, a row this actor may not act on becomes a NAMED FAILURE
     * rather than being silently written (AS-006). Eligibility already lives
     * here — "already complete", "not found" — so the own-duty rule is decided
     * in the same pure function rather than in a second loop beside it.
     */
    actor?: User;
  } = {}
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

    if (options.actor && !mayActOnTask(options.actor, row)) {
      failures.push({
        taskId: id,
        title: row.title,
        reason: NOT_YOUR_TASK_REASON,
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
  /**
   * Mint the successor of every recurring task among `taskIds` (T-017).
   *
   * Optional so a test can drive the bulk write without one — the interesting
   * behaviour there is partial failure and event fan-out, not recurrence.
   */
  mintRecurrences?(
    churchId: string,
    taskIds: string[],
    completedOn: string
  ): Promise<void>;
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
        assignedToId: tasks.assignedToId,
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

  async mintRecurrences(churchId, taskIds, completedOn) {
    if (taskIds.length === 0) return;

    // Reloaded rather than carried through the plan: the successor is a copy
    // of the whole task, and `BulkTaskCandidate` is deliberately the minimum
    // the write needs.
    const recurring = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          inArray(tasks.id, taskIds),
          eq(tasks.isRecurring, true),
          isNull(tasks.deletedAt)
        )
      );

    // Sequentially, for the same reason the events are: a 100-task bulk must
    // not fan 100 concurrent insert chains at the database.
    for (const task of recurring) {
      await createNextRecurrence(task, completedOn);
    }
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
  actor: User,
  deps: BulkTaskDeps = defaultBulkTaskDeps
): Promise<BulkTaskResult> {
  const requested = [...new Set(taskIds)];
  if (requested.length === 0) return emptyBulkResult();
  assertBulkSize(requested);

  const found = await deps.loadCandidates(churchId, requested);
  // PER TASK, not once for the press: a Member ticking eight rows may own three
  // of them, and the other five come back named rather than taking the batch
  // down or being written anyway (AS-006).
  const plan = planBulkTaskOperation(requested, found, {
    rejectCompleted: true,
    actor,
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
        actor.id
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

  // Completed is completed however it was pressed: the same cancel-by-entity
  // `completeTask` does, for every row the bulk write actually touched.
  if (written.length > 0) {
    await cancelTaskNotificationsFor(
      churchId,
      written.map((row) => row.id)
    );
  }

  // A bulk complete has to advance recurring chains too, or a planter who
  // clears their week with one click quietly loses every repeat.
  if (written.length > 0 && deps.mintRecurrences) {
    try {
      await deps.mintRecurrences(
        churchId,
        written.map((row) => row.id),
        toCalendarDate(new Date())
      );
    } catch (error) {
      // Same trade as `completeTask`: the completions landed and stand.
      console.error("bulkCompleteTasks failed to mint recurrences:", error);
    }
  }

  // One event per completed task, emitted one at a time (see header note).
  for (const task of written) {
    try {
      await deps.emitCompleted(task, actor.id);
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

  // A new due date is a reschedule, and a reschedule is cancel + re-enqueue
  // (N-011). Skipping it would leave every one of these tasks with a pending
  // reminder aimed at the date they no longer have.
  if (writtenIds.length > 0) {
    await syncTaskNotificationsFor(churchId, writtenIds, { mustCancel: true });
  }

  return reconcileBulkTaskOperation(plan, writtenIds, missedReason).result;
}
