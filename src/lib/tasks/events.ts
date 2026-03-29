import { db } from "@/db";
import { persons, tasks, users, churchMeetings, type NewTask } from "@/db/schema";
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

  try {
    // Look up the planter (church creator) to assign tasks to them
    const planter = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.churchId, churchId), eq(users.role, "planter")))
      .limit(1);

    const planterId = planter[0]?.id;
    if (!planterId) {
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
        .where(
          and(
            eq(persons.churchId, churchId),
            isNull(persons.deletedAt)
          )
        );

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
    if (tasksToCreate.length > 0) {
      await db.insert(tasks).values(tasksToCreate);

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[EVENT] Created ${tasksToCreate.length} follow-up task(s) for meeting ${meetingId} ` +
            `(${attendeeIds.length} attendee follow-ups + 1 evaluation)`
        );
      }
    }
  } catch (error) {
    console.error(
      `[EVENT] Failed to create follow-up tasks for meeting ${meetingId}:`,
      error
    );
  }
}
