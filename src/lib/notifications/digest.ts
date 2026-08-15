import {
  and,
  count,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
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
  notificationPreferences,
  notifications,
  tasks,
  users,
  type NotificationPreference,
} from "@/db/schema";
import { CHURCH_LEVEL_ROLES } from "@/lib/auth/roles";
import { toCalendarDate } from "@/lib/datetime";
import { topLevelTasksOnly } from "@/lib/tasks/service";

import {
  composePlanterDigestBody,
  composePlanterDigestTitle,
  currentDigestDedupeKeys,
  digestPeriodFor,
  planterDigestDedupeKey,
  PLANTER_DIGEST_TYPE,
  totalOutstanding,
  widestPeriodEnd,
  type DigestCounts,
  type DigestPeriod,
} from "./digest-content";
import {
  enqueue,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "./enqueue";
import { buildPreferenceMap, resolveDigestCadence } from "./preferences";

// ============================================================================
// The recurring PLANTER digest (N-013).
//
// One email that tells a planter who has not opened the app in days what needs
// their attention. It is the retention mechanism for the target user — a
// bivocational planter who opens EveryField a few times a week — and it carries
// the alpha success criterion "3+ planters active weekly after 4 weeks"
// (ruled #193).
//
// ----------------------------------------------------------------------------
// It is a CALLER of F11, not part of it
// ----------------------------------------------------------------------------
//
// This module composes a summary and hands it to `enqueue` in the `digest`
// category, exactly like any other feature. It never sends: preferences,
// batching, retry, suppression and the unsubscribe link are all the
// dispatcher's, unchanged. The only thing it asks of `dispatch.ts` is WHICH
// TEMPLATE renders the group — see `composePlanterDigestEmail` below and
// `emailComposerForGroup` there.
//
// ----------------------------------------------------------------------------
// TRANSACTIONAL, and the classification is load-bearing
// ----------------------------------------------------------------------------
//
// A digest of the recipient's OWN data — their overdue tasks, their plant's
// meetings — is transactional, not marketing. Nothing here promotes anything,
// nothing is sent to an address that did not create an account, and the content
// is a projection of rows the recipient can already read in the app. That is
// what keeps it on the transactional stream for both compliance (CAN-SPAM /
// GDPR) and deliverability, and it is why every section below is a COUNT of the
// recipient's own outstanding work rather than anything editorial.
//
// It still carries a working unsubscribe link and honours the `digest`
// category preference, because F11 gives every email both and this one is not
// special.
//
// ----------------------------------------------------------------------------
// FORWARD-LOOKING, which is the difference from the oversight digest
// ----------------------------------------------------------------------------
//
// `./oversight-digest.ts` reports COUNTS OF A DAY THAT IS OVER, so it must wait
// for a complete day (its dedupe key freezes the first answer for that day).
// This digest reports WHAT IS STILL OPEN AT THE MOMENT IT RUNS, so there is
// nothing to wait for: the period names WHEN the digest lands, not a window of
// history it summarises. That is why there is no `previousCompleteDayWindow`
// here and why a run at 00:05 and a run at 23:55 on the same day may legitimately
// report different numbers — the first one to run wins the period, and the rest
// of the period's ticks find the row already written.
//
// ----------------------------------------------------------------------------
// CADENCE IS A DEDUPE KEY, never a remembered "last sent at"
// ----------------------------------------------------------------------------
//
// "A weekly recipient gets one per week, not one per run" is enforced by the
// database, not by a clock this module keeps: every run inside one period
// computes the SAME `dedupeKey`, and the partial unique index on
// (church_id, recipient_user_id, dedupe_key) collapses the second and every
// later call into the first row (`enqueue` returns `created: false`). So the
// sweep may fire 96 times a day, a tick may be dropped, two ticks may overlap,
// and the recipient still gets exactly one digest per period
// (memory/invariants.md → Atomicity).
//
// The cadence is part of the key because the two cadences name DIFFERENT
// periods that can share a calendar date: a Monday is both the day
// `2026-08-17` and the week of `2026-08-17`. Without it, a recipient who
// switched from weekly to daily on a Monday would have their first daily digest
// silently swallowed by that morning's weekly one.
//
// The CHURCH is deliberately NOT part of the key: the unique index already
// scopes it, and leaving it out is what lets the sweep's owed-set test be an
// `IN (two literals)` instead of the concatenated-uuid `LIKE` the oversight
// sweep had to fall back on.
// ============================================================================

// ----------------------------------------------------------------------------
// WHAT THE DIGEST SAYS lives next door, in `./digest-content.ts`
// ----------------------------------------------------------------------------
//
// The type constant, the period arithmetic, the dedupe keys, the section
// vocabulary and the body/title composer with its inverse are all pure, and
// three modules need pieces of them — this one, `./dispatch.ts` and
// `./channels/digest-email.ts`. They live in a LEAF that imports no database so
// the other two do not have to pull this module's `@/db` graph in behind one
// string constant. See that file's header for the cycle it cuts.
//
// NOTHING FROM IT IS RE-EXPORTED HERE. A leaf whose contents are also served
// from the trunk is not a leaf; every importer names `./digest-content`
// directly, exactly as `./permanent-failure.ts` requires for its own constant.
//
// What is left in this file is everything that needs the database: what counts
// as outstanding, the per-plant run, and the sweep.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// The run
// ----------------------------------------------------------------------------

/** A candidate recipient — a church-level member of the plant. */
export interface DigestRecipient {
  id: string;
}

export interface PlanterDigestDeps {
  /** The plant's own team. Oversight recipients are NOT in this audience. */
  listRecipients(churchId: string): Promise<DigestRecipient[]>;
  /** Stored preference rows for the whole audience. One query, never per user. */
  loadPreferences(
    userIds: readonly string[]
  ): Promise<NotificationPreference[]>;
  /** What is still open for ONE recipient, in ONE church. */
  summarizeOutstanding(input: {
    churchId: string;
    recipientUserId: string;
    period: DigestPeriod;
    at: Date;
  }): Promise<DigestCounts>;
  enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult>;
}

/** What one plant's digest run did, per recipient and in total. */
export interface PlanterDigestReport {
  /** Recipients considered. */
  recipients: number;
  /** Rows written by THIS run. */
  created: number;
  /**
   * Recipients whose period was already served — the cadence guard doing its
   * job, not an error.
   */
  deduped: number;
  /** Recipients with nothing outstanding. They are sent NOTHING. */
  quiet: number;
  /** Recipients `enqueue` refused (tenancy or the oversight model). */
  skipped: number;
}

/**
 * Run one plant's digest.
 *
 * Idempotent per (recipient, period): running it every fifteen minutes for a
 * week produces ONE weekly digest per recipient, because the dedupe key is the
 * period's and the partial unique index arbitrates — not because this function
 * remembers having run.
 *
 * A recipient with NOTHING outstanding is sent nothing at all: not an empty
 * digest, not a "nothing to report" digest. `enqueue` is not called for them,
 * which is what the acceptance criterion counts.
 */
export async function runPlanterDigest(
  deps: PlanterDigestDeps,
  input: { churchId: string; at: Date }
): Promise<PlanterDigestReport> {
  const recipients = await deps.listRecipients(input.churchId);

  const report: PlanterDigestReport = {
    recipients: recipients.length,
    created: 0,
    deduped: 0,
    quiet: 0,
    skipped: 0,
  };

  if (recipients.length === 0) return report;

  const preferenceRows = await deps.loadPreferences(
    recipients.map((recipient) => recipient.id)
  );
  const byUser = new Map<string, NotificationPreference[]>();
  for (const row of preferenceRows) {
    const list = byUser.get(row.userId);
    if (list) list.push(row);
    else byUser.set(row.userId, [row]);
  }

  for (const recipient of recipients) {
    // The cadence is the RECIPIENT's, resolved through the one reader the
    // settings screen uses (`resolveDigestCadence`), so "what did I choose?"
    // and "what do I get?" cannot answer differently. An absent row means the
    // coded default, which is `weekly`.
    const cadence = resolveDigestCadence(
      buildPreferenceMap(byUser.get(recipient.id) ?? [])
    );
    const period = digestPeriodFor(cadence, input.at);

    const counts = await deps.summarizeOutstanding({
      churchId: input.churchId,
      recipientUserId: recipient.id,
      period,
      at: input.at,
    });

    // The whole requirement, in one branch: nothing outstanding, no contact.
    if (totalOutstanding(counts) === 0) {
      report.quiet += 1;
      continue;
    }

    // NOTE what is NOT checked here: whether this recipient has the `digest`
    // category switched off. That is the dispatcher's question, asked at
    // delivery time so a preference changed this morning takes effect this
    // afternoon, and its answer is recorded as a `suppressed_by_preference`
    // delivery row (N-016). Pre-filtering here would write no row and leave
    // "why did I not get one?" unanswerable.
    const result = await deps.enqueue({
      churchId: input.churchId,
      recipientUserId: recipient.id,
      category: "digest",
      type: PLANTER_DIGEST_TYPE,
      title: composePlanterDigestTitle(period),
      body: composePlanterDigestBody(counts),
      dedupeKey: planterDigestDedupeKey(period),
    });

    if (result.status === "skipped") report.skipped += 1;
    else if (result.created) report.created += 1;
    else report.deduped += 1;
  }

  return report;
}

// ----------------------------------------------------------------------------
// Production wiring — WHAT COUNTS AS OUTSTANDING, defined once
// ----------------------------------------------------------------------------

/**
 * A church id / user id, either as a literal or as a COLUMN to correlate
 * against — the same shape `./oversight-digest.ts` uses, and for the same
 * reason: each condition below is asked twice, once by the `count()` that
 * composes a digest and once by the `EXISTS` that decides whether a plant is
 * worth sweeping. Accepting both is what keeps ONE definition of "outstanding"
 * instead of two that drift.
 */
type ChurchIdRef = string | typeof churches.id;
type UserIdRef = string | typeof users.id | typeof owedDigestMember.id;

/**
 * `users` under a second name, so the sweep's correlated recipient probe can
 * name the candidate in its own inner `NOT EXISTS` without colliding with any
 * other reference to the table in the same statement.
 *
 * It is declared HERE, above the conditions, because `UserIdRef` has to admit
 * it: drizzle brands a column with its table's NAME, so an alias column is a
 * different type from `users.id` and a `UserIdRef` that named only the base
 * table would have made the sweep's correlated call a compile error — which is
 * the moment somebody writes a SECOND copy of these conditions for the alias.
 */
const owedDigestMember = alias(users, "owed_planter_digest_member");

/**
 * A task that is still owed: not deleted, not complete, and a TOP-LEVEL task.
 *
 * `topLevelTasksOnly()` is not optional — a subtask is a checklist item, not a
 * task, and anything reporting a NUMBER of tasks applies it
 * (memory/invariants.md → Tasks). Without it a planter with one task and twelve
 * checklist items would be told thirteen things are overdue.
 */
function openTaskCondition(churchId: ChurchIdRef, assigneeId: UserIdRef) {
  return and(
    eq(tasks.churchId, churchId),
    eq(tasks.assignedToId, assigneeId),
    isNull(tasks.deletedAt),
    ne(tasks.status, "complete"),
    topLevelTasksOnly()
  );
}

/**
 * OVERDUE — due on a calendar day BEFORE the day the digest is composed in.
 *
 * `tasks.due_date` is a `date` column, so the comparison is against a
 * `YYYY-MM-DD` measured in `APP_TIME_ZONE` through `toCalendarDate` — never
 * against an instant, and never through the runtime's own calendar
 * (memory/invariants.md → Date & Time Rendering).
 */
function overdueTaskCondition(
  churchId: ChurchIdRef,
  assigneeId: UserIdRef,
  at: Date
) {
  return and(
    openTaskCondition(churchId, assigneeId),
    lt(tasks.dueDate, toCalendarDate(at))
  );
}

/**
 * DUE BEFORE THE NEXT DIGEST — from today up to, but not including, the day the
 * next digest lands. Half-open, so a task due exactly on the next digest's day
 * belongs to that digest and is never reported twice.
 */
function taskDueSoonCondition(
  churchId: ChurchIdRef,
  assigneeId: UserIdRef,
  at: Date,
  periodEnd: Date
) {
  return and(
    openTaskCondition(churchId, assigneeId),
    gte(tasks.dueDate, toCalendarDate(at)),
    lt(tasks.dueDate, toCalendarDate(periodEnd))
  );
}

/**
 * MEETINGS COMING UP — the plant's, not the recipient's.
 *
 * Church-wide on purpose: EveryField's meetings are the plant's own gatherings
 * and vision meetings, and the person who most needs to see one on the calendar
 * is often not on its guest list yet. It is still strictly church-scoped, which
 * is what the two-church fixture asserts.
 *
 * `cancelled` and `completed` are excluded: neither is coming up. `planning`,
 * `ready` and `in_progress` all are.
 */
function upcomingMeetingCondition(
  churchId: ChurchIdRef,
  at: Date,
  periodEnd: Date
) {
  return and(
    eq(churchMeetings.churchId, churchId),
    gte(churchMeetings.datetime, at),
    lt(churchMeetings.datetime, periodEnd),
    sql`${churchMeetings.status} not in ('cancelled', 'completed')`
  );
}

/**
 * "Is ANYTHING outstanding for this recipient?" as one correlated
 * `EXISTS ... OR EXISTS ...`, built from the same three conditions the counts
 * use.
 *
 * Short-circuiting by construction, and `totalOutstanding(summarize(...)) > 0`
 * and this predicate are the same question because they are the same SQL. That
 * is the property the sweep leans on when it declines to offer a plant it would
 * otherwise summarise and discard — the starvation hazard
 * `./oversight-digest.ts` documents at length.
 */
function hasOutstandingCondition(
  churchId: ChurchIdRef,
  recipientId: UserIdRef,
  at: Date,
  periodEnd: Date
): SQL | undefined {
  return or(
    exists(
      db
        .select({ one: sql`1` })
        .from(tasks)
        .where(overdueTaskCondition(churchId, recipientId, at))
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(tasks)
        .where(taskDueSoonCondition(churchId, recipientId, at, periodEnd))
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(churchMeetings)
        .where(upcomingMeetingCondition(churchId, at, periodEnd))
    )
  );
}

/** Three bounded `count()` queries, all `church_id`-scoped. */
export async function summarizeOutstandingForRecipient(input: {
  churchId: string;
  recipientUserId: string;
  period: DigestPeriod;
  at: Date;
}): Promise<DigestCounts> {
  const { churchId, recipientUserId, period, at } = input;

  const [overdue, dueSoon, meetings] = await Promise.all([
    db
      .select({ n: count() })
      .from(tasks)
      .where(overdueTaskCondition(churchId, recipientUserId, at)),
    db
      .select({ n: count() })
      .from(tasks)
      .where(taskDueSoonCondition(churchId, recipientUserId, at, period.end)),
    db
      .select({ n: count() })
      .from(churchMeetings)
      .where(upcomingMeetingCondition(churchId, at, period.end)),
  ]);

  return {
    overdue_tasks: overdue[0]?.n ?? 0,
    tasks_due_soon: dueSoon[0]?.n ?? 0,
    upcoming_meetings: meetings[0]?.n ?? 0,
  };
}

/** Exactly the column the audience needs. Never `select()` on `users`. */
export async function listPlanterDigestRecipients(
  churchId: string
): Promise<DigestRecipient[]> {
  return db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.churchId, churchId),
        inArray(users.role, [...CHURCH_LEVEL_ROLES])
      )
    );
}

