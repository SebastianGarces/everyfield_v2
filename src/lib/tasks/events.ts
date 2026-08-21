import { db } from "@/db";
import {
  churches,
  persons,
  tasks,
  users,
  churchMeetings,
  type NewTask,
} from "@/db/schema";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { eventBus } from "@/lib/events/event-bus";
import type { FinalizedAttendee } from "@/lib/meetings/events";
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
 * WHO IS OWED A FOLLOW-UP after a vision meeting: the FIRST-TIME attendees, and
 * nobody else (VM-007, #323 WS2).
 *
 * The rule used to be "everyone in the room", which put a fresh 48-hour task on
 * the planter's list for the core-group members who come to every meeting. A
 * list where everything is urgent says nothing. `attendance_type` is derived
 * once, when the register is marked (`meetings/attendance-type.ts`), so this
 * reads the answer rather than re-deriving it — and `null` (a row written
 * before that derivation shipped) is UNKNOWN, which is not first-time.
 *
 * Pure, and exported, so the rule can be read and tested without a database.
 */
export function followUpRecipients(attendees: FinalizedAttendee[]): string[] {
  return attendees
    .filter((attendee) => attendee.attendanceType === "first_time")
    .map((attendee) => attendee.personId);
}

/**
 * The day a meeting's follow-ups are due: the MEETING's day + 2 (VM-007 AC 7,
 * #323 WS2) — never the finalization's.
 *
 * The 48-hour window belongs to the conversation, not to the paperwork. A
 * planter who finalizes on Wednesday the meeting they held on Sunday gets a
 * task that is already overdue, and that is the true statement about that
 * follow-up: the window closed while the register sat unfinished.
 *
 * Whole UTC calendar days, through the app's one calendar-day helper
 * (`@/lib/datetime`): the `due_date` is read back by surfaces pinned to
 * APP_TIME_ZONE, so the day it names has to be measured in the same one.
 *
 * It doubles as the identity of "this meeting's follow-up" — see the handler.
 */
export function followUpDueDate(meetingDate: Date): string {
  return addCalendarDays(meetingDate, 2);
}

/**
 * Handle meeting attendance finalization from F3.
 * Creates two kinds of task:
 *
 * 1. Per-attendee follow-up tasks, for FIRST-TIME attendees only (VM-007):
 *    - Title: "Follow up with [Person Name]"
 *    - Category: follow_up
 *    - Priority: high
 *    - Due: the MEETING's day + 2 (the 48-hour follow-up window)
 *    - Related: person
 *
 * 2. Meeting evaluation task (one per meeting):
 *    - Title: "Complete evaluation for [Meeting Title]"
 *    - Category: vision_meeting
 *    - Priority: high
 *    - Due: 1 day from now (24 hours -- prompt reflection)
 *    - Related: meeting (deep-links to /meetings/[id]/evaluation)
 *
 * WHO GETS A FOLLOW-UP (VM-007, #323 WS2). First-timers, and nobody else. It
 * used to be every attendee "regardless of first-time or returning", which put
 * a fresh 48-hour task on the planter's list for the core-group members who
 * turn up to every meeting — a list that says everything is urgent says
 * nothing. `attendance_type` is derived once when the register is marked
 * (`meetings/attendance-type.ts`) and travels on the event, so this handler
 * neither re-derives it nor re-queries for it.
 *
 * WHEN IT IS DUE (VM-007 AC 7, #323 WS2). The MEETING's day plus two, never
 * the finalize's. The window belongs to the conversation, not to the paperwork:
 * a planter who finalizes on Wednesday the meeting they held on Sunday gets a
 * task that is already overdue, which is the true statement about that
 * follow-up. Whole calendar days, through `@/lib/datetime` — the day a
 * `due_date` NAMES has to be measured in the zone it is read in.
 *
 * IDEMPOTENT (MEET-011), AND CONVERGENT (#323 WS3). Re-running this for a
 * meeting is not a no-op that skips: it writes whatever is MISSING and nothing
 * else, so reconciling attendance after a finalize tops the late-added
 * first-timer up instead of dropping them. Two reads decide what is missing —
 * the evaluation task for this meeting, and which of these first-timers already
 * hold this meeting's follow-up.
 *
 * WHAT IDENTIFIES "THIS MEETING'S FOLLOW-UP", given the row relates to a
 * PERSON: (church, person, category `follow_up`, due date). Every follow-up
 * this meeting generates carries the same meeting-derived due day, so the tuple
 * is meeting-specific without a column to say so. Two vision meetings sharing a
 * day cannot collide through it — the second one's attendees are `returning`
 * by derivation, so they are not candidates at all.
 *
 * CONCURRENCY, and where the guarantee comes from: EVERY ROW THIS WRITES HAS AN
 * ARBITER, so the INSERT is per-row idempotent (#521). Two partial unique
 * indexes stand over the two kinds — `tasks_meeting_evaluation_unique_idx` on
 * (church_id, related_id) for live evaluation tasks, and
 * `tasks_person_follow_up_unique_idx` on (church_id, related_id, due_date) for
 * live person follow-ups — each spelled with the same predicate as the read
 * above it. Racing finalizes both pass those reads and both attempt the INSERT;
 * `ON CONFLICT DO NOTHING` then skips exactly the rows somebody else already
 * wrote and lands the rest.
 *
 * WHY THAT REPLACED "THE LOSER WRITES NOTHING" (#521, reversing #323 WS3). The
 * INSERT used to carry no conflict clause on purpose: the follow-ups had no key
 * of their own, so the only guard available was the evaluation row's, and
 * letting its violation abort the WHOLE statement was what stopped a loser from
 * writing a duplicate set. The comment that said `onConflictDoNothing()` "would
 * skip only the conflicting evaluation row and happily insert the loser's
 * follow-ups" was true of a table where a follow-up was unguarded, and its
 * premise is what #521's index removed. All-or-nothing is now the WORSE shape:
 * a top-up race in which one reconcile writes {Ann} and the other {Ann, Bo}
 * aborts the second one whole, so Bo — a late-added first-timer, the exact case
 * #323 WS3 made this handler convergent for — is dropped until some later
 * finalize runs. Per-row skip writes Bo and skips Ann, which is what "writes
 * whatever is MISSING and nothing else" has always claimed.
 *
 * The conflict clause is deliberately UNTARGETED. Naming an arbiter covers that
 * one index and re-raises the unique violation on any other
 * (`memory/invariants/transactions-atomicity.md`); bare `DO NOTHING` covers
 * every unique index on the table, including a person who appears twice in one
 * register, which a targeted form would have raised mid-statement.
 *
 * THROWS on failure — nothing is swallowed here any more, because no conflict
 * reaches the application. `finalizeAttendance` only records the attendance
 * count after this resolves, so swallowing an error here would strand a
 * finalized meeting with no follow-up tasks. Letting it propagate leaves the
 * meeting un-finalized (or its count stale) and the whole operation safely
 * retryable.
 */
export async function handleMeetingAttendanceFinalized(
  meetingId: string,
  meetingType: string,
  churchId: string,
  attendees: FinalizedAttendee[]
): Promise<void> {
  // Only create follow-up tasks for vision meetings
  if (meetingType !== "vision_meeting") {
    return;
  }

  // The meeting itself. Its TITLE names the evaluation task and its DAY anchors
  // every follow-up window, so this read is load-bearing rather than cosmetic.
  //
  // TENANT-FILTERED (#323 WS1, from #162). `meetingId` arrives on an event
  // whose origin is a client-supplied route parameter; every other read in this
  // handler is church-scoped and this one was not, so a foreign meeting's title
  // could be read across the tenancy boundary. `memory/invariants.md` →
  // Multi-Tenancy: isolation is enforced in the application layer, there is no
  // RLS behind you.
  const [meeting] = await db
    .select({
      title: churchMeetings.title,
      datetime: churchMeetings.datetime,
    })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.id, meetingId),
        eq(churchMeetings.churchId, churchId)
      )
    )
    .limit(1);

  if (!meeting) {
    // Not an error, for the same reason the missing planter below is not: the
    // meeting is gone (or was never this church's), which no retry can fix.
    console.warn(
      `[EVENT] handleMeetingAttendanceFinalized: meeting ${meetingId} not found in church ${churchId}`
    );
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

  // 2. Otherwise: infer the planter from the OWNER seat, as before.
  const planter = churchHasNoPlanter({
    leadershipStatus: church?.leadershipStatus,
  })
    ? []
    : await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.churchId, churchId), eq(users.seat, "owner")))
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
  // 1. Per-attendee follow-up tasks — first-timers, due the meeting day + 2
  // -----------------------------------------------------------------------
  const firstTimerIds = followUpRecipients(attendees);
  const followUpDueDateStr = followUpDueDate(meeting.datetime);

  if (firstTimerIds.length > 0) {
    // Which of them already hold this meeting's follow-up. Empty on a first
    // finalize; on a reconcile it is exactly the set to leave alone.
    const existing = await db
      .select({ relatedId: tasks.relatedId })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          eq(tasks.category, "follow_up"),
          eq(tasks.relatedType, "person"),
          eq(tasks.dueDate, followUpDueDateStr),
          inArray(tasks.relatedId, firstTimerIds),
          isNull(tasks.deletedAt)
        )
      );

    const alreadyFollowedUp = new Set(
      existing.map((row) => row.relatedId).filter((id): id is string => !!id)
    );

    const owed = firstTimerIds.filter((id) => !alreadyFollowedUp.has(id));

    if (owed.length > 0) {
      // Names for the task titles, for the people who are owed one only.
      const people = await db
        .select({
          id: persons.id,
          firstName: persons.firstName,
          lastName: persons.lastName,
        })
        .from(persons)
        .where(
          and(
            eq(persons.churchId, churchId),
            inArray(persons.id, owed),
            isNull(persons.deletedAt)
          )
        );

      const nameOf = new Map(
        people.map((p) => [p.id, `${p.firstName} ${p.lastName}`])
      );

      for (const personId of owed) {
        tasksToCreate.push({
          churchId,
          title: `Follow up with ${nameOf.get(personId) ?? "Unknown"}`,
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
  }

  // -----------------------------------------------------------------------
  // 2. Meeting evaluation task (24-hour due date)
  // -----------------------------------------------------------------------
  // One per meeting, and the partial unique index says so. The read is the
  // cheap path; the index is the guarantee.
  const [existingEvaluation] = await db
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

  if (!existingEvaluation) {
    tasksToCreate.push({
      churchId,
      title: `Complete evaluation for ${meeting.title ?? "Vision Meeting"}`,
      status: "not_started",
      priority: "high",
      category: "vision_meeting",
      dueDate: addCalendarDays(now, 1),
      assignedToId: planterId,
      relatedType: "meeting",
      relatedId: meetingId,
      createdById: planterId,
      completionEvent: "meeting.evaluation.completed",
    });
  }

  if (tasksToCreate.length === 0) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Meeting ${meetingId} already holds every task it is owed — nothing to write`
      );
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Bulk insert whatever is missing
  // -----------------------------------------------------------------------
  // ONE statement, and every row in it has a partial unique index of its own
  // (see the handler docblock). `DO NOTHING` therefore means precisely "a
  // concurrent finalize already wrote this exact task" — the untargeted form,
  // so it covers both indexes rather than one named arbiter. `returning()`
  // yields only the rows that LANDED, which is what the notification sync
  // below needs.
  const created = await db
    .insert(tasks)
    .values(tasksToCreate)
    .onConflictDoNothing()
    .returning({ id: tasks.id });

  // T-018. Every generated row carries an assignee (the planter) and a due
  // date, so every one owes a due and an overdue notification — and a
  // follow-up nobody typed is exactly the kind that gets forgotten. The ids
  // come from the write's own `returning()`, so only rows that actually
  // landed are announced; the helper is best-effort and sequential, so this
  // can neither fail the generation nor slow it into a timeout.
  // `mustCancel: false` for the same reason `importTaskTemplate` passes it:
  // these ids come from the INSERT's own `returning()`, so every one of them
  // is seconds old and provably has nothing pending to cancel.
  await syncTaskNotificationsFor(
    churchId,
    created.map((row) => row.id),
    { mustCancel: false }
  );

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[EVENT] Created ${created.length} of ${tasksToCreate.length} task(s) for meeting ${meetingId}`
    );
  }
}
