import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import {
  churches,
  persons,
  tasks,
  users,
  churchMeetings,
  type NewTask,
} from "@/db/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
import { eventBus } from "@/lib/events/event-bus";
import { churchHasNoPlanter } from "@/lib/onboarding/leadership";

import { addCalendarDays } from "@/lib/datetime";

import { syncTaskNotificationsFor } from "./notifications";

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

  // Who owns the follow-ups. Two questions, in order.
  //
  // 1. OB-004: did the church SAY it has no planter? A planter who answered
  //    "no, someone else will lead this plant" is still the operating account —
  //    role `planter`, linked by `church_id` — so the role lookup below would
  //    happily assign them work they explicitly said is not theirs. The declared
  //    answer wins over the inferred one. `null` (never asked, i.e. every church
  //    created before this step) keeps the inference, so nothing is retro-orphaned.
  const [church] = await db
    .select({ leadershipStatus: churches.leadershipStatus })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  // 2. Otherwise: infer the planter from the role, as before.
  const planter = churchHasNoPlanter({
    leadershipStatus: church?.leadershipStatus,
  })
    ? []
    : await db
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

    // Whole UTC days, through the app's one calendar-day helper
    // (`@/lib/datetime`): the generated task's `due_date` is read back by
    // surfaces pinned to APP_TIME_ZONE, so the day it names has to be measured
    // in the same one.
    const followUpDueDateStr = addCalendarDays(now, 2);

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

  const evalDueDateStr = addCalendarDays(now, 1);

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
    let created: { id: string }[];
    try {
      created = await db
        .insert(tasks)
        .values(tasksToCreate)
        .returning({ id: tasks.id });
    } catch (error) {
      if (isUniqueViolation(error, TASKS_MEETING_EVALUATION_UNIQUE)) {
        // A concurrent finalize won the race and generated the same set. The
        // whole INSERT rolled back, so there is nothing to clean up.
        console.warn(
          `[EVENT] Follow-up tasks for meeting ${meetingId} were generated concurrently — skipping (idempotent)`
        );
        return;
      }
      throw error;
    }

    // T-018. Every generated row carries an assignee (the planter) and a due
    // date, so every one owes a due and an overdue notification — and a
    // follow-up nobody typed is exactly the kind that gets forgotten. The ids
    // come from the write's own `returning()`, so only rows that actually
    // landed are announced; the helper is best-effort and sequential, so this
    // can neither fail the generation nor slow it into a timeout.
    await syncTaskNotificationsFor(
      churchId,
      created.map((row) => row.id)
    );

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Created ${tasksToCreate.length} follow-up task(s) for meeting ${meetingId} ` +
          `(${attendeeIds.length} attendee follow-ups + 1 evaluation)`
      );
    }
  }
}

/**
 * The partial unique index that enforces one live evaluation task per meeting.
 *
 * The NAME is what this module owns; the PREDICATE that recognises a violation
 * of it is `isUniqueViolation` (`src/db/errors.ts`), the one copy every domain
 * shares. This file carried its own byte-identical walk of the cause chain
 * until #411 — a second implementation of "the unique index is the concurrency
 * guard and it just did its job", which is exactly the shape that goes stale in
 * one place and not the other (a new driver wrapping, a `constraint` field that
 * stops being populated). Never re-inline it.
 */
export const TASKS_MEETING_EVALUATION_UNIQUE =
  "tasks_meeting_evaluation_unique_idx";