export const dbPlanterDigestDeps: PlanterDigestDeps = {
  listRecipients: listPlanterDigestRecipients,
  async loadPreferences(userIds) {
    if (userIds.length === 0) return [];
    // The same named exception `dispatch.ts` documents: this reads OTHER users'
    // preference rows by necessity, so it does not go through
    // `loadUserPreferences`, whose `PreferenceOwner` is mintable only from a
    // session.
    return db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, [...userIds]));
  },
  summarizeOutstanding: summarizeOutstandingForRecipient,
  enqueue,
};

/** The wired-up entrypoint for ONE plant. */
export function runDailyPlanterDigest(
  churchId: string,
  at: Date = new Date()
): Promise<PlanterDigestReport> {
  return runPlanterDigest(dbPlanterDigestDeps, { churchId, at });
}

// ----------------------------------------------------------------------------
// The sweep — the once-a-period guard, DERIVED rather than remembered
// ----------------------------------------------------------------------------
//
// Same shape and the same reasoning as `./oversight-digest.ts`'s sweep, and the
// two lessons it paid for are honoured here rather than re-learned:
//
//   1. "OWED" MEANS "WILL ACTUALLY PRODUCE A DIGEST". A plant that cannot write
//      a row — no church-level members, nothing outstanding for any of them —
//      is not offered, so the owed set shrinks monotonically through the period
//      instead of parking a starved plant at the head of a stable ordering.
//   2. THE BATCH BOUNDS THE WORK, NOT THE PERIOD. Within a tick the sweep
//      keyset-pages until the owed set is exhausted or a budget stops it, and
//      the cursor advances past a plant whose digest THREW so a failure is
//      never a head-of-line block.
//
// There is no stored cursor and no last-run marker: progress is derived from
// the digest rows themselves, so a dropped tick is a delay rather than a loss.
// ----------------------------------------------------------------------------

