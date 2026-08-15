import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churchMeetings,
  ministryTeams,
  persons,
  users,
  type MeetingStatus,
  type MeetingType,
  type PersonStatus,
} from "@/db/schema";
import { MS_PER_DAY, formatDateTime } from "@/lib/datetime";
import type { NotificationCategory } from "@/lib/notifications/categories";
import {
  registerStillLivePredicate,
  type StillLivePredicate,
} from "@/lib/notifications/dispatch";
import {
  cancelByEntity,
  enqueue,
  type CancelByEntityInput,
  type CancelByEntityResult,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "@/lib/notifications/enqueue";

import { listGuestListUserIds } from "./guest-list";
import { meetingDisplayTitle } from "./labels";

// ============================================================================
// VM-018 — meeting reminders and the Core Group announcement, on the shared
// F11 queue.
//
// The same contract `src/lib/tasks/notifications.ts` keeps, learned a second
// time on a subject with three reminder offsets instead of two conditions:
//
//   1. ONE ROW PER RECIPIENT PER OFFSET. A meeting seven days out with four
//      notifiable guests is twelve pending rows, not one "reminder batch".
//      Batching is N-012's, at SEND time — the dispatcher makes one email per
//      (church, recipient, category) out of whatever is due — and pre-batching
//      here would collapse the feed rows a guest uses to find the meeting.
//
//   2. THE SCHEDULE IS THE ROW'S. Every reminder is enqueued when the meeting
//      is written, with `scheduledFor` set to the offset instant. Nothing
//      sweeps for "meetings happening in three days".
//
//   3. RESCHEDULE IS CANCEL + RE-ENQUEUE (N-011). `syncMeetingNotifications`
//      cancels the meeting's pending rows by ENTITY REFERENCE and enqueues the
//      offsets that are still in the future, so a date change can never leave a
//      reminder aimed at the old one. It is never an UPDATE of a pending row.
//
//   4. A CANCELLED MEETING IS NOT ANNOUNCED (N-014). Cancelling cancels the
//      pending rows, and a still-live predicate is registered for every type as
//      the second line of defence — the cancel cannot reach a row a dispatch
//      run has already claimed.
//
// WHY THE DEDUPE KEY CARRIES THE START INSTANT. Cancelling frees a PENDING
// row's key; a DELIVERED row keeps reserving it for ever (that announcement
// happened, and re-announcing it is what dedupe exists to stop). A meeting
// moved from the 10th to the 20th after its 7-day reminder went out would
// therefore have its new 7-day reminder swallowed by the delivered one. With
// the start instant in the key, the new schedule is a new set of keys.
//
// BEST-EFFORT AT THE CALL SITE. Every entrypoint swallows its own failures and
// returns a report: a notification must never fail, or undo, the write that
// caused it (`memory/invariants.md` → Atomicity).
// ============================================================================

/** The F11 category every row here is filed under (N-005). */
export const MEETING_NOTIFICATION_CATEGORY: NotificationCategory = "meetings";

/**
 * How many days before the start each reminder lands (VM-018, Workflow 2).
 *
 * Descending, because that is the order they are sent in and the order a reader
 * expects to see them listed. The three are a tuple, not three constants: the
 * planner, the type list and the tests all derive from it, so a fourth offset
 * is one edit.
 */
export const MEETING_REMINDER_OFFSET_DAYS = [7, 3, 1] as const;

export type MeetingReminderOffset =
  (typeof MEETING_REMINDER_OFFSET_DAYS)[number];

/** The `type` discriminator for one offset — `meeting.reminder.7d`. */
export function meetingReminderType(days: number): string {
  return `meeting.reminder.${days}d`;
}

/** "A meeting was put on the calendar." Announced to the Core Group. */
export const MEETING_SCHEDULED_TYPE = "meeting.scheduled";

/**
 * Every `type` this module composes.
 *
 * Derived from the offsets rather than listed, so a fourth offset is registered
 * for the still-live check without a second edit.
 */
export const MEETING_NOTIFICATION_TYPES = [
  MEETING_SCHEDULED_TYPE,
  ...MEETING_REMINDER_OFFSET_DAYS.map(meetingReminderType),
];

/**
 * WHO the Core Group is, for the purpose of being told about a meeting.
 *
 * The three statuses at or past the core-group commitment in F2's ladder
 * (`memory/invariants.md` → People): a person who has committed and then moved
 * on to the launch team or into leadership has not left the core group, and
 * dropping them would mean the plant's most committed people were the ones who
 * stopped hearing about its meetings.
 *
 * `prospect`, `attendee`, `following_up` and `interviewed` are deliberately
 * out: they have not committed to anything, and a meeting announcement is not
 * an invitation.
 */
export const CORE_GROUP_STATUSES = [
  "core_group",
  "launch_team",
  "leader",
] as const satisfies readonly PersonStatus[];

/**
 * What a meeting notification is composed from.
 *
 * Every field REQUIRED and nullable rather than optional, for the reason
 * `MeetingTitleFacts` is (`memory/invariants.md` → Meetings): an optional field
 * lets a surface skip a SELECT and silently take a different title branch.
 */
export interface MeetingNotificationFacts {
  id: string;
  churchId: string;
  type: MeetingType;
  title: string | null;
  meetingNumber: number | null;
  teamName: string | null;
  datetime: Date;
  status: MeetingStatus;
  /** Who scheduled it — always a user, and always in the reminder audience. */
  createdBy: string;
}

/**
 * The meeting's own name, from the ONE derivation every meeting surface uses.
 *
 * Never a local `title ?? "Meeting"`: the branch order (a numbered vision
 * meeting outranks a stored title, a team meeting falls back to its team) is a
 * ruling that lives in `labels.ts`, and a notification is a surface like any
 * other.
 */
export function meetingNotificationTitle(
  facts: MeetingNotificationFacts
): string {
  return meetingDisplayTitle({
    type: facts.type,
    meetingNumber: facts.meetingNumber,
    title: facts.title,
    teamName: facts.teamName,
  });
}

/** The instant a reminder for `days` before `startsAt` becomes due. */
export function reminderInstant(startsAt: Date, days: number): Date {
  return new Date(startsAt.getTime() - days * MS_PER_DAY);
}

/** Titles are `varchar(255)`. */
function clampTitle(value: string): string {
  return value.length <= 255 ? value : `${value.slice(0, 254)}…`;
}

/**
 * The dedupe key for one announcement about one meeting.
 *
 * `occurrence` is the meeting's START INSTANT for a reminder — see the module
 * header on why the schedule belongs in the key — and omitted for the
 * scheduled-announcement, which is about the meeting EXISTING and must stay one
 * announcement however often the date moves.
 */
export function meetingDedupeKey(
  type: string,
  meetingId: string,
  occurrence?: Date
): string {
  const suffix = occurrence ? `:${occurrence.toISOString()}` : "";
  return `${type}:${meetingId}${suffix}`;
}

/** One reminder, for one recipient, at one offset. */
export function composeMeetingReminder(
  facts: MeetingNotificationFacts,
  days: number,
  recipientUserId: string
): EnqueueNotificationInput {
  const name = meetingNotificationTitle(facts);
  const when = formatDateTime(facts.datetime);

  return {
    churchId: facts.churchId,
    recipientUserId,
    category: MEETING_NOTIFICATION_CATEGORY,
    type: meetingReminderType(days),
    title: clampTitle(
      days === 1 ? `Tomorrow: ${name}` : `In ${days} days: ${name}`
    ),
    body: `${name} is on ${when}.`,
    entityType: "meeting",
    entityId: facts.id,
    dedupeKey: meetingDedupeKey(
      meetingReminderType(days),
      facts.id,
      facts.datetime
    ),
    scheduledFor: reminderInstant(facts.datetime, days),
  };
}

/**
 * The Core Group announcement — one per recipient, eligible immediately.
 *
 * `at` is the instant it becomes eligible, and it is passed rather than left to
 * `enqueue`'s own `new Date()` default so the composed row and the run that
 * composed it agree on one clock (the same reasoning `enqueue` states for
 * writing `scheduledFor` explicitly).
 */
export function composeMeetingScheduled(
  facts: MeetingNotificationFacts,
  recipientUserId: string,
  at: Date = new Date()
): EnqueueNotificationInput {
  const name = meetingNotificationTitle(facts);

  return {
    churchId: facts.churchId,
    recipientUserId,
    category: MEETING_NOTIFICATION_CATEGORY,
    type: MEETING_SCHEDULED_TYPE,
    title: clampTitle(`Scheduled: ${name}`),
    body: `${name} is on ${formatDateTime(facts.datetime)}.`,
    entityType: "meeting",
    entityId: facts.id,
    dedupeKey: meetingDedupeKey(MEETING_SCHEDULED_TYPE, facts.id),
    // Due NOW: the announcement is about a decision already made, so the next
    // dispatch tick carries it.
    scheduledFor: at,
  };
}

/** Why a meeting got no notifications. */
export type MeetingNotificationSkip = "not_scheduled" | "in_the_past";

/** Who is told what about one meeting. */
export interface MeetingAudience {
  /** The Core Group, for the scheduled-announcement. */
  coreGroup: readonly string[];
  /** The guest list plus whoever scheduled it, for the reminders. */
  reminders: readonly string[];
}

export interface MeetingNotificationPlan {
  notifications: EnqueueNotificationInput[];
  skipped: MeetingNotificationSkip | null;
}

/**
 * What this meeting owes right now. Pure.
 *
 * Two refusals, and both are rows that must not exist:
 *
 *  - NOT SCHEDULED — a `cancelled` meeting is not happening and a `completed`
 *    one already happened. Neither is worth an interruption.
 *  - IN THE PAST — reminding somebody about a meeting that has started is
 *    noise, and the announcement is stale with it.
 *
 * Offsets already in the past are DROPPED rather than enqueued at a past
 * instant: a meeting created three days out owes a 3-day and a 1-day reminder,
 * and enqueuing the 7-day one would put "in 7 days" in the feed on the next
 * tick, about a meeting three days away.
 */
export function planMeetingNotifications(
  facts: MeetingNotificationFacts,
  audience: MeetingAudience,
  now: Date = new Date()
): MeetingNotificationPlan {
  if (facts.status === "cancelled" || facts.status === "completed") {
    return { notifications: [], skipped: "not_scheduled" };
  }
  if (facts.datetime.getTime() <= now.getTime()) {
    return { notifications: [], skipped: "in_the_past" };
  }

  const notifications: EnqueueNotificationInput[] = [];

  for (const recipientUserId of audience.coreGroup) {
    notifications.push(composeMeetingScheduled(facts, recipientUserId, now));
  }

  for (const days of MEETING_REMINDER_OFFSET_DAYS) {
    if (reminderInstant(facts.datetime, days).getTime() <= now.getTime()) {
      continue;
    }
    for (const recipientUserId of audience.reminders) {
      notifications.push(composeMeetingReminder(facts, days, recipientUserId));
    }
  }

  return { notifications, skipped: null };
}

/**
 * Would these two versions of a meeting compose DIFFERENT notifications?
 *
 * The start (which decides every `scheduledFor` and every reminder's dedupe
 * key), the status (which decides whether anything is owed at all), and the
 * four fields `meetingDisplayTitle` branches on. Everything else about a
 * meeting can change without a pending row becoming wrong.
 *
 * Cancel + re-enqueue is the right answer to a RESCHEDULE (N-011) and the wrong
 * answer to an edit that changed nothing a notification says: the second would
 * cancel live rows and write identical replacements on every save.
 */
export function meetingNotificationsDiffer(
  previous: MeetingNotificationFacts,
  next: MeetingNotificationFacts
): boolean {
  return (
    previous.datetime.getTime() !== next.datetime.getTime() ||
    previous.status !== next.status ||
    previous.type !== next.type ||
    previous.title !== next.title ||
    previous.meetingNumber !== next.meetingNumber ||
    previous.teamName !== next.teamName
  );
}

/** What a sync did, without throwing. */
export interface MeetingNotifyReport {
  cancelled: number;
  considered: number;
  recorded: number;
  created: number;
  skipped: number;
  failed: number;
  reason: MeetingNotificationSkip | "not_found" | null;
}

function emptyReport(): MeetingNotifyReport {
  return {
    cancelled: 0,
    considered: 0,
    recorded: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    reason: null,
  };
}

export interface MeetingNotificationDeps {
  enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult>;
  cancelByEntity(input: CancelByEntityInput): Promise<CancelByEntityResult>;
  /** The meeting as it is now — the facts, resolved server-side. */
  loadMeeting(
    churchId: string,
    meetingId: string
  ): Promise<MeetingNotificationFacts | null>;
  /** The plant's Core Group, as user ids. */
  listCoreGroup(churchId: string): Promise<string[]>;
  /** The guest list, as user ids. */
  listGuests(churchId: string, meetingId: string): Promise<string[]>;
}

// ----------------------------------------------------------------------------
// Entrypoints
// ----------------------------------------------------------------------------

/**
 * Resolve who hears about this meeting.
 *
 * The reminder audience is the guest list PLUS whoever scheduled it. The
 * creator is in it unconditionally because they are the one who has to prepare
 * — and because they are the only recipient a meeting is guaranteed to have:
 * most guests are CRM contacts with no login, so a guest-list-only audience
 * would silently be empty for the majority of meetings.
 *
 * Deduped, so somebody who is both a guest and the organiser gets ONE reminder
 * per offset rather than two.
 */
export async function resolveMeetingAudience(
  facts: MeetingNotificationFacts,
  deps: MeetingNotificationDeps
): Promise<MeetingAudience> {
  const [coreGroup, guests] = await Promise.all([
    deps.listCoreGroup(facts.churchId),
    deps.listGuests(facts.churchId, facts.id),
  ]);

  return {
    coreGroup: [...new Set(coreGroup)],
    reminders: [...new Set([facts.createdBy, ...guests])],
  };
}

/**
 * Bring a meeting's notifications in line with the meeting as it now is.
 *
 * ONE path for create, edit, reschedule and status change, because they are the
 * same operation to F11: cancel what is pending for this meeting, then enqueue
 * what it now owes (N-011). A create is the case where the cancel matched
 * nothing.
 *
 * The scheduled-announcement rides the same path and its key carries no date,
 * which gives the right answer in both directions: a reschedule that cancels a
 * still-pending announcement re-enqueues the SAME key, while a reschedule after
 * that announcement was delivered is swallowed by the delivered row. Either
 * way the Core Group is told once that the meeting exists.
 *
 * `previous` says what the meeting looked like before the write, and it decides
 * only ONE thing — whether the cancel runs:
 *
 *   * `null` — the row was just created, so nothing can be pending.
 *   * a value — cancel only if the notifications would differ
 *     (`meetingNotificationsDiffer`).
 *   * OMITTED — the caller did not read the old row, so the cancel runs
 *     unconditionally. Always safe: at worst an unchanged set is replaced by an
 *     identical one.
 *
 * Never throws.
 */
export async function syncMeetingNotifications(
  churchId: string,
  meetingId: string,
  options: {
    deps?: MeetingNotificationDeps;
    now?: Date;
    previous?: MeetingNotificationFacts | null;
  } = {}
): Promise<MeetingNotifyReport> {
  const deps = options.deps ?? dbMeetingNotificationDeps;
  const report = emptyReport();

  try {
    // Re-read rather than trusting the caller's copy: this runs after the write
    // and the row it must describe is the written one.
    const facts = await deps.loadMeeting(churchId, meetingId);
    if (!facts) {
      // Gone between the write and this call. Nothing can be announced about a
      // meeting that does not exist, so whatever is pending is cancelled — the
      // one case where the cancel runs on its own.
      report.reason = "not_found";
      report.cancelled = await cancelMeetingNotifications(
        churchId,
        meetingId,
        deps
      );
      return report;
    }

    const mustCancel =
      options.previous === undefined
        ? true
        : options.previous !== null &&
          meetingNotificationsDiffer(options.previous, facts);

    if (mustCancel) {
      const cancelled = await deps.cancelByEntity({
        churchId,
        entityType: "meeting",
        entityId: meetingId,
        category: MEETING_NOTIFICATION_CATEGORY,
      });
      report.cancelled = cancelled.cancelledCount;
    }

    const audience = await resolveMeetingAudience(facts, deps);
    const plan = planMeetingNotifications(
      facts,
      audience,
      options.now ?? new Date()
    );
    report.reason = plan.skipped;
    report.considered = plan.notifications.length;

    for (const input of plan.notifications) {
      try {
        const result = await deps.enqueue(input);
        if (result.status === "recorded") {
          report.recorded += 1;
          if (result.created) report.created += 1;
        } else {
          report.skipped += 1;
        }
      } catch (error) {
        // One recipient's failure must not cost the others theirs.
        report.failed += 1;
        console.error("meeting notification enqueue failed", {
          meetingId,
          type: input.type,
          error,
        });
      }
    }
  } catch (error) {
    console.error("meeting notification sync failed", { meetingId, error });
  }

  return report;
}

/**
 * The meeting went away — cancelled or deleted. Cancel every pending row about
 * it, by entity reference, across every recipient.
 *
 * Safe when nothing is pending: it resolves to zero rather than throwing.
 */
export async function cancelMeetingNotifications(
  churchId: string,
  meetingId: string,
  deps: MeetingNotificationDeps = dbMeetingNotificationDeps
): Promise<number> {
  try {
    const result = await deps.cancelByEntity({
      churchId,
      entityType: "meeting",
      entityId: meetingId,
      category: MEETING_NOTIFICATION_CATEGORY,
    });
    return result.cancelledCount;
  } catch (error) {
    console.error("meeting notification cancel failed", { meetingId, error });
    return 0;
  }
}

// ----------------------------------------------------------------------------
// N-014 — the still-live predicate
// ----------------------------------------------------------------------------

/**
 * "Is this meeting still worth announcing?"
 *
 * Read at DISPATCH time, immediately before delivery. It is not a replacement
 * for the cancel above, and the cancel is not a replacement for it: the cancel
 * only moves PENDING rows, so a row a run has already claimed is stopped here
 * and nowhere else.
 *
 * A meeting that is gone, cancelled, completed or already under way is
 * RESOLVED. The read is church-scoped, so a row whose anchor does not own the
 * meeting announces nothing. A read that THROWS is left to throw —
 * `resolveLiveness` defers the notification rather than guessing (N-014).
 */
export function meetingStillLivePredicate(
  deps: MeetingNotificationDeps = dbMeetingNotificationDeps,
  clock: () => Date = () => new Date()
): StillLivePredicate {
  return async (notification) => {
    if (!notification.churchId || !notification.entityId) return false;

    const meeting = await deps.loadMeeting(
      notification.churchId,
      notification.entityId
    );
    if (!meeting) return false;
    if (meeting.status === "cancelled" || meeting.status === "completed") {
      return false;
    }

    return meeting.datetime.getTime() > clock().getTime();
  };
}

/**
 * Register the predicate for every meeting type this module composes.
 *
 * A module-load side effect, the way `src/lib/events/subscriptions.ts` wires
 * event handlers: importing this module arms the check. The loop is over
 * `MEETING_NOTIFICATION_TYPES`, which is derived from the offsets — so a fourth
 * offset cannot ship unregistered.
 */
export function registerMeetingStillLivePredicates(
  deps: MeetingNotificationDeps = dbMeetingNotificationDeps
): void {
  const predicate = meetingStillLivePredicate(deps);
  for (const type of MEETING_NOTIFICATION_TYPES) {
    registerStillLivePredicate(type, predicate);
  }
}

// ----------------------------------------------------------------------------
// Production wiring
// ----------------------------------------------------------------------------

/**
 * The Core Group of one plant, as USER ids.
 *
 * The same person↔user bridge the guest-list read uses, and for the same
 * reason (`guest-list.ts` → VM-018): the Core Group is a set of PEOPLE, and
 * only the ones who also hold a login in this plant can be a notification's
 * recipient. Both sides carry the church id, in the join and in the where.
 *
 * Exported un-awaited so the tenancy of the read can be asserted with
 * `.toSQL()` without a database.
 */
export function coreGroupUserIdsQuery(churchId: string) {
  return db
    .selectDistinct({ userId: users.id })
    .from(persons)
    .innerJoin(
      users,
      and(
        eq(users.churchId, churchId),
        sql`lower(${users.email}) = lower(${persons.email})`
      )
    )
    .where(
      and(
        eq(persons.churchId, churchId),
        inArray(persons.status, [...CORE_GROUP_STATUSES]),
        isNull(persons.deletedAt),
        isNotNull(persons.email)
      )
    );
}

export async function listCoreGroupUserIds(churchId: string) {
  const rows = await coreGroupUserIdsQuery(churchId);
  return [...new Set(rows.map((row) => row.userId))];
}

/**
 * The meeting, with the team name its title may need.
 *
 * A projection of its own rather than a call into `service.ts`: that module
 * imports this one's siblings and a notification read must not be able to
 * cycle back through the service it is called from.
 */
export async function loadMeetingNotificationFacts(
  churchId: string,
  meetingId: string
): Promise<MeetingNotificationFacts | null> {
  const [row] = await db
    .select({
      id: churchMeetings.id,
      churchId: churchMeetings.churchId,
      type: churchMeetings.type,
      title: churchMeetings.title,
      meetingNumber: churchMeetings.meetingNumber,
      teamName: ministryTeams.name,
      datetime: churchMeetings.datetime,
      status: churchMeetings.status,
      createdBy: churchMeetings.createdBy,
    })
    .from(churchMeetings)
    .leftJoin(ministryTeams, eq(churchMeetings.teamId, ministryTeams.id))
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    )
    .limit(1);

  return row ?? null;
}

export const dbMeetingNotificationDeps: MeetingNotificationDeps = {
  enqueue,
  cancelByEntity,
  loadMeeting: loadMeetingNotificationFacts,
  listCoreGroup: listCoreGroupUserIds,
  listGuests: listGuestListUserIds,
};

// The registration itself. Importing this module arms the still-live check for
// every meeting type; `src/lib/meetings/service.ts` imports it on every write
// path, and the dispatcher's own entrypoint must import it too for the check to
// be armed in the cron runtime.
registerMeetingStillLivePredicates();
