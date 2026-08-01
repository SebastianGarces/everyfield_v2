import {
  and,
  count,
  eq,
  gte,
  isNotNull,
  isNull,
  like,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  notifications,
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

/** The `type` every digest row carries. One constant, three readers. */
export const OVERSIGHT_DIGEST_TYPE = "oversight.activity.digest";

/**
 * The digest's identity: one row per (church, day), per recipient.
 *
 * Defined once because THREE things depend on it agreeing — the enqueue that
 * writes it, the partial unique index that arbitrates a replay, and the sweep's
 * "has this plant already been digested today?" query below.
 */
export function digestDedupeKey(churchId: string, dayKey: string): string {
  return `${OVERSIGHT_DIGEST_TYPE}:${churchId}:${dayKey}`;
}

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
      type: OVERSIGHT_DIGEST_TYPE,
      // The DAY, named. Not "today's summary": the digest speaks for a day that
      // is over by the time it is composed (`previousCompleteDayWindow`), it may
      // be retried tomorrow, and a backfill may run it for a day last week. A
      // title that says "today" is wrong in every one of those cases, and the
      // reader has no other way to tell which day the counts belong to.
      title: `${plant.name} — summary for ${formatDate(input.window.from, "short")}`,
      body,
      dedupeKey: digestDedupeKey(input.churchId, dayKey),
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
    // `deleted_at IS NULL` on both this and the task count below, for the same
    // reason the meeting count is narrowed to `completed`: the digest must not
    // report to a third party something the planter cannot see. `persons` and
    // `tasks` are soft-deleted everywhere else in the repo (people/metrics.ts,
    // people/pipeline.ts, tasks/service.ts, ...), so a duplicate person added
    // and deleted ten minutes later on an otherwise quiet day was producing
    // "1 new person" to the oversight org for somebody who exists nowhere in
    // the planter's own app.
    db
      .select({ n: count() })
      .from(persons)
      .where(
        and(
          eq(persons.churchId, churchId),
          isNull(persons.deletedAt),
          inWindow(persons.createdAt)
        )
      ),
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
          isNull(tasks.deletedAt),
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
 * SCHEDULED via `runOversightDigestSweep` below, which the every-15-minute
 * dispatcher tick calls (ruled 2026-08-01). Whatever wires it passes the moment
 * it runs and nothing else.
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

// ----------------------------------------------------------------------------
// The schedule (ruled 2026-08-01) — the dispatcher tick's once-a-day guard
// ----------------------------------------------------------------------------
//
// The digest is a DAILY job, but this app has no daily scheduler it can use:
// `vercel.json` carries the one cron the Hobby plan allows (the phase engine),
// and the notifications dispatcher already ticks every 15 minutes from
// `.github/workflows/notifications-dispatch.yml`. Rather than add a second
// scheduler, the ruling hangs the digest off the tick that already exists —
// which means the tick fires ~96 times a day and the digest must happen once.
//
// ----------------------------------------------------------------------------
// The guard is DERIVED, never remembered
// ----------------------------------------------------------------------------
//
// "Have we already run today?" is answered by the database, not by module state
// or a stored last-run marker. `selectPlantsOwedDigest` asks which plants have
// no digest row for the day being digested; the first productive tick writes
// those rows and every later tick that day selects nothing. So the guard is:
//
//   * correct across instances — serverless has no memory to trust, and two
//     overlapping ticks read the same table rather than two private clocks;
//   * self-healing — a dropped tick (GitHub's scheduler is best-effort) is not
//     a lost digest, because the next tick still sees the plant as owed;
//   * needs no new schema, which matters here: migration 0028 is already
//     applied to a shared Neon branch and this unit adds no DDL.
//
// It is the same idiom the phase engine uses for its own once-a-day property
// (`selectPlantsForAssessment` — dirty-or-stale, derived from what it wrote).
// The final authority is not this query anyway: it is the partial unique index
// on (church_id, recipient_user_id, dedupe_key), so even two ticks racing past
// the selection at the same instant produce one row per recipient
// (memory/invariants.md → Atomicity).
//
// ----------------------------------------------------------------------------
// The cost this design accepts, stated plainly
// ----------------------------------------------------------------------------
//
// A plant that was QUIET yesterday writes no digest row, so it stays "owed" and
// is re-summarised on every tick that day: four bounded, church-scoped,
// date-bounded `count()` queries that write nothing and enqueue nothing. Same
// for a plant with activity whose oversight recipients are all refused by the
// sharing toggle.
//
// The alternative — teaching the selection query what "activity" is, so quiet
// plants never get picked — was rejected: it would put a SECOND definition of
// activity next to `summarizeChurchActivity`, and the two paths that already
// disagreed about what counts (`phaseAdvanceCondition`, above) are why this
// module is careful about that. One definition, a few extra counts.
//
// ============================================================================

/**
 * Plants digested per tick. Bounded like `MAX_DISPATCH_BATCH` and for the same
 * reason: a run has a hard function timeout, and the remainder rolling over to
 * the next tick (15 minutes later) is a delay, not a loss.
 */
export const MAX_DIGEST_SWEEP_BATCH = 25;

/**
 * Wall-clock budget for the sweep, sized to fit in the headroom between the
 * dispatcher's own `RUN_BUDGET_MS` (45s) and the route's `maxDuration` (60s).
 * Crossing it stops between plants; nothing is left half-written, because each
 * plant's digest is its own independent set of enqueues.
 */
export const DIGEST_SWEEP_BUDGET_MS = 10_000;

export interface OversightDigestSweepDeps {
  /** Plants that have oversight and no digest row for `dayKey` yet. */
  selectPlantsOwedDigest(dayKey: string, limit: number): Promise<string[]>;
  /** One plant's digest for one window — `runOversightDigest`, wired. */
  runDigest(
    churchId: string,
    window: ActivityWindow
  ): Promise<OversightDigestOutcome>;
}

/** What one tick's sweep did. Returned for observability, like the dispatcher's. */
export interface OversightDigestSweepSummary {
  /** The day digested — always the last COMPLETE one. */
  dayKey: string;
  /** Plants that still owed a digest when this tick looked. */
  selected: number;
  /** Plants that produced one (a dedupe hit counts: the day is served). */
  digested: number;
  /** Plants that had no activity, so were deliberately not contacted. */
  quiet: number;
  /** Plants that vanished between selection and digest. */
  unknown: number;
  /** Plants whose digest threw. Logged, never rethrown — see below. */
  failed: number;
  /** True when the budget stopped the sweep early; the rest roll over. */
  budgetExhausted: boolean;
  durationMs: number;
}

/**
 * One tick's worth of digesting. Never throws.
 *
 * A failure on one plant is recorded and the sweep continues, and a failure of
 * the sweep as a whole must not fail the dispatcher run it is attached to: the
 * dispatcher's obligation (N-017 — deliver what is due, drop nothing) is
 * time-sensitive, and the digest's is not. Everything a caller needs to know is
 * in the summary rather than in an exception.
 */
export async function runOversightDigestSweep(
  deps: OversightDigestSweepDeps,
  options: {
    at: Date;
    limit?: number;
    budgetMs?: number;
    elapsedMs?: () => number;
  }
): Promise<OversightDigestSweepSummary> {
  const startedAt = Date.now();
  const elapsedMs = options.elapsedMs ?? (() => Date.now() - startedAt);
  const budgetMs = options.budgetMs ?? DIGEST_SWEEP_BUDGET_MS;
  const limit = Math.min(
    Math.max(options.limit ?? MAX_DIGEST_SWEEP_BATCH, 1),
    200
  );

  // ALWAYS the last complete day — the same window `runDailyOversightDigest`
  // uses, and the reason a tick's hour cannot change the answer. 00:15 and
  // 23:45 on the same date digest the same day and agree on every count.
  const window = previousCompleteDayWindow(options.at);
  const dayKey = digestDayKey(window);

  const summary: OversightDigestSweepSummary = {
    dayKey,
    selected: 0,
    digested: 0,
    quiet: 0,
    unknown: 0,
    failed: 0,
    budgetExhausted: false,
    durationMs: 0,
  };

  const owed = await deps.selectPlantsOwedDigest(dayKey, limit);
  summary.selected = owed.length;

  for (const churchId of owed) {
    if (elapsedMs() >= budgetMs) {
      summary.budgetExhausted = true;
      break;
    }

    try {
      const outcome = await deps.runDigest(churchId, window);
      if (outcome.status === "enqueued") summary.digested += 1;
      else if (outcome.reason === "no_activity") summary.quiet += 1;
      else summary.unknown += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[notifications/oversight-digest] plant failed", {
        churchId,
        dayKey,
        error,
      });
    }
  }

  summary.durationMs = elapsedMs();
  return summary;
}