/** Plants selected per keyset page. */
export const MAX_PLANTER_DIGEST_SWEEP_BATCH = 25;

/** Hard ceiling on plants CONSIDERED in one tick. A backstop, not the limit. */
export const MAX_PLANTER_DIGEST_SWEEP_PLANTS = 500;

/** Wall-clock budget for one sweep. Crossing it stops between plants. */
export const PLANTER_DIGEST_SWEEP_BUDGET_MS = 10_000;

export interface OwedPlanterDigestPageQuery {
  /** Every dedupe key a current digest could carry — `currentDigestDedupeKeys`. */
  dedupeKeys: readonly string[];
  /** The instant the tick fired; "overdue" and "coming up" are measured from it. */
  at: Date;
  /** The widest period end of any cadence — see `widestPeriodEnd`. */
  lookaheadEnd: Date;
  limit: number;
  /** Keyset anchor: only plants with a GREATER id. `null` starts the scan. */
  afterChurchId: string | null;
}

/**
 * One keyset page of the plants that still owe a planter digest.
 *
 * The condition is per RECIPIENT, not per plant: a plant whose planter was
 * served but whose team member was not is still owed, and asking per recipient
 * SUBSUMES a separate "has any members" clause, since a plant with none has
 * nobody to be missing a row.
 *
 * A builder rather than an inlined statement because this predicate decides
 * LIVENESS — a plant it offers but that can never be written a row is offered
 * on every tick forever — and that property lives in the RENDERED SQL, so
 * `.toSQL()` can assert it without a live Postgres.
 */
