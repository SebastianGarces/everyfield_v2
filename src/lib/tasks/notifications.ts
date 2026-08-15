import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { tasks, type TaskStatus } from "@/db/schema";
import { MS_PER_DAY, formatDayLong } from "@/lib/datetime";
import type { NotificationCategory } from "@/lib/notifications/categories";
import {
  registerStillLivePredicates,
  type StillLivePredicate,
} from "@/lib/notifications/dispatch";
import {
  cancelByEntity,
  clampNotificationTitle,
  enqueue,
  type EnqueueNotificationInput,
} from "@/lib/notifications/enqueue";
import {
  cancelEntityNotifications,
  runNotificationSync,
  type NotificationSubject,
  type NotificationSyncDeps,
  type NotificationSyncReport,
} from "@/lib/notifications/sync";

// ============================================================================
// T-018 — task due / overdue notifications, on the shared F11 queue.
//
// This module is a CONSUMER of `src/lib/notifications/**`. It composes rows and
// calls `enqueue` / `cancelByEntity`; it never writes the notification tables
// itself, never sends anything, and never reaches for a private queue of its
// own. Four rules come from that contract, and every one of them is a rule this
// file exists to keep:
//
//   1. ONE ROW PER TASK PER CONDITION. Twenty overdue tasks are twenty enqueue
//      calls and twenty pending rows. Batching them into one message is N-012's
//      job, at SEND time, where the dispatcher groups by (church, recipient,
//      category) and makes one email out of the group. A caller that pre-batches
//      collapses twenty feed rows into one and takes that decision away from
//      F11 — and the feed is where a planter finds the task again.
//
//   2. THE SCHEDULE IS THE ROW'S, NOT A CRON'S. A task's due moment is known
//      the moment it is written, so the notification is enqueued THEN with
//      `scheduledFor` set to that instant. No sweep job asks "what is due
//      today?" — the dispatcher's own claim (`scheduled_for <= now`) is that
//      question, already answered once for the whole product.
//
//   3. RESCHEDULE IS CANCEL + RE-ENQUEUE (N-011), never an UPDATE of a pending
//      row. `syncTaskNotifications` therefore always cancels the task's pending
//      rows before enqueuing the new ones, and a create is simply the case
//      where there was nothing to cancel. Cancelling RELEASES the `dedupeKey`
//      (the unique index is partial on `status <> 'cancelled'`), which is what
//      makes the re-enqueue land instead of being swallowed.
//
//   4. A RESOLVED SUBJECT IS NOT ANNOUNCED (N-014). Completing or deleting a
//      task cancels its pending rows by ENTITY REFERENCE, and a still-live
//      predicate is registered for both types as the second line of defence —
//      the cancel cannot reach a row a dispatch run has already claimed, and it
//      cannot run at all for a task completed by a path that forgot to call it.
//      Registration is a CALL, made by `registerNotificationConsumers()` from
//      the dispatch route; see `src/lib/notifications/register-consumers.ts` for
//      why this module must not arm it as a load-time side effect of its own.
//
// WHAT IS THIS MODULE'S, AND WHAT IS THE QUEUE'S. Only the facts shape, the
// planner, the differ, the deps and the predicate are here. The sync skeleton —
// cancel, plan, enqueue, tally, swallow — is `@/lib/notifications/sync`, and the
// 255-char title clamp is `enqueue`'s: both were written per-feature once and
// shipped as byte-identical copies beside `src/lib/meetings/notifications.ts`.
//
// BEST-EFFORT AT THE CALL SITE. Every entrypoint here swallows its own
// failures and returns a report: a notification must never be able to fail, or
// undo, the write that caused it (`memory/invariants.md` → Atomicity). The
// write commits first and the announcement follows, so a task is never
// announced before it exists.
// ============================================================================

/** The F11 category every row here is filed under (N-005). */
export const TASK_NOTIFICATION_CATEGORY: NotificationCategory = "tasks";

/** "This is due." Scheduled for the task's own due instant. */
export const TASK_DUE_TYPE = "task.due";

/** "This is late." A DIFFERENT type, so the two are distinguishable (T-018). */
export const TASK_OVERDUE_TYPE = "task.overdue";

