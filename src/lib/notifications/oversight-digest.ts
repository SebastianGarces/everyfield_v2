import { and, count, eq, gte, isNotNull, lt } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  persons,
  phaseTransitions,
  tasks,
} from "@/db/schema";
import { APP_TIME_ZONE } from "@/lib/datetime";

import {
  enqueue,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "./enqueue";
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
      title: `${plant.name} — today's summary`,
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
    db
      .select({ n: count() })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.churchId, churchId),
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
    db
      .select({ n: count() })
      .from(phaseTransitions)
      .where(
        and(
          eq(phaseTransitions.churchId, churchId),
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

/** `runDailyOversightDigest(churchId, at)` — the wired-up production entrypoint. */
export function runDailyOversightDigest(
  churchId: string,
  at: Date = new Date()
): Promise<OversightDigestOutcome> {
  return runOversightDigest(dbOversightDigestDeps, {
    churchId,
    window: activityWindowForDay(at),
  });
}