/**
 * Which plants still owe a digest for `dayKey`.
 *
 * Two conditions, and neither is a privacy decision:
 *
 *   1. The plant has OVERSIGHT at all — a `sending_church_id` or a
 *      `sending_network_id`. A plant with neither has nobody to digest to, and
 *      `fanOutToOversight` would consider zero recipients. Both FKs are
 *      nullable (memory/invariants.md → Multi-Tenancy).
 *   2. No digest row exists for this church and this day.
 *
 * Note what is NOT here: `church_privacy_settings`. Whether the plant is
 * sharing stays `enqueue`'s question, asked per recipient at the moment the row
 * would be written — see the header of `./oversight.ts`. Putting it here would
 * be a second copy of the gate, and a flip would then take effect at the next
 * SELECT instead of the next enqueue.
 *
 * The day match is a suffix `LIKE` on a key this module builds (`YYYY-MM-DD`,
 * no wildcard characters), narrowed by `church_id` and `type` first — it reads
 * the day out of the key rather than concatenating a uuid column into SQL.
 */
export async function selectPlantsOwedDigest(
  dayKey: string,
  limit: number
): Promise<string[]> {
  const rows = await db
    .select({ id: churches.id })
    .from(churches)
    .where(
      and(
        or(
          isNotNull(churches.sendingChurchId),
          isNotNull(churches.sendingNetworkId)
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(notifications)
            .where(
              and(
                eq(notifications.churchId, churches.id),
                eq(notifications.type, OVERSIGHT_DIGEST_TYPE),
                like(notifications.dedupeKey, `%:${dayKey}`)
              )
            )
        )
      )
    )
    // Stable, so a fleet larger than one batch is swept in a repeatable order
    // and the remainder is reached by the following ticks.
    .orderBy(churches.id)
    .limit(limit);

  return rows.map((row) => row.id);
}

export const dbOversightDigestSweepDeps: OversightDigestSweepDeps = {
  selectPlantsOwedDigest,
  runDigest: (churchId, window) =>
    runOversightDigest(dbOversightDigestDeps, { churchId, window }),
};

/**
 * The wired-up entrypoint the dispatcher tick calls.
 *
 * `at` is "when the tick fired". Everything else — which day, which plants —
 * is derived from it and from what is already in the database.
 */
export function runDailyOversightDigestSweep(
  at: Date = new Date()
): Promise<OversightDigestSweepSummary> {
  return runOversightDigestSweep(dbOversightDigestSweepDeps, { at });
}
