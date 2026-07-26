import { db } from "@/db";
import {
  persons,
  tasks,
  users,
  churchMeetings,
  type NewTask,
} from "@/db/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
import { eventBus } from "@/lib/events/event-bus";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event payload for task.completed
 * Emitted when a task is marked as complete.
 * Dashboard (F4) subscribes to update task metrics.
 */
export interface TaskCompletedEvent {
  type: "task.completed";
  taskId: string;
  churchId: string;
  category: string | null;
  relatedType: string | null;
  relatedId: string | null;
  completedById: string;
  timestamp: Date;
}

// ============================================================================
// Event Emission
// ============================================================================

/**
 * Emit an event when a task is completed.
 */
export async function emitTaskCompleted(
  taskId: string,
  churchId: string,
  category: string | null,
  relatedType: string | null,
  relatedId: string | null,
  completedById: string
): Promise<void> {
  await eventBus.emit<TaskCompletedEvent>({
    type: "task.completed",
    taskId,
    churchId,
    category,
    relatedType,
    relatedId,
    completedById,
    timestamp: new Date(),
  });
}

// ============================================================================
// Auto-Completion Engine
// ============================================================================

/**
 * Generic auto-complete function that marks matching tasks as complete when
 * a corresponding event fires. A task matches when:
 *
 * - completion_event equals the fired event type
 * - related_id equals the entity that triggered the event
 * - church_id matches (multi-tenant guard)
 * - status is NOT already complete
 * - not soft-deleted
 *
 * This is the SINGLE function that all auto-complete subscriptions call.
 * Adding a new auto-completion trigger requires only:
 * 1. Emit the event from the feature
 * 2. Add one subscription line in subscriptions.ts
 * 3. Set `completionEvent` when creating the task
 */
export async function autoCompleteTasksByEvent(
  completionEvent: string,
  entityId: string,
  churchId: string
): Promise<void> {
  try {
    const completed = await db
      .update(tasks)
      .set({
        status: "complete" as const,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.completionEvent, completionEvent),
          eq(tasks.relatedId, entityId),
          eq(tasks.churchId, churchId),
          ne(tasks.status, "complete"),
          isNull(tasks.deletedAt)
        )
      )
      .returning({ id: tasks.id });

    if (completed.length > 0 && process.env.NODE_ENV === "development") {
      console.log(
        `[AUTO-COMPLETE] Completed ${completed.length} task(s) for event "${completionEvent}" (entity ${entityId})`
      );
    }
  } catch (error) {
    console.error(
      `[AUTO-COMPLETE] Failed to auto-complete tasks for event "${completionEvent}" (entity ${entityId}):`,
      error
    );
  }
}

// ============================================================================
// Inbound Event Handlers
// ============================================================================

/**
 * Handle meeting attendance finalization from F3.
 * Creates two types of follow-up tasks:
 *
 * 1. Per-attendee follow-up tasks (one per attendee, regardless of first-time
 *    or returning -- the planter can dismiss duplicates if a person has an
 *    existing follow-up from a prior meeting):
 *    - Title: "Follow up with [Person Name]"
 *    - Category: follow_up
 *    - Priority: high
 *    - Due: 2 days from now (48-hour follow-up principle)
 *    - Related: person
 *
 * 2. Meeting evaluation task (one per meeting):
 *    - Title: "Complete evaluation for [Meeting Title]"
 *    - Category: vision_meeting
 *    - Priority: high
 *    - Due: 1 day from now (24 hours -- prompt reflection)
 *    - Related: meeting (deep-links to /meetings/[id]/evaluation)
 *
 * IDEMPOTENT (MEET-011), enforced by the database. Both task kinds are written
 * by a SINGLE INSERT, and `tasks_meeting_evaluation_unique_idx` (a partial
 * unique index on church_id + related_id for live evaluation tasks) makes the
 * evaluation task unique per meeting. So:
 *
 * - A sequential replay is caught by the cheap SELECT below and does nothing.
 * - Two finalizes racing both pass that SELECT — an application-level guard
 *   cannot prevent that — and both attempt the INSERT. The index rejects the
 *   second one, and because the evaluation task shares the statement with the
 *   per-attendee follow-ups, the whole INSERT is aborted: the loser writes
 *   nothing at all rather than a duplicate set of follow-ups. That rejection is
 *   the expected outcome of a race, so it is swallowed as a no-op.
 *
 * THROWS on any other failure. `finalizeAttendance` only marks the meeting
 * finalized after this resolves, so swallowing an error here would strand a
 * finalized meeting with no follow-up tasks. Letting it propagate leaves the
 * meeting un-finalized and the whole operation safely retryable.
 */