export function plantsOwedPlanterDigestQuery(
  query: OwedPlanterDigestPageQuery
) {
  return db
    .select({ id: churches.id })
    .from(churches)
    .where(
      and(
        exists(
          db
            .select({ one: sql`1` })
            .from(owedDigestMember)
            .where(
              and(
                eq(owedDigestMember.churchId, churches.id),
                inArray(owedDigestMember.role, [...CHURCH_LEVEL_ROLES]),
                // There is something to tell them about...
                hasOutstandingCondition(
                  churches.id,
                  owedDigestMember.id,
                  query.at,
                  query.lookaheadEnd
                ),
                // ...and they hold no LIVE digest row for the current period of
                // either cadence. Cancelled rows are excluded for the same
                // reason the dedupe index is partial on liveness: a cancelled
                // row no longer reserves its key.
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(notifications)
                    .where(
                      and(
                        eq(notifications.churchId, churches.id),
                        eq(notifications.recipientUserId, owedDigestMember.id),
                        eq(notifications.type, PLANTER_DIGEST_TYPE),
                        inArray(notifications.dedupeKey, [...query.dedupeKeys]),
                        ne(notifications.status, "cancelled")
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

export async function selectPlantsOwedPlanterDigest(
  query: OwedPlanterDigestPageQuery
): Promise<string[]> {
  const rows = await plantsOwedPlanterDigestQuery(query);
  return rows.map((row) => row.id);
}

export interface PlanterDigestSweepDeps {
  selectPlantsOwed(query: OwedPlanterDigestPageQuery): Promise<string[]>;
  runDigest(churchId: string, at: Date): Promise<PlanterDigestReport>;
}

export interface PlanterDigestSweepSummary {
  /** Plants offered across every page this tick read. */
  selected: number;
  /** Plants this tick actually reached and attempted. */
  plantsScanned: number;
  pages: number;
  /** Digest rows written by this tick, across every plant. */
  created: number;
  /** Recipients whose period was already served. */
  deduped: number;
  /** Recipients with nothing outstanding. */
  quiet: number;
  /** Plants whose digest threw. Logged, never rethrown. */
  failed: number;
  budgetExhausted: boolean;
  durationMs: number;
}

/**
 * One tick's worth of digesting. Never throws.
 *
 * A failure on one plant is recorded and the sweep continues, and a failure of
 * the sweep as a whole must not fail whatever scheduled run it rides on: that
 * run's obligation is time-sensitive (N-017) and a roll-up is not. Everything a
 * caller needs is in the summary rather than in an exception.
 */
export async function runPlanterDigestSweep(
  deps: PlanterDigestSweepDeps,
  options: {
    at: Date;
    limit?: number;
    maxPlants?: number;
    budgetMs?: number;
    elapsedMs?: () => number;
  }
): Promise<PlanterDigestSweepSummary> {
  const startedAt = Date.now();
  const elapsedMs = options.elapsedMs ?? (() => Date.now() - startedAt);
  const budgetMs = options.budgetMs ?? PLANTER_DIGEST_SWEEP_BUDGET_MS;
  const limit = Math.min(
    Math.max(options.limit ?? MAX_PLANTER_DIGEST_SWEEP_BATCH, 1),
    200
  );
  const maxPlants = Math.max(
    options.maxPlants ?? MAX_PLANTER_DIGEST_SWEEP_PLANTS,
    limit
  );

  const summary: PlanterDigestSweepSummary = {
    selected: 0,
    plantsScanned: 0,
    pages: 0,
    created: 0,
    deduped: 0,
    quiet: 0,
    failed: 0,
    budgetExhausted: false,
    durationMs: 0,
  };

  const dedupeKeys = currentDigestDedupeKeys(options.at);
  const lookaheadEnd = widestPeriodEnd(options.at);
  let afterChurchId: string | null = null;

  walk: while (summary.plantsScanned < maxPlants) {
    if (elapsedMs() >= budgetMs) {
      summary.budgetExhausted = true;
      break;
    }

    let page: string[];
    try {
      page = await deps.selectPlantsOwed({
        dedupeKeys,
        at: options.at,
        lookaheadEnd,
        limit,
        afterChurchId,
      });
    } catch (error) {
      // "Never throws" has to include the SELECT.
      summary.failed += 1;
      console.error("[notifications/digest] selection failed", {
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

      // Advances on EVERY plant reached, including one whose digest threw — a
      // failure must not become a head-of-line block on the plants behind it.
      afterChurchId = churchId;
      summary.plantsScanned += 1;

      try {
        const report = await deps.runDigest(churchId, options.at);
        summary.created += report.created;
        summary.deduped += report.deduped;
        summary.quiet += report.quiet;
      } catch (error) {
        summary.failed += 1;
        console.error("[notifications/digest] plant failed", {
          churchId,
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

export const dbPlanterDigestSweepDeps: PlanterDigestSweepDeps = {
  selectPlantsOwed: selectPlantsOwedPlanterDigest,
  // The per-plant entrypoint itself, not a second copy of its body: one wiring
  // of `dbPlanterDigestDeps` in the module, so a plant swept and a plant run by
  // hand cannot be run with different dependencies.
  runDigest: runDailyPlanterDigest,
};

/**
 * The wired-up entrypoint a scheduled tick calls.
 *
 * `at` is "when the tick fired". Everything else — which period, which plants,
 * which recipients — is derived from it and from what is already in the
 * database, which is what makes the once-a-period guard survive a dropped tick,
 * an overlapping tick and a cold serverless start alike.
 *
 * ITS ONE CALLER is `src/app/api/notifications/dispatch/route.ts`, beside the
 * oversight digest's sweep, wrapped in the same never-fail-the-run try/catch and
 * reported in the same response body. This app has no scheduler of its own to
 * give a recurring job (the Hobby plan's one-a-day Vercel cron is unusable,
 * which is why `vercel.json` schedules nothing), and the dispatcher tick already
 * runs every 15 minutes from `.github/workflows/notifications-dispatch.yml` —
 * which is exactly the frequency this sweep is designed to be called at, since
 * the once-a-period guard is derived from the rows it writes rather than from a
 * clock.
 *
 * That call is what makes `UNSUBSCRIBE_TOKEN_SECRET` a live production
 * prerequisite: this is the first feature in the product that enqueues on a
 * schedule, and the digest email throws rather than ship a dead unsubscribe
 * link.
 */
export function runDailyPlanterDigestSweep(
  at: Date = new Date()
): Promise<PlanterDigestSweepSummary> {
  return runPlanterDigestSweep(dbPlanterDigestSweepDeps, { at });
}
