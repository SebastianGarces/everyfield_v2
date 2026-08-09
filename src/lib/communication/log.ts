// ============================================================================
// Communication log — entries the app writes for itself (COM-020)
// ============================================================================
//
// A person's communication log (COM-007) is `communications` joined to that
// person's `communication_recipients` row — see `getPersonCommunications` in
// `service.ts`. Everything in it until now was an email the planter sent.
//
// COM-020 adds the other half of the FRD's "Follow-Up from Task" workflow: its
// [Log Only] branch, "just record the contact was made". Completing a task that
// is attached to a person IS a record that the planter reached out, so the
// entry is written from the `task.completed` event instead of from a form.
//
// WHAT MAKES IT DISTINGUISHABLE FROM A SENT EMAIL
//
// `communications.status`. A sent message walks `sending -> sent` (or `failed`);
// a logged contact is born `logged` and never moves, because nothing was
// delivered. That is the one field to assert on, and the one the history filter
// can select. `sent_at` is still written — for a logged entry it means "when
// the contact happened", i.e. when the task was completed, which is what both
// the person log and the history table already render.
//
// IDEMPOTENCY
//
// `communication_recipients.external_id` carries `task:<taskId>`. For an email
// that column holds the Resend message id; here it holds the id of the thing
// the entry was derived from, namespaced so the two can never collide (Resend
// ids are `re_…`, and the webhook only ever looks up an exact id it was given).
// It is read before the write, so a replayed `task.completed` — the same task
// completed, the event re-emitted — adds nothing.
//
// That read is a guard against REPLAY, not against CONCURRENCY: two emissions
// in flight at once would both miss it. The real guard would be a partial
// unique index on (church_id, external_id), which needs a migration and is out
// of this unit's scope.
//
// ACCEPTED RESIDUAL, and it is REACHABLE. Nothing stands in for that index.
// `completeTask` (`src/lib/tasks/service.ts`) is a read-then-write, not a
// compare-and-set — its UPDATE matches on church + id + `deleted_at IS NULL`
// and does NOT re-assert `status <> 'complete'` — so two simultaneous
// completions of one task, which is what a double-clicked Complete button
// sends, both emit `task.completed` and both write an entry. (`completeMany`
// does carry `ne(status, 'complete')` and is safe; the single-task path is the
// hole.) The cost is a duplicate row in one person's log, never a missing or
// cross-tenant one, which is why it is accepted rather than migrated for.
// `memory/invariants.md` → Transactions / Atomicity records the same.
//
// TENANCY
//
// Every read and both writes carry `church_id`, and the person is re-read
// scoped to the event's church: an event naming a person who belongs to some
// other church writes nothing at all rather than a cross-tenant row.
// ============================================================================

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  communicationRecipients,
  communications,
  type CommunicationStatus,
} from "@/db/schema/communication";
import { persons } from "@/db/schema/people";
import { tasks } from "@/db/schema/tasks";
import { formatDateTime } from "@/lib/datetime";

// ---------------------------------------------------------------------------
// The shape of a logged entry
// ---------------------------------------------------------------------------

/**
 * The `communications.status` of an entry that was RECORDED rather than sent.
 *
 * `satisfies CommunicationStatus` on purpose: if the value is ever dropped from
 * `communicationStatuses`, this module stops compiling instead of quietly
 * writing a status nothing else understands.
 */
export const LOGGED_ENTRY_STATUS =
  "logged" as const satisfies CommunicationStatus;

/** Namespace for the `external_id` of an entry derived from a task. */
export const TASK_ENTRY_REFERENCE_PREFIX = "task:";

/** The idempotency key for the entry a given task's completion produces. */
export function taskEntryReference(taskId: string): string {
  return `${TASK_ENTRY_REFERENCE_PREFIX}${taskId}`;
}

/**
 * The `task.completed` payload, restated structurally.
 *
 * Deliberately NOT an import of `TaskCompletedEvent`: no feature module imports
 * another feature's module, so the coupling stays a shape that
 * `subscriptions.ts` satisfies when it mounts the handler.
 */
export interface CompletedTaskEvent {
  taskId: string;
  churchId: string;
  relatedType: string | null;
  relatedId: string | null;
  completedById: string;
  timestamp: Date;
}

/**
 * The person this completed task was a contact WITH, or null when it was not
 * about a person at all (a meeting, a team, a facility, or nothing).
 *
 * This is the whole "is it loggable" decision, in one exported place. The link
 * to a person is the signal, not the category: a planter who attaches a task to
 * a person and then completes it has been in touch with them, whatever the task
 * was filed under. Narrowing that later (to `follow_up` only, say) is a change
 * to this function and nothing else.
 */
export function contactedPersonId(event: CompletedTaskEvent): string | null {
  if (event.relatedType !== "person") return null;
  const personId = event.relatedId?.trim();
  return personId ? personId : null;
}