export async function handleMeetingAttendanceFinalized(
  meetingId: string,
  meetingType: string,
  churchId: string,
  attendeeIds: string[]
): Promise<void> {
  // Only create follow-up tasks for vision meetings
  if (meetingType !== "vision_meeting") {
    return;
  }

  // Cheap fast path for the common case (a sequential replay). It is NOT the
  // guarantee — `tasks_meeting_evaluation_unique_idx` is. See the note above.
  const alreadyGenerated = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.relatedType, "meeting"),
        eq(tasks.relatedId, meetingId),
        eq(tasks.completionEvent, "meeting.evaluation.completed"),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);

  if (alreadyGenerated.length > 0) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Follow-up tasks already exist for meeting ${meetingId} — skipping (idempotent replay)`
      );
    }
    return;
  }

  // Look up the planter (church creator) to assign tasks to them
  const planter = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.churchId, churchId), eq(users.role, "planter")))
    .limit(1);

  const planterId = planter[0]?.id;
  if (!planterId) {
    // Deliberately NOT an error: with no planter there is nobody to assign the
    // tasks to, and that is a stable data condition rather than a transient
    // failure. Throwing would block the planter's meeting from ever being
    // finalized instead of eventually succeeding.
    console.warn(
      `[EVENT] handleMeetingAttendanceFinalized: no planter found for church ${churchId}`
    );
    return;
  }

  const now = new Date();
  const tasksToCreate: NewTask[] = [];

  // -----------------------------------------------------------------------
  // 1. Per-attendee follow-up tasks (48-hour due date)
  // -----------------------------------------------------------------------
  if (attendeeIds.length > 0) {
    // Look up person names for task titles
    const attendees = await db
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(persons)
      .where(and(eq(persons.churchId, churchId), isNull(persons.deletedAt)));

    const attendeeMap = new Map(
      attendees.map((a) => [a.id, `${a.firstName} ${a.lastName}`])
    );

    const followUpDueDate = new Date(now);
    followUpDueDate.setDate(followUpDueDate.getDate() + 2);
    const followUpDueDateStr = followUpDueDate.toISOString().split("T")[0];

    for (const personId of attendeeIds) {
      const personName = attendeeMap.get(personId) ?? "Unknown";
      tasksToCreate.push({
        churchId,
        title: `Follow up with ${personName}`,
        status: "not_started",
        priority: "high",
        category: "follow_up",
        dueDate: followUpDueDateStr,
        assignedToId: planterId,
        relatedType: "person",
        relatedId: personId,
        createdById: planterId,
      });
    }
  }

  // -----------------------------------------------------------------------
  // 2. Meeting evaluation task (24-hour due date)
  // -----------------------------------------------------------------------
  // Look up the meeting title/date for the task title
  const meeting = await db
    .select({
      id: churchMeetings.id,
      title: churchMeetings.title,
    })
    .from(churchMeetings)
    .where(eq(churchMeetings.id, meetingId))
    .limit(1);

  const meetingInfo = meeting[0];
  const meetingLabel = meetingInfo?.title ?? `Vision Meeting`;

  const evalDueDate = new Date(now);
  evalDueDate.setDate(evalDueDate.getDate() + 1);
  const evalDueDateStr = evalDueDate.toISOString().split("T")[0];

  tasksToCreate.push({
    churchId,
    title: `Complete evaluation for ${meetingLabel}`,
    status: "not_started",
    priority: "high",
    category: "vision_meeting",
    dueDate: evalDueDateStr,
    assignedToId: planterId,
    relatedType: "meeting",
    relatedId: meetingId,
    createdById: planterId,
    completionEvent: "meeting.evaluation.completed",
  });

  // -----------------------------------------------------------------------
  // Bulk insert all tasks
  // -----------------------------------------------------------------------
  // ONE statement, deliberately. Postgres applies it atomically, so the
  // follow-ups and the evaluation task land together or not at all — which is
  // what lets the unique index on the evaluation task speak for the whole set.
  //
  // Note the absence of `onConflictDoNothing()`: it would skip only the
  // conflicting evaluation row and happily insert the loser's follow-ups,
  // which is the duplication this is here to prevent. We want the violation.
  if (tasksToCreate.length > 0) {
    try {
      await db.insert(tasks).values(tasksToCreate);
    } catch (error) {
      if (isDuplicateGenerationError(error)) {
        // A concurrent finalize won the race and generated the same set. The
        // whole INSERT rolled back, so there is nothing to clean up.
        console.warn(
          `[EVENT] Follow-up tasks for meeting ${meetingId} were generated concurrently — skipping (idempotent)`
        );
        return;
      }
      throw error;
    }

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Created ${tasksToCreate.length} follow-up task(s) for meeting ${meetingId} ` +
          `(${attendeeIds.length} attendee follow-ups + 1 evaluation)`
      );
    }
  }
}

/** Postgres `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";

/** The partial unique index that enforces one live evaluation task per meeting. */
export const MEETING_EVALUATION_UNIQUE_INDEX =
  "tasks_meeting_evaluation_unique_idx";

/**
 * True when `error` is the follow-up generation race losing to a concurrent
 * finalize — i.e. a unique violation on `tasks_meeting_evaluation_unique_idx`.
 *
 * Narrow on purpose: any OTHER unique violation is a real bug and must still
 * propagate, or a finalize could be marked done on a failed insert. Drizzle
 * wraps driver errors, so the cause chain is walked rather than just the top
 * error.
 */
export function isDuplicateGenerationError(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (typeof current === "object") {
      const candidate = current as {
        code?: unknown;
        constraint?: unknown;
        message?: unknown;
        cause?: unknown;
      };
      const message =
        typeof candidate.message === "string" ? candidate.message : "";

      if (
        candidate.code === PG_UNIQUE_VIOLATION &&
        (candidate.constraint === MEETING_EVALUATION_UNIQUE_INDEX ||
          message.includes(MEETING_EVALUATION_UNIQUE_INDEX))
      ) {
        return true;
      }

      current = candidate.cause;
      continue;
    }

    return false;
  }

  return false;
}
