import {
  and,
  count,
  eq,
  exists,
  gt,
  gte,
  isNotNull,
  isNull,
  like,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  churchPrivacySettings,
  notifications,
  persons,
  phaseTransitions,
  tasks,
  users,
} from "@/db/schema";
import { APP_TIME_ZONE, formatDate } from "@/lib/datetime";

import {
  enqueue,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "./enqueue";
import { phaseAdvanceCondition } from "./oversight-events";
import {
  listOversightRecipientsForChurch,
  oversightAudienceCondition,
  type OversightAudience,
} from "./oversight-audience";
import { fanOutToOversight, type OversightFanOutReport } from "./oversight";

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
  phasesReached: number;
}

/** Total events in the window — the "was there activity?" answer. */
export function totalActivity(summary: OversightActivitySummary): number {
  return (
    summary.peopleAdded +
    summary.meetingsHeld +
    summary.tasksCompleted +
    summary.phasesReached
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
  line(summary.phasesReached, "phase change", "phase changes");

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
  listOversightRecipients(churchId: string): Promise<OversightAudience>;
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
 * A church id, either as a literal or as a COLUMN to correlate against.
 *
 * The four conditions below are asked two different ways — counted for one
 * named plant (`summarizeChurchActivity`) and tested as `EXISTS` inside the
 * sweep's plant selection, where the church is `churches.id` of the outer row.
 * Accepting both is what lets there be ONE definition of activity instead of
 * two that can drift apart.
 */
type ChurchIdRef = string | typeof churches.id;

/**
 * WHAT COUNTS AS ACTIVITY — defined once, in four conditions.
 *
 * Every one of them is used twice: by the `count()` that composes a digest body
 * and by the `EXISTS` that decides whether a plant is worth sweeping at all.
 * That is the whole reason they are extracted. The module used to argue against
 * teaching the selection query what activity is, on the grounds that it would
 * create a SECOND definition next to `summarizeChurchActivity` — and it was
 * right about the hazard and wrong about the remedy. Sharing the conditions
 * removes the hazard; refusing to narrow the selection cost liveness (see the
 * sweep header below).
 */
function inWindow(
  column: Parameters<typeof gte>[0],
  window: ActivityWindow
): SQL | undefined {
  return and(gte(column, window.from), lt(column, window.to));
}

/**
 * `deleted_at IS NULL` here and on tasks below, for the same reason the meeting
 * condition is narrowed to `completed`: the digest must not report to a third
 * party something the planter cannot see. `persons` and `tasks` are
 * soft-deleted everywhere else in the repo (people/metrics.ts,
 * people/pipeline.ts, tasks/service.ts, ...), so a duplicate person added and
 * deleted ten minutes later on an otherwise quiet day was producing "1 new
 * person" to the oversight org for somebody who exists nowhere in the planter's
 * own app.
 */
function personAddedCondition(churchId: ChurchIdRef, window: ActivityWindow) {
  return and(
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
    inWindow(persons.createdAt, window)
  );
}

/**
 * "Meetings HELD" — the toggle's copy promises that exact word, so the query
 * has to mean it. `church_meetings.status` starts at `planning` and can reach
 * `cancelled`, so filtering on the datetime alone reported a meeting cancelled
 * at 09:00 for a 19:00 slot to the sending church as a meeting that happened.
 * Overstating a plant's activity to a third party under a consent control is
 * the exact failure this feature exists to prevent.
 *
 * `completed` rather than `actual_attendance IS NOT NULL`
 * (finalizeAttendance's idempotency marker, memory/invariants.md → Atomicity):
 * attendance is a separate, optional step, so keying on it would report 0
 * meetings for a plant that meets weekly and never counts heads. `completed` is
 * the planter's own statement that the meeting happened — the right authority
 * for a fact told to their oversight partner. Both rules can only UNDER-report,
 * which is the safe direction here.
 */
function meetingHeldCondition(churchId: ChurchIdRef, window: ActivityWindow) {
  return and(
    eq(churchMeetings.churchId, churchId),
    eq(churchMeetings.status, "completed"),
    inWindow(churchMeetings.datetime, window)
  );
}

function taskFinishedCondition(churchId: ChurchIdRef, window: ActivityWindow) {
  return and(
    eq(tasks.churchId, churchId),
    isNull(tasks.deletedAt),
    isNotNull(tasks.completedAt),
    inWindow(tasks.completedAt, window)
  );
}

/**
 * ADVANCES only, via the same predicate the milestone emitter judges a single
 * event with (`phaseAdvanceCondition`, beside `isPhaseAdvance` in
 * `./oversight-events.ts`). Counting every transition made a planter's
 * correction from phase 3 back to 2 read as "1 phase change" — the milestone path
 * withholding a regression on purpose while the digest path announced it as its
 * opposite. One rule, one place.
 */
function phaseReachedCondition(churchId: ChurchIdRef, window: ActivityWindow) {
  return and(
    eq(phaseTransitions.churchId, churchId),
    phaseAdvanceCondition(),
    inWindow(phaseTransitions.createdAt, window)
  );
}

/**
 * "Did ANYTHING happen for this plant in this window?" as one correlated
 * `EXISTS ... OR EXISTS ...`, built from the four conditions above.
 *
 * Short-circuiting by construction: Postgres stops at the first `EXISTS` that
 * matches, so an active plant costs one index probe rather than four counts.
 * `totalActivity(summarizeChurchActivity(...)) > 0` and this predicate are the
 * same question by construction — they are the same SQL — which is the property
 * the sweep relies on when it uses this to skip a plant it would otherwise have
 * summarised and discarded.
 */
function hasActivityCondition(
  churchId: ChurchIdRef,
  window: ActivityWindow
): SQL | undefined {
  return or(
    exists(
      db
        .select({ one: sql`1` })
        .from(persons)
        .where(personAddedCondition(churchId, window))
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(churchMeetings)
        .where(meetingHeldCondition(churchId, window))
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(tasks)
        .where(taskFinishedCondition(churchId, window))
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(phaseTransitions)
        .where(phaseReachedCondition(churchId, window))
    )
  );
}

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
  const [people, meetings, finishedTasks, phases] = await Promise.all([
    db
      .select({ n: count() })
      .from(persons)
      .where(personAddedCondition(churchId, window)),
    db
      .select({ n: count() })
      .from(churchMeetings)
      .where(meetingHeldCondition(churchId, window)),
    db
      .select({ n: count() })
      .from(tasks)
      .where(taskFinishedCondition(churchId, window)),
    db
      .select({ n: count() })
      .from(phaseTransitions)
      .where(phaseReachedCondition(churchId, window)),
  ]);

  return {
    peopleAdded: people[0]?.n ?? 0,
    meetingsHeld: meetings[0]?.n ?? 0,
    tasksCompleted: finishedTasks[0]?.n ?? 0,
    phasesReached: phases[0]?.n ?? 0,
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
// `vercel.json` carries no crons at all (the Hobby plan's one-a-day limit is
// too coarse for every job this repo has), and the dispatcher already ticks
// every 15 minutes from
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
//   * needs no new schema, which matters here: migration 0029 is already
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
// WHY "OWED" HAS TO MEAN "WILL ACTUALLY PRODUCE A DIGEST" (the starvation fix)
// ----------------------------------------------------------------------------
//
// The first version of this sweep took the first N owed plants by id on every
// tick and trusted the remainder to "roll over". That was wrong, and the way it
// was wrong is worth keeping written down, because the shape recurs anywhere a
// worklist is drained by writing a row:
//
//   A plant leaves the owed set ONLY by having a digest row written for it. So
//   a plant that can never write one — quiet yesterday, sharing switched off
//   (the default for every plant until it opts in), no oversight admins at the
//   org — stays owed all day AND, because the ordering is stable, keeps its
//   place at the head of it. With 25 such plants ahead of it, plant #26 was
//   never reached on any of the day's 96 ticks. Nothing surfaced it either:
//   `selected: 25` reads identically on a healthy sweep and a starved one.
//
// Two changes, and both are needed:
//
//   1. THE SELECTION EXCLUDES WHAT CANNOT PRODUCE A DIGEST. A plant is only
//      offered if it is sharing, has at least one oversight admin, and actually
//      had activity in the window. Those three are exactly the reasons a plant
//      could sit owed forever, and none of them can change for a day that is
//      already over — except the toggle, which is re-read on the very next tick
//      15 minutes later. The owed set therefore SHRINKS monotonically through
//      the day, which is what makes "the remainder rolls over" true instead of
//      hopeful.
//
//      The old comment here argued against this on the grounds that it would
//      create a SECOND definition of activity next to `summarizeChurchActivity`
//      and a second copy of the sharing gate. It was right about both hazards
//      and wrong about the remedy: the activity conditions are now shared
//      literally (`hasActivityCondition`, built from the same four conditions
//      the counts use), and the sharing clause here is a NARROWING, not a gate
//      — `enqueue` still decides, per recipient, at the moment of writing, and
//      is still the only thing that can refuse. A narrowing that is wrong costs
//      a wasted scan; the gate being wrong would cost consent, and the gate has
//      not moved.
//
//   2. THE BATCH BOUNDS THE WORK, NOT THE WINDOW. Within a tick the sweep
//      KEYSET-pages (`id > last id reached`) until the owed set is exhausted or
//      a budget stops it. The cursor advances past a plant whose digest THREW,
//      too — which is the one remaining way a plant can stay owed after change
//      1, and without this it would be a head-of-line block on the plants
//      behind it. A failure is retried on the next tick, from a fresh scan.
//
// What is deliberately NOT here is a stored cursor. Progress across ticks is
// still DERIVED — from the digest rows themselves plus a selection that only
// offers plants which will write one — so there is no watermark to keep in step
// with reality, and a dropped tick is still a delay rather than a loss.
//
// ----------------------------------------------------------------------------
// The cost this design accepts, stated plainly
// ----------------------------------------------------------------------------
//
// Selection got more expensive: four correlated `EXISTS` probes per candidate
// plant instead of none. They are short-circuiting (`OR`), church-and-date
// bounded, and they replace four unconditional `count()` queries per quiet
// plant per tick — 96 times a day, for every quiet plant, under the old shape.
// The trade is strictly favourable and it buys a liveness property.
//
// ============================================================================

/**
 * Plants selected per PAGE. The sweep keyset-pages through the owed set within
 * a tick, so this bounds one round trip, not the day's work — that is
 * `MAX_DIGEST_SWEEP_PLANTS` and the wall-clock budget below.
 */
export const MAX_DIGEST_SWEEP_BATCH = 25;

/**
 * Hard ceiling on plants CONSIDERED in one tick. A backstop, not the usual
 * limit: with the selection narrowed to plants that will genuinely produce a
 * digest, a real fleet is exhausted long before this. Its job is to keep one
 * pathological tick from running the dispatcher's clock out.
 */
export const MAX_DIGEST_SWEEP_PLANTS = 500;

/**
 * FALLBACK wall-clock budget, for a caller that names none.
 *
 * It is NOT a headroom calculation and must never become one again: the sweep
 * shares one deadline with everything else in the tick, so the scheduled caller
 * passes `budgetMs` computed from what is actually left of `TICK_DEADLINE_MS`
 * (`/api/notifications/dispatch/route.ts`). Two constants each sized against the
 * same leftover is how the tick came to budget 65s against a 60s ceiling.
 *
 * Crossing the budget stops between plants; nothing is left half-written,
 * because each plant's digest is its own independent set of enqueues.
 */
export const DIGEST_SWEEP_BUDGET_MS = 10_000;

/** One page of the owed set, keyset-anchored. */
export interface OwedDigestPageQuery {
  dayKey: string;
  /** The window the day's activity is judged in — half of "is this plant owed". */
  window: ActivityWindow;
  /** Page size. */
  limit: number;
  /** Keyset anchor: only plants with a GREATER id. `null` starts the scan. */
  afterChurchId: string | null;
}

export interface OversightDigestSweepDeps {
  /**
   * Plants that will produce a digest for `dayKey` and have not yet — one
   * keyset page at a time, ascending by church id.
   */
  selectPlantsOwedDigest(query: OwedDigestPageQuery): Promise<string[]>;
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
  /** Plants offered across every page this tick read. */
  selected: number;
  /**
   * Plants this tick actually reached and attempted. Equal to `selected` unless
   * a budget stopped the walk — which is precisely the signal the old summary
   * could not give: a starved sweep and a healthy one both reported `selected`.
   */
  plantsScanned: number;
  /** Keyset pages read. `>1` means the fleet outgrew one batch and was followed. */
  pages: number;
  /** Plants that produced one (a dedupe hit counts: the day is served). */
  digested: number;
  /**
   * Plants that turned out to have no activity after all. Normally zero — the
   * selection excludes quiet plants — so a non-zero value means activity was
   * soft-deleted between the scan and the digest, which is legitimate and rare.
   */
  quiet: number;
  /** Plants that vanished between selection and digest. */
  unknown: number;
  /** Plants whose digest threw. Logged, never rethrown — see below. */
  failed: number;
  /** True when a budget stopped the sweep early; the rest roll over. */
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
    /** Page size. Defaults to `MAX_DIGEST_SWEEP_BATCH`. */
    limit?: number;
    /** Plants considered in this tick, across pages. */
    maxPlants?: number;
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
  const maxPlants = Math.max(
    options.maxPlants ?? MAX_DIGEST_SWEEP_PLANTS,
    limit
  );

  // ALWAYS the last complete day — the same window `runDailyOversightDigest`
  // uses, and the reason a tick's hour cannot change the answer. 00:15 and
  // 23:45 on the same date digest the same day and agree on every count.
  const window = previousCompleteDayWindow(options.at);
  const dayKey = digestDayKey(window);

  const summary: OversightDigestSweepSummary = {
    dayKey,
    selected: 0,
    plantsScanned: 0,
    pages: 0,
    digested: 0,
    quiet: 0,
    unknown: 0,
    failed: 0,
    budgetExhausted: false,
    durationMs: 0,
  };

  // The keyset cursor. It advances on EVERY plant the sweep reaches, including
  // one whose digest threw — a failure must not become a head-of-line block on
  // the plants behind it. The failed plant is still owed and is retried by the
  // next tick, which starts a fresh scan from the beginning.
  let afterChurchId: string | null = null;

  walk: while (summary.plantsScanned < maxPlants) {
    if (elapsedMs() >= budgetMs) {
      summary.budgetExhausted = true;
      break;
    }

    let page: string[];
    try {
      page = await deps.selectPlantsOwedDigest({
        dayKey,
        window,
        limit,
        afterChurchId,
      });
    } catch (error) {
      // "Never throws" has to include the SELECT. The dispatcher run this rides
      // on has already sent email by the time the sweep starts; turning a
      // database blip here into a 500 would report a successful delivery run as
      // a failure and invite a retry of work that is already done.
      summary.failed += 1;
      console.error("[notifications/oversight-digest] selection failed", {
        dayKey,
        afterChurchId,
        error,
      });
      break;
    }

    summary.pages += 1;
    summary.selected += page.length;
    if (page.length === 0) break;

    for (const churchId of page) {
      if (elapsedMs() >= budgetMs) {
        summary.budgetExhausted = true;
        break walk;
      }

      afterChurchId = churchId;
      summary.plantsScanned += 1;

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

      if (summary.plantsScanned >= maxPlants) {
        summary.budgetExhausted = true;
        break walk;
      }
    }

    // A short page is the end of the owed set — nothing further to follow.
    if (page.length < limit) break;
  }

  summary.durationMs = elapsedMs();
  return summary;
}

/**
 * `users` under a second name, so clause 4's correlated probe can name the
 * candidate recipient in its own inner `NOT EXISTS` without colliding with any
 * other reference to the table in the same statement.
 */
const owedDigestRecipient = alias(users, "owed_digest_recipient");

/**
 * Clause 4's audience, CORRELATED with the outer `churches` row — the SQL HALF
 * of the pairing, and the fan-out answers the same question in TypeScript.
 *
 * "Who is owed a row" and "who will be written one" are ONE DECISION IN TWO
 * ENCODINGS, not one predicate: a `WHERE` cannot call a TypeScript function, so
 * this correlated condition is `oversightAudienceCondition` while
 * `listOversightRecipientsForChurch` resolves its rows through
 * `classifyOversightCandidate` (both in `./oversight-audience.ts`). Both read
 * their arms off `OVERSIGHT_ADMIN`, and the tie is a test rather than this
 * sentence — `oversight-audience.test.ts` walks the pairing table and fails if
 * either half is edited alone. Drift between the two is what starved a plant of
 * its digest before the table existed.
 *
 * ACCEPTED RESIDUAL, because this clause uses the PAIRED audience: a plant whose
 * only oversight `users` row is cross-paired is never selected here, so the
 * fan-out never runs for it and its misprovisioned row is never counted. The
 * defect reaches the log through the milestone fan-outs, which call the lister
 * directly, and not through the digest.
 *
 * THE `SQL` ANNOTATION IS THE GUARD, not decoration: an `SQL | undefined`
 * audience reaching the `and()` below deletes itself from the statement and
 * every plant is owed a digest forever (`memory/invariants.md` → Multi-Tenancy;
 * `oversightAudienceCondition`'s header for the overloads). The correlated refs
 * are columns and never null, so the non-nullable overload applies and the
 * annotation makes a later edit to a nullable ref fail HERE.
 *
 * The two `churches` columns ARE written out: this is the one correspondence
 * `OVERSIGHT_ADMIN` does not hold — which column of the PLANT stands for each
 * `users` FK — so a third org kind must fail here until somebody names it.
 */
const owedDigestAudience: SQL = oversightAudienceCondition(
  owedDigestRecipient,
  {
    sendingChurchId: churches.sendingChurchId,
    sendingNetworkId: churches.sendingNetworkId,
  }
);

/**
 * One keyset page of the plants that still owe a digest for `dayKey`.
 *
 * "Owed" means WILL PRODUCE A DIGEST, not merely "has not got one yet" — the
 * distinction the starvation fix turns on (see the module header). The four
 * conditions are numbered in the body; each carries its own note, and clause 4
 * carries the two that are not local: it is per RECIPIENT because the fan-out
 * swallows a per-recipient throw, so a plant with a partially-written day used
 * to be marked served forever; and asking per recipient SUBSUMES the old "has
 * any admin" clause, since an org with no admins has nobody to be missing a row.
 *
 * A builder rather than an inlined statement because clause 4 is the one
 * predicate in this module that decides LIVENESS — a plant it offers but that
 * can never be written a digest row is offered again on every tick, forever.
 * That property lives in the rendered SQL, so it has to be readable as SQL, and
 * `.toSQL()` asserts it without a live Postgres (the same way `./queries.ts`
 * exports every feed builder).
 */
export function plantsOwedDigestQuery(query: OwedDigestPageQuery) {
  return db
    .select({ id: churches.id })
    .from(churches)
    .where(
      and(
        // 1 — has oversight
        or(
          isNotNull(churches.sendingChurchId),
          isNotNull(churches.sendingNetworkId)
        ),
        // 2 — sharing is on. No settings row at all means not sharing, which is
        // the correct reading of an opt-in control.
        exists(
          db
            .select({ one: sql`1` })
            .from(churchPrivacySettings)
            .where(
              and(
                eq(churchPrivacySettings.churchId, churches.id),
                eq(churchPrivacySettings.shareActivityWithOversight, true)
              )
            )
        ),
        // 3 — there is something to report
        hasActivityCondition(churches.id, query.window),
        // 4 — at least one oversight recipient of this plant is still missing
        // this day's digest. `=` against a NULL FK yields NULL, so a plant with
        // only one of the two FKs matches recipients only on the one it has.
        //
        // The audience is `owedDigestAudience` — see its docblock above for
        // why it is the fan-out's own builder and why it is annotated `SQL`.
        //
        // WHAT SITS BESIDE EACH FK CHANGED WITH #494, and the old note here is
        // no longer true of this SQL. There used to be no floor at all: each
        // arm was `role = <the org's admin role> and <fk> = …`, and the note
        // said a bare `inArray(role, OVERSIGHT_ROLES)` must not be added back
        // because it would silently AND a mis-edited arm to zero. With the role
        // column dropped each arm now carries the REST OF THE
        // EXACTLY-ONE-TENANCY RULE instead — `church_id is null` and every
        // other oversight FK null — derived from `OVERSIGHT_ADMIN_ROWS` rather
        // than written here. That is not a floor over a role list; it is the
        // SQL half of `oversightOrgOf`, and widening it back to the FK alone
        // re-admits a row with a competing claim on another tenancy.
        //
        // The day match is a suffix `LIKE` on a key this module builds
        // (`YYYY-MM-DD`, no wildcard characters), narrowed by `church_id`,
        // `recipient_user_id` and `type` first — it reads the day out of the
        // key rather than concatenating a uuid column into SQL.
        exists(
          db
            .select({ one: sql`1` })
            .from(owedDigestRecipient)
            .where(
              and(
                owedDigestAudience,
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(notifications)
                    .where(
                      and(
                        eq(notifications.churchId, churches.id),
                        eq(
                          notifications.recipientUserId,
                          owedDigestRecipient.id
                        ),
                        eq(notifications.type, OVERSIGHT_DIGEST_TYPE),
                        like(notifications.dedupeKey, `%:${query.dayKey}`)
                      )
                    )
                )
              )
            )
        ),
        // The keyset anchor. Ascending id is a total order on a uuid primary
        // key, so `> last reached` never skips and never repeats within a tick.
        query.afterChurchId ? gt(churches.id, query.afterChurchId) : undefined
      )
    )
    .orderBy(churches.id)
    .limit(query.limit);
}

export async function selectPlantsOwedDigest(
  query: OwedDigestPageQuery
): Promise<string[]> {
  const rows = await plantsOwedDigestQuery(query);
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
 *
 * `budgetMs` is the tick's REMAINING allowance, passed by the caller that owns
 * the deadline. Omitted, it falls back to `DIGEST_SWEEP_BUDGET_MS` — which is
 * for a hand-run sweep, never for the scheduled one.
 */
export function runDailyOversightDigestSweep(
  at: Date = new Date(),
  budgetMs?: number
): Promise<OversightDigestSweepSummary> {
  return runOversightDigestSweep(dbOversightDigestSweepDeps, { at, budgetMs });
}