/**
 * Both discriminators, in one tuple.
 *
 * The still-live registration and the tests iterate this rather than repeating
 * the two literals, so a third condition is registered by being added here.
 */
export const TASK_NOTIFICATION_TYPES = [
  TASK_DUE_TYPE,
  TASK_OVERDUE_TYPE,
] as const;

/**
 * How long after the due instant a task is called overdue.
 *
 * A whole day, so "due today" and "overdue" cannot arrive in the same tick for
 * the same task: the overdue row's `scheduledFor` is always a day past the due
 * row's, which is also why a task that is ALREADY late enqueues the overdue
 * row alone (see `planTaskNotifications`).
 */
export const TASK_OVERDUE_AFTER_DAYS = 1;

/**
 * What a task notification is composed from — the columns, and nothing else.
 *
 * A structural shape rather than `Task` so the pure planner can be driven from
 * a literal in a test, and REQUIRED-nullable rather than optional throughout:
 * an optional field would let a caller skip a SELECT and silently take the
 * "no assignee" branch for a task that has one (the same reasoning as
 * `MeetingTitleFacts` — `memory/invariants.md` → Meetings).
 */
export interface TaskNotificationFacts {
  id: string;
  churchId: string;
  title: string;
  status: TaskStatus;
  /** `date` column — a calendar day in `APP_TIME_ZONE`, or null. */
  dueDate: string | null;
  /** `time` column — `HH:MM:SS` on that day, or null for the whole day. */
  dueTime: string | null;
  assignedToId: string | null;
  deletedAt: Date | null;
}

/**
 * The instant a task becomes due, or null when it has no due date.
 *
 * `due_date` is a calendar day and `due_time` an optional clock on it, both
 * read in `APP_TIME_ZONE` (UTC) — so the day a planter typed is the day this
 * measures, whatever zone the server runs in (`memory/invariants.md` → Date &
 * Time Rendering).
 *
 * With no `due_time` the instant is the START of the due day. That is the
 * neutral answer rather than a chosen hour: WHEN a notification is allowed to
 * reach someone is N-018 (quiet hours / send time of day), which is a separate,
 * unbuilt requirement, and inventing "9am" here would be this module quietly
 * ruling on it.
 */
