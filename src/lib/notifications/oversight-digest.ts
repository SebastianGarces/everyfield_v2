import { and, count, eq, gte, isNotNull, lt } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  persons,
  phaseTransitions,
  tasks,
} from "@/db/schema";
import { APP_TIME_ZONE, formatDate } from "@/lib/datetime";

import {
  enqueue,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "./enqueue";
import { phaseAdvanceCondition } from "./oversight-events";
import {
  fanOutToOversight,
  listOversightRecipientsForChurch,
  type OversightFanOutReport,
  type OversightRecipient,
} from "./oversight";

// ============================================================================
// The oversight activity digest (N-025, ruled 2026-07-27).
//
// ONE notification per oversight recipient per plant per day, carrying COUNTS
// of what happened — and only on a day something did.
//
// ----------------------------------------------------------------------------
// "Only when there was activity" is the requirement, not an optimisation
// ----------------------------------------------------------------------------
//
// A digest that arrives every day whether or not anything happened trains its
// reader to stop opening it, and then the day something DID happen is the day
// it goes unread. So a quiet plant produces no row at all: not an empty digest,
// not a "nothing to report" digest. `summarizeActivity` returns a total, and a
// total of zero returns `{ enqueued: 0, reason: "no_activity" }` having called
// `enqueue` zero times — which is what the acceptance criterion counts.
//
// ----------------------------------------------------------------------------
// A COMPLETE day, never a partial one
// ----------------------------------------------------------------------------
//
// The digest's dedupe key is `(church, day)` and the partial unique index makes
// the first row written for that day final. So the window must be a day whose
// counts can no longer change: `runDailyOversightDigest` always digests the day
// BEFORE the moment it is handed, and there is deliberately no way to ask it
// for a day in progress. See `previousCompleteDayWindow`.
//
// ----------------------------------------------------------------------------
// Counts, not contents
// ----------------------------------------------------------------------------
//
// The summary is "3 people, 1 meeting, 5 tasks finished". It never names a
// person, quotes a note, or lists a task, because that is precisely the
// item-level feature copy memory/invariants.md → Hierarchical Access Control
// keeps away from oversight, and because the toggle's own copy
// (`OVERSIGHT_SHARING_TOGGLE` in `./categories.ts`) promises a summary. The
// promise and the query have to agree, so the query only ever asks `count()`.
//
// ----------------------------------------------------------------------------
// Enqueue is still the gate
// ----------------------------------------------------------------------------
//
// Nothing here reads `church_privacy_settings`. A plant that is not sharing
// produces a fully composed digest that `enqueue` then refuses per recipient,
// writing nothing — and flipping the toggle on changes the very next run's
// outcome with no other moving part. See the header of `./oversight.ts`.
// ============================================================================

/** Half-open `[from, to)`. One day, in `APP_TIME_ZONE`, unless a caller says otherwise. */
export interface ActivityWindow {
  from: Date;
  to: Date;
}

/**
 * What happened, as counts. Every field is a non-negative integer and the
 * whole point of the type is that none of them is a list.
 */
export interface OversightActivitySummary {
  peopleAdded: number;
  meetingsHeld: number;
  tasksCompleted: number;
  stagesReached: number;
}

/** Total events in the window — the "was there activity?" answer. */
export function totalActivity(summary: OversightActivitySummary): number {
  return (
    summary.peopleAdded +
    summary.meetingsHeld +
    summary.tasksCompleted +
    summary.stagesReached
  );
}

/**
 * The digest body: one line per non-zero count, in a fixed order.
 *
 * Zero counts are omitted rather than printed as "0 meetings" — a reader
 * skimming an email wants the two things that happened, not the two that did
 * and the two that did not.
 */
export function composeDigestBody(summary: OversightActivitySummary): string {
  const parts: string[] = [];
  const line = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };

  line(summary.meetingsHeld, "meeting", "meetings");
  line(summary.peopleAdded, "new person", "new people");
  line(summary.tasksCompleted, "task finished", "tasks finished");
  line(summary.stagesReached, "new stage", "new stages");

  return parts.join(", ") + ".";
}

const MS_PER_DAY = 86_400_000;

/**
 * The day a digest speaks for, as `YYYY-MM-DD` in `APP_TIME_ZONE`.
 *
 * This is the digest's IDENTITY, not a label: it is half the dedupe key, so
 * "which day is this" has to be answered the same way on every machine.
 * memory/invariants.md → Date & Time Rendering forbids reading the runtime's
 * zone for exactly this reason, and `Intl` pinned to `APP_TIME_ZONE` is the
 * repo's answer. `en-CA` yields `YYYY-MM-DD` directly.
 */
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKeyInAppZone(at: Date): string {
  return dayKeyFormatter.format(at);
}