/** What the entry says: the task, and when it was completed. */
export function taskEntryBody(
  taskTitle: string,
  category: string | null,
  completedAt: Date
): string {
  const kind = category ? `${category.replace(/_/g, " ")} task` : "task";
  return (
    `The ${kind} "${taskTitle}" was completed on ` +
    `${formatDateTime(completedAt, "short")}. ` +
    `This entry records the contact. No message was sent from EveryField.`
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The entry this task has already produced, if any. Church-scoped, and matched
 * on the namespaced `external_id` — the only column that ties an entry back to
 * the task it came from.
 */
export function existingTaskEntryQuery(churchId: string, taskId: string) {
  return db
    .select({ id: communicationRecipients.id })
    .from(communicationRecipients)
    .where(
      and(
        eq(communicationRecipients.churchId, churchId),
        eq(communicationRecipients.externalId, taskEntryReference(taskId))
      )
    )
    .limit(1);
}

/** The completed task itself, scoped to the church the event named. */
export function taskQuery(churchId: string, taskId: string) {
  return db
    .select({
      title: tasks.title,
      category: tasks.category,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.churchId, churchId)))
    .limit(1);
}

/** The person contacted, scoped to the church the event named. */
export function contactedPersonQuery(churchId: string, personId: string) {
  return db
    .select({ id: persons.id, email: persons.email })
    .from(persons)
    .where(
      and(
        eq(persons.id, personId),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
      )
    )
    .limit(1);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface TaskLogEntry {
  entryId: string;
  recipientId: string;
  churchId: string;
  personId: string;
  personEmail: string | null;
  taskId: string;
  taskTitle: string;
  taskCategory: string | null;
  completedAt: Date;
  completedById: string;
}

/**
 * The two rows an entry is made of, as ONE `db.batch([...])` — a Neon batched
 * transaction, all-or-nothing (`memory/invariants.md` → Transactions). Both ids
 * are minted up front so the recipient can name its parent without a round trip
 * in between, and the parent is inserted first because the FK points that way.
 */
export function taskLogEntryStatements(entry: TaskLogEntry) {
  return [
    db.insert(communications).values({
      id: entry.entryId,
      churchId: entry.churchId,
      subject: entry.taskTitle,
      body: taskEntryBody(
        entry.taskTitle,
        entry.taskCategory,
        entry.completedAt
      ),
      // `channel` is left at its default: no channel was used, and widening the
      // channel enum would widen the compose form's input surface with it. The
      // entry's kind lives in `status`.
      status: LOGGED_ENTRY_STATUS,
      sentAt: entry.completedAt,
      recipientCount: 1,
      createdById: entry.completedById,
    }),
    db.insert(communicationRecipients).values({
      id: entry.recipientId,
      churchId: entry.churchId,
      communicationId: entry.entryId,
      personId: entry.personId,
      email: entry.personEmail,
      // The contact was made — that is what completing the task asserts — so
      // the recipient row is `sent`, with no delivery metadata behind it.
      status: "sent",
      externalId: taskEntryReference(entry.taskId),
    }),
  ] as const;
}

/** What `logCompletedTaskContact` did, for logging and for the tests. */
export type TaskLogOutcome =
  | "logged"
  | "not_a_person_contact"
  | "already_logged"
  | "task_not_found"
  | "person_not_found";

/**
 * Record a completed person-related task in that person's communication log.
 *
 * Throws on a database failure — the caller mounted on the bus is what decides
 * that a failure here is not the task's problem.
 */
export async function logCompletedTaskContact(
  event: CompletedTaskEvent
): Promise<TaskLogOutcome> {
  const personId = contactedPersonId(event);
  if (!personId || !event.churchId || !event.taskId) {
    return "not_a_person_contact";
  }

  const existing = await existingTaskEntryQuery(event.churchId, event.taskId);
  if (existing.length > 0) return "already_logged";

  const [task] = await taskQuery(event.churchId, event.taskId);
  if (!task) return "task_not_found";

  const [person] = await contactedPersonQuery(event.churchId, personId);
  if (!person) return "person_not_found";

  // The task's own `completed_at` first, so a replay would write the same
  // instant the first attempt did; the event's timestamp is the fallback.
  const completedAt = task.completedAt ?? event.timestamp;

  await db.batch(
    taskLogEntryStatements({
      entryId: crypto.randomUUID(),
      recipientId: crypto.randomUUID(),
      churchId: event.churchId,
      personId: person.id,
      personEmail: person.email,
      taskId: event.taskId,
      taskTitle: task.title,
      taskCategory: task.category,
      completedAt,
      completedById: event.completedById,
    })
  );

  return "logged";
}

/**
 * The bus adapter (COM-020), mounted in `src/lib/events/subscriptions.ts`.
 *
 * Best-effort by design. `task.completed` is also what marks a plant dirty for
 * re-assessment (PE-010), and a communication log entry is not worth risking
 * that: failures are swallowed and logged here, so this handler can never
 * reject. The bus already isolates handlers with `Promise.allSettled`, but a
 * strict emitter would see this rejection, and the log entry is never a reason
 * to tell a caller its task did not complete.
 */
export async function handleTaskCompletedForCommunicationLog(
  event: CompletedTaskEvent
): Promise<void> {
  try {
    const outcome = await logCompletedTaskContact(event);

    if (outcome === "logged" && process.env.NODE_ENV === "development") {
      console.log(
        `[COMM] Logged task ${event.taskId} to person ${event.relatedId}'s communication log`
      );
    }
  } catch (error) {
    console.error(
      `[COMM] Failed to log completed task ${event.taskId} to the communication log:`,
      error
    );
  }
}