export function taskDueAt(facts: TaskNotificationFacts): Date | null {
  if (!facts.dueDate) return null;

  const at = new Date(`${facts.dueDate}T${facts.dueTime ?? "00:00:00"}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The instant the same task becomes overdue. */
export function taskOverdueAt(dueAt: Date): Date {
  return new Date(dueAt.getTime() + TASK_OVERDUE_AFTER_DAYS * MS_PER_DAY);
}

/**
 * The entity reference and category every row here shares — what a cancel aims
 * at, and what the feed links back to.
 *
 * `entityType`/`entityId` are never optional on a task row: they are how
 * `cancelByEntity` reaches every recipient's copy at once.
 */
function taskSubject(churchId: string, taskId: string): NotificationSubject {
  return {
    churchId,
    entityType: "task",
    entityId: taskId,
    category: TASK_NOTIFICATION_CATEGORY,
    label: "task",
  };
}

/**
 * The dedupe key for one condition on one task.
 *
 * The DUE INSTANT is part of the key, not just the task id. Cancel-by-entity
 * frees a PENDING row's key, but a row that has already been DELIVERED keeps
 * reserving it for ever (by design — that announcement happened). Without the
 * instant, a task whose "due" notice went out on Monday and was then pushed to
 * Friday would have its new due notice swallowed by the delivered one, and the
 * planter would hear nothing on Friday.
 */
export function taskDedupeKey(
  type: string,
  taskId: string,
  dueAt: Date
): string {
  return `${type}:${taskId}:${dueAt.toISOString()}`;
}

/** The due-today notification for one task. */
export function composeTaskDue(
  facts: TaskNotificationFacts,
  dueAt: Date,
  recipientUserId: string
): EnqueueNotificationInput {
  return {
    churchId: facts.churchId,
    recipientUserId,
    category: TASK_NOTIFICATION_CATEGORY,
    type: TASK_DUE_TYPE,
    title: clampNotificationTitle(`Task due: ${facts.title}`),
    body: `"${facts.title}" is due ${formatDayLong(dueAt)}.`,
    // The entity reference is what the feed links to AND what a cancel aims
    // at, so it is never optional on a task row.
    entityType: "task",
    entityId: facts.id,
    dedupeKey: taskDedupeKey(TASK_DUE_TYPE, facts.id, dueAt),
    scheduledFor: dueAt,
  };
}

/** The overdue notification for one task — a distinct `type` from due. */
export function composeTaskOverdue(
  facts: TaskNotificationFacts,
  dueAt: Date,
  recipientUserId: string
): EnqueueNotificationInput {
  return {
    churchId: facts.churchId,
    recipientUserId,
    category: TASK_NOTIFICATION_CATEGORY,
    type: TASK_OVERDUE_TYPE,
    title: clampNotificationTitle(`Task overdue: ${facts.title}`),
    body: `"${facts.title}" was due ${formatDayLong(dueAt)} and is still open.`,
    entityType: "task",
    entityId: facts.id,
    dedupeKey: taskDedupeKey(TASK_OVERDUE_TYPE, facts.id, dueAt),
    scheduledFor: taskOverdueAt(dueAt),
  };
}

/** Why a task got no notifications — a reason, so a caller can log one. */
export type TaskNotificationSkip =
  | "deleted"
  | "already_complete"
  | "unassigned"
  | "no_due_date";

export interface TaskNotificationPlan {
  /** One input per (task, condition). Empty when `skipped` says why. */
  notifications: EnqueueNotificationInput[];
  skipped: TaskNotificationSkip | null;
}

/**
 * What this task owes its assignee right now. Pure.
 *
 * Four refusals, and each one is a row that must NOT exist:
 *
 *  - DELETED / ALREADY COMPLETE — the subject is resolved before anything was
 *    ever announced, so there is nothing to announce. Enqueuing and relying on
 *    the still-live predicate to drop it later would put a row in the feed
 *    (the feed IS the queue row) for work nobody has to do.
 *  - UNASSIGNED — F11 addresses a USER. A task with no assignee has no
 *    recipient, and "tell everyone in the church" is a different, unruled
 *    feature; an unaddressed row cannot be written at all.
 *  - NO DUE DATE — there is no moment for it to be due at.
 *
 * A task that is ALREADY overdue enqueues the OVERDUE row only. Its due moment
 * has been superseded by the very condition that replaces it, and announcing
 * both would put two rows in the feed for one late task.
 */
export function planTaskNotifications(
  facts: TaskNotificationFacts,
  now: Date = new Date()
): TaskNotificationPlan {
  const none = (skipped: TaskNotificationSkip): TaskNotificationPlan => ({
    notifications: [],
    skipped,
  });

  if (facts.deletedAt) return none("deleted");
  if (facts.status === "complete") return none("already_complete");
  if (!facts.assignedToId) return none("unassigned");

  const dueAt = taskDueAt(facts);
  if (!dueAt) return none("no_due_date");

  const assignee = facts.assignedToId;
  const overdueAt = taskOverdueAt(dueAt);

  const notifications =
    overdueAt.getTime() <= now.getTime()
      ? [composeTaskOverdue(facts, dueAt, assignee)]
      : [
          composeTaskDue(facts, dueAt, assignee),
          composeTaskOverdue(facts, dueAt, assignee),
        ];

  return { notifications, skipped: null };
}

/**
 * Would these two versions of a task compose DIFFERENT notifications?
 *
 * The six fields the rows are derived from — the schedule (which decides the
 * dedupe keys and `scheduledFor`), the recipient, and the title the copy
 * quotes. Everything else about a task can change without a pending row
 * becoming wrong.
 *
 * This is what keeps a re-sync from being churn. Cancel + re-enqueue is the
 * right answer to a RESCHEDULE (N-011) and the wrong answer to an edit that
 * changed nothing a notification says: the second one would cancel a live row
 * and write an identical replacement with a new id, once per save.
 */
export function taskNotificationsDiffer(
  previous: TaskNotificationFacts,
  next: TaskNotificationFacts
): boolean {
  return (
    previous.title !== next.title ||
    previous.status !== next.status ||
    previous.dueDate !== next.dueDate ||
    previous.dueTime !== next.dueTime ||
    previous.assignedToId !== next.assignedToId ||
    (previous.deletedAt === null) !== (next.deletedAt === null)
  );
}

/**
 * What a sync did, without throwing.
 *
 * The SHAPE is F11's (`NotificationSyncReport`), because the tally is the
 * queue's and not this feature's; only the `reason` vocabulary is a task's.
 */
export type TaskNotifyReport = NotificationSyncReport<TaskNotificationSkip>;

export interface TaskNotificationDeps extends NotificationSyncDeps {
  /** The still-live re-check's read: what the task looks like NOW. */
  loadTask(
    churchId: string,
    taskId: string
  ): Promise<Pick<TaskNotificationFacts, "status" | "deletedAt"> | null>;
  /** The facts behind a set of task ids, for the bulk paths. */
  loadFacts(
    churchId: string,
    taskIds: readonly string[]
  ): Promise<TaskNotificationFacts[]>;
}

// ----------------------------------------------------------------------------
// Entrypoints
// ----------------------------------------------------------------------------

/**
 * Bring a task's notifications in line with the task as it now is.
 *
 * ONE path for create, edit, reschedule and reopen, because they are the same
 * operation to F11: cancel whatever is pending for this task, then enqueue what
 * the task now owes. N-011 defines reschedule that way, and a create is the
 * case where there was nothing to cancel.
 *
 * `previous` says what the task looked like before the write, and it decides
 * only ONE thing — whether the cancel runs:
 *
 *   * `null` — the row was just created, so nothing can be pending.
 *   * a value — cancel only if the notifications would differ
 *     (`taskNotificationsDiffer`). An edit that touched neither the schedule,
 *     the assignee nor the title leaves the live rows exactly where they are,
 *     and the re-enqueue is absorbed by their dedupe keys.
 *   * OMITTED — the caller did not read the old row. The cancel then runs
 *     unconditionally, which is always safe: at worst an unchanged pair is
 *     replaced by an identical one.
 *
 * Never throws. The task is already written; a failure here costs a
 * notification, not the write.
 */
export function syncTaskNotifications(
  facts: TaskNotificationFacts,
  options: {
    deps?: TaskNotificationDeps;
    now?: Date;
    previous?: TaskNotificationFacts | null;
  } = {}
): Promise<TaskNotifyReport> {
  return runNotificationSync<TaskNotificationSkip>({
    ...taskSubject(facts.churchId, facts.id),
    mustCancel:
      options.previous === undefined
        ? true
        : options.previous !== null &&
          taskNotificationsDiffer(options.previous, facts),
    plan: () => planTaskNotifications(facts, options.now ?? new Date()),
    deps: options.deps ?? dbTaskNotificationDeps,
  });
}

/**
 * The subject went away: cancel every pending notification about this task.
 *
 * Called by completion and by delete. Safe when nothing is pending — it
 * resolves to zero rather than throwing, so neither path has to know whether
 * the task ever had a notification.
 */
export function cancelTaskNotifications(
  churchId: string,
  taskId: string,
  deps: TaskNotificationDeps = dbTaskNotificationDeps
): Promise<number> {
  return cancelEntityNotifications(taskSubject(churchId, taskId), deps);
}

/** `cancelTaskNotifications` over a set of ids, one at a time. */
export async function cancelTaskNotificationsFor(
  churchId: string,
  taskIds: readonly string[],
  deps: TaskNotificationDeps = dbTaskNotificationDeps
): Promise<number> {
  let cancelled = 0;
  for (const taskId of taskIds) {
    cancelled += await cancelTaskNotifications(churchId, taskId, deps);
  }
  return cancelled;
}

/**
 * Re-sync a set of tasks after a bulk write — one read for the facts, then one
 * sync each.
 *
 * Sequential on purpose, the same reason `bulkCompleteTasks` emits its events
 * one at a time: a hundred-task reschedule must not fan a hundred concurrent
 * enqueue chains at the database.
 */
export async function syncTaskNotificationsFor(
  churchId: string,
  taskIds: readonly string[],
  options: { deps?: TaskNotificationDeps; now?: Date } = {}
): Promise<TaskNotifyReport[]> {
  const deps = options.deps ?? dbTaskNotificationDeps;
  if (taskIds.length === 0) return [];

  try {
    const facts = await deps.loadFacts(churchId, taskIds);
    const reports: TaskNotifyReport[] = [];
    for (const row of facts) {
      reports.push(
        await syncTaskNotifications(row, { deps, now: options.now })
      );
    }
    return reports;
  } catch (error) {
    console.error("task notification bulk sync failed", { churchId, error });
    return [];
  }
}

// ----------------------------------------------------------------------------
// N-014 — the still-live predicate
// ----------------------------------------------------------------------------

/**
 * "Is this task still worth announcing?"
 *
 * Read at DISPATCH time, immediately before delivery, so a task completed after
 * the row was claimed is never announced. It is not a replacement for the
 * cancel above and the cancel is not a replacement for it:
 *
 *   * `cancelByEntity` only moves PENDING rows. A row a run has already claimed
 *     belongs to that run, and this is the only thing that stops it.
 *   * this predicate only runs at dispatch. A cancelled row never reaches it,
 *     which is what keeps the feed clean rather than merely the email.
 *
 * A missing task (hard-deleted, or another church's) is RESOLVED, not live: the
 * read is church-scoped, so a row whose anchor does not own the task announces
 * nothing. A read that THROWS is left to throw — `resolveLiveness` catches it
 * and defers the notification rather than guessing (N-014).
 */
export function taskStillLivePredicate(
  deps: TaskNotificationDeps = dbTaskNotificationDeps
): StillLivePredicate {
  return async (notification) => {
    if (!notification.churchId || !notification.entityId) return false;

    const task = await deps.loadTask(
      notification.churchId,
      notification.entityId
    );
    if (!task) return false;

    return task.deletedAt === null && task.status !== "complete";
  };
}

/**
 * Register the predicate for BOTH task types.
 *
 * A CALL, and NOT a module-load side effect of this file. It was one, on the
 * theory that "importing this module arms the check" — but the only runtime that
 * READS a predicate is the dispatcher, whose entrypoint imports no feature
 * module, so both task types were unregistered in the cron runtime and
 * `resolveLiveness` called every one of them live. `registerNotificationConsumers()`
 * (`src/lib/notifications/register-consumers.ts`) is the one caller, and the
 * dispatch route calls it. Idempotent: registration replaces, never stacks.
 *
 * The loop is over `TASK_NOTIFICATION_TYPES`, so a third condition cannot ship
 * registered for only two of them.
 */
export function registerTaskStillLivePredicates(
  deps: TaskNotificationDeps = dbTaskNotificationDeps
): void {
  registerStillLivePredicates(
    TASK_NOTIFICATION_TYPES,
    taskStillLivePredicate(deps)
  );
}

// ----------------------------------------------------------------------------
// Production wiring
// ----------------------------------------------------------------------------

/**
 * The facts behind a set of tasks, church-scoped and excluding soft-deleted
 * rows.
 *
 * Exported un-awaited as a query builder so the tenancy of the read can be
 * asserted with `.toSQL()` without a database — the technique
 * `src/lib/meetings/service.ts` uses for its own reads.
 */
export function taskNotificationFactsQuery(
  churchId: string,
  taskIds: readonly string[]
) {
  return db
    .select({
      id: tasks.id,
      churchId: tasks.churchId,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      assignedToId: tasks.assignedToId,
      deletedAt: tasks.deletedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, churchId),
        inArray(tasks.id, [...taskIds]),
        isNull(tasks.deletedAt)
      )
    );
}

export const dbTaskNotificationDeps: TaskNotificationDeps = {
  enqueue,
  cancelByEntity,

  async loadTask(churchId, taskId) {
    // The CHURCH is in the WHERE, not inferred from the id: the notification's
    // anchor is the tenant, and a task id that belongs to another one must
    // resolve to "gone" rather than to somebody else's row.
    const [task] = await db
      .select({ status: tasks.status, deletedAt: tasks.deletedAt })
      .from(tasks)
      .where(and(eq(tasks.churchId, churchId), eq(tasks.id, taskId)))
      .limit(1);

    return task ?? null;
  },

  async loadFacts(churchId, taskIds) {
    if (taskIds.length === 0) return [];
    return taskNotificationFactsQuery(churchId, taskIds);
  },
};