export function digestDayKey(window: ActivityWindow): string {
  return dayKeyInAppZone(window.from);
}

/**
 * The window for the day `at` falls in, in `APP_TIME_ZONE`.
 *
 * Valid because `APP_TIME_ZONE` is UTC, whose days are exactly 24h and aligned
 * to the epoch — the same assumption `relativeDayOffset` in
 * `src/lib/datetime.ts` states and relies on. A zone with DST would need a
 * calendar-aware boundary, and adding one means changing both places together.
 */
export function activityWindowForDay(at: Date): ActivityWindow {
  const from = new Date(`${dayKeyInAppZone(at)}T00:00:00.000Z`);
  return { from, to: new Date(from.getTime() + MS_PER_DAY) };
}

/**
 * The last day that is OVER, relative to `at`. The only window a scheduled
 * daily run may use.
 *
 * A daily job that digests the day it is running in reports a fraction of it
 * and then cannot correct itself, because the digest's dedupe key is
 * `(church, day)` and the partial unique index makes the first row for that day
 * final (memory/invariants.md → Atomicity). A 07:00 run would freeze
 * "00:00–07:00" as the whole of that day forever, and a run that found nothing
 * yet would return `no_activity` — so a day WITH activity would produce NO
 * digest, which inverts the acceptance criterion this feature is built around.
 *
 * A complete day has no such hazard: every count is final before the query
 * runs, so the hour the job fires cannot change the answer, and a retry an hour
 * later (or a re-run days later) produces the same numbers.
 */
export function previousCompleteDayWindow(at: Date): ActivityWindow {
  const today = activityWindowForDay(at);
  return {
    from: new Date(today.from.getTime() - MS_PER_DAY),
    to: today.from,
  };
}

// ----------------------------------------------------------------------------
// The run
// ----------------------------------------------------------------------------

export interface OversightDigestDeps {
  loadPlant(churchId: string): Promise<{ id: string; name: string } | null>;
  summarizeActivity(
    churchId: string,
    window: ActivityWindow
  ): Promise<OversightActivitySummary>;
  listOversightRecipients(churchId: string): Promise<OversightRecipient[]>;
  enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult>;
}

export type OversightDigestOutcome =
  | { status: "enqueued"; report: OversightFanOutReport; dayKey: string }
  | {
      status: "skipped";
      reason: "no_activity" | "unknown_plant";
      dayKey: string;
    };

/**
 * Run one plant's digest for one day.
 *
 * Idempotent: the dedupe key is `(church, day)`, so running the job twice on
 * the same day writes one row per recipient, not two — the partial unique index
 * decides that, not this function's memory of having run
 * (memory/invariants.md → Atomicity).
 */
export async function runOversightDigest(
  deps: OversightDigestDeps,
  input: { churchId: string; window: ActivityWindow }
): Promise<OversightDigestOutcome> {
  const dayKey = digestDayKey(input.window);

  const plant = await deps.loadPlant(input.churchId);
  if (!plant) return { status: "skipped", reason: "unknown_plant", dayKey };

  const summary = await deps.summarizeActivity(input.churchId, input.window);

  // The whole requirement, in one branch: no activity, no contact. Note that
  // `enqueue` has not been called at this point and will not be.
  if (totalActivity(summary) === 0) {
    return { status: "skipped", reason: "no_activity", dayKey };
  }

  const body = composeDigestBody(summary);

  // `deps` itself, not a two-field object built from it: picking the two
  // methods off would unbind them, so any implementation holding state on
  // `this` (a fake, or a future pooled client) would break in a way the types
  // do not catch. `OversightDigestDeps` already satisfies `OversightFanOutDeps`
  // structurally.
  const report = await fanOutToOversight(
    deps,
    input.churchId,
    (recipientUserId) => ({
      churchId: input.churchId,
      recipientUserId,
      category: "digest",
      type: "oversight.activity.digest",
      // The DAY, named. Not "today's summary": the digest speaks for a day that
      // is over by the time it is composed (`previousCompleteDayWindow`), it may
      // be retried tomorrow, and a backfill may run it for a day last week. A
      // title that says "today" is wrong in every one of those cases, and the
      // reader has no other way to tell which day the counts belong to.
      title: `${plant.name} — summary for ${formatDate(input.window.from, "short")}`,
      body,
      dedupeKey: `oversight.activity.digest:${input.churchId}:${dayKey}`,
    })
  );

  return { status: "enqueued", report, dayKey };
}

// ----------------------------------------------------------------------------
// Production wiring
// ----------------------------------------------------------------------------

/**
 * Four counts, four bounded `count()` queries, all `church_id`-scoped.
 *
 * Deliberately counts rather than reads: there is no code path here that could
 * put a person's name or a task's title into a digest even by accident, because
 * no row body is ever loaded.
 */
export async function summarizeChurchActivity(
  churchId: string,
  window: ActivityWindow
): Promise<OversightActivitySummary> {
  const inWindow = (column: Parameters<typeof gte>[0]) =>
    and(gte(column, window.from), lt(column, window.to));

  const [people, meetings, finishedTasks, stages] = await Promise.all([
    db
      .select({ n: count() })
      .from(persons)
      .where(and(eq(persons.churchId, churchId), inWindow(persons.createdAt))),
    // "Meetings HELD" — the toggle's copy promises that exact word, so the
    // query has to mean it. `church_meetings.status` starts at `planning` and
    // can reach `cancelled`, so filtering on the datetime alone reported a
    // meeting cancelled at 09:00 for a 19:00 slot to the sending church as a
    // meeting that happened. Overstating a plant's activity to a third party
    // under a consent control is the exact failure this feature exists to
    // prevent, so the count is narrowed to `completed`.
    //
    // `completed` rather than `actual_attendance IS NOT NULL` (finalizeAttendance's
    // idempotency marker, memory/invariants.md → Atomicity): attendance is a
    // separate, optional step, so keying on it would report 0 meetings for a
    // plant that meets weekly and never counts heads. `completed` is the
    // planter's own statement that the meeting happened — the right authority
    // for a fact told to their oversight partner. Both rules can only UNDER-
    // report, which is the safe direction here; a meeting still sitting at
    // `in_progress` when the day closes is simply not counted.
    db
      .select({ n: count() })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.churchId, churchId),
          eq(churchMeetings.status, "completed"),
          inWindow(churchMeetings.datetime)
        )
      ),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          isNotNull(tasks.completedAt),
          inWindow(tasks.completedAt)
        )
      ),
    // ADVANCES only, via the same predicate the milestone emitter judges a
    // single event with (`phaseAdvanceCondition`, beside `isPhaseAdvance` in
    // `./oversight-events.ts`). Counting every transition made a planter's
    // correction from stage 3 back to 2 read as "1 new stage" — the milestone
    // path withholding a regression on purpose while the digest path announced
    // it as its opposite. One rule, one place, two expressions of it.
    db
      .select({ n: count() })
      .from(phaseTransitions)
      .where(
        and(
          eq(phaseTransitions.churchId, churchId),
          phaseAdvanceCondition(),
          inWindow(phaseTransitions.createdAt)
        )
      ),
  ]);

  return {
    peopleAdded: people[0]?.n ?? 0,
    meetingsHeld: meetings[0]?.n ?? 0,
    tasksCompleted: finishedTasks[0]?.n ?? 0,
    stagesReached: stages[0]?.n ?? 0,
  };
}

export const dbOversightDigestDeps: OversightDigestDeps = {
  async loadPlant(churchId) {
    const [plant] = await db
      .select({ id: churches.id, name: churches.name })
      .from(churches)
      .where(eq(churches.id, churchId))
      .limit(1);
    return plant ?? null;
  },
  summarizeActivity: summarizeChurchActivity,
  listOversightRecipients: listOversightRecipientsForChurch,
  enqueue,
};

/**
 * The wired-up production entrypoint: digest one plant's LAST COMPLETE DAY.
 *
 * `at` is "when the job is running", not "which day to report" — the window is
 * always the day before the one `at` falls in. So the hour a scheduler fires
 * cannot change the answer: 01:00 and 23:00 on the same date digest the same
 * day and produce the same counts, and a retry is a genuine no-op rather than a
 * second, different opinion frozen by the dedupe key.
 *
 * To digest some other day (a backfill, a test), call `runOversightDigest` with
 * an explicit window. There is deliberately no way to ask this function for a
 * day still in progress.
 *
 * NOT YET SCHEDULED. Nothing in `vercel.json` calls this — see the PR body for
 * issue #224; the cron entry and its route are a follow-up. Whatever wires it
 * must pass the moment it runs and nothing else.
 */
export function runDailyOversightDigest(
  churchId: string,
  at: Date = new Date()
): Promise<OversightDigestOutcome> {
  return runOversightDigest(dbOversightDigestDeps, {
    churchId,
    window: previousCompleteDayWindow(at),
  });
}
