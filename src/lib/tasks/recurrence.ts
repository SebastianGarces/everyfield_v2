/**
 * Recurring tasks (T-017).
 *
 * ## The shape of the feature
 *
 * A recurring task is not a schedule the app walks. It is a CHAIN: exactly one
 * instance is open at a time, and completing it is what mints its successor
 * (`completeTask` in `./service`). That answers #91's open question — the next
 * instance is created ON COMPLETION.
 *
 * Two consequences fall out of that choice, and both are the reason it was
 * made:
 *
 * 1. **No cron.** Nothing has to run on a timer, so there is no job to fail
 *    silently and no backlog to catch up on after an outage.
 * 2. **It cannot drift into a pile.** A planter who ignores a weekly task for
 *    two months comes back to ONE overdue instance, not nine. The chain only
 *    advances when work actually happens.
 *
 * ## Deliberately not RRULE
 *
 * `recurrence_rule` is JSONB and could hold anything. It holds a small closed
 * vocabulary on purpose: an interval, an optional end date, and the id of the
 * series the instance belongs to. Full RFC 5545 (BYDAY, COUNT, EXDATE…) is out
 * of scope — every one of those knobs needs UI, and none of them is what a
 * church planter asked for.
 *
 * ## This module is pure
 *
 * No database, no `@/db` import. The form component imports it for its labels
 * and the service imports it for the date maths, so it has to be safe in a
 * client bundle.
 */

import { isCalendarDate } from "@/lib/validations/tasks";
import { z } from "zod";

// ============================================================================
// Vocabulary
// ============================================================================

export const recurrenceIntervals = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

export type RecurrenceInterval = (typeof recurrenceIntervals)[number];

export const RECURRENCE_INTERVAL_LABELS: Record<RecurrenceInterval, string> = {
  daily: "Every day",
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
};

/**
 * The `<Select>` value that means "this task does not repeat".
 *
 * A Radix select cannot carry an empty-string value, so the off state needs a
 * real token rather than `""`.
 */
export const NO_RECURRENCE = "none";

// ============================================================================
// The rule
// ============================================================================

/**
 * What lives in `tasks.recurrence_rule`.
 *
 * `seriesId` is the id of the FIRST task in the chain. It is what lets the
 * service ask "is an instance of this series already open?" without a schema
 * change — there is no `series_id` column and this slice adds no migration.
 * The first instance may omit it: its series id is its own id, which is what
 * `seriesIdOf()` encodes.
 */
export const recurrenceRuleSchema = z.object({
  interval: z.enum(recurrenceIntervals),
  /** Inclusive last day the series may produce. `null` = repeats forever. */
  endDate: z
    .string()
    .refine(isCalendarDate, { message: "Choose a valid end date" })
    .nullish(),
  seriesId: z.string().uuid().nullish(),
});

export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

/** The recurrence half of a create/update, as the service wants it. */
export interface TaskRecurrenceInput {
  isRecurring: boolean;
  recurrenceRule: RecurrenceRule | null;
}

/**
 * Read a rule back out of the JSONB column.
 *
 * Returns `null` for anything that is not a well-formed rule — including the
 * `null` the column holds for every non-recurring task — so callers can treat
 * "no rule" and "unreadable rule" identically: neither produces an instance.
 */
export function parseRecurrenceRule(value: unknown): RecurrenceRule | null {
  if (value == null) return null;

  const parsed = recurrenceRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The id of the chain a task belongs to.
 *
 * A task whose rule carries no `seriesId` is the head of its own series.
 */
export function seriesIdOf(task: {
  id: string;
  recurrenceRule: unknown;
}): string {
  return parseRecurrenceRule(task.recurrenceRule)?.seriesId ?? task.id;
}

/** Human-readable summary of a rule, for badges and helper text. */
export function describeRecurrence(rule: RecurrenceRule | null): string | null {
  if (!rule) return null;

  const base = RECURRENCE_INTERVAL_LABELS[rule.interval];
  return rule.endDate ? `${base}, until ${rule.endDate}` : base;
}

// ============================================================================
// Calendar maths
// ============================================================================
//
// Due dates are date-only strings ("YYYY-MM-DD"), matching `tasks.due_date`.
// Everything below stays in that representation and does its arithmetic in
// UTC, which is `APP_TIME_ZONE` (`src/lib/datetime.ts`) — so advancing a due
// date is a pure function of the string and never depends on where the code
// runs. No `Date` is ever formatted for a human here.
// ============================================================================

const DAYS_BY_INTERVAL: Partial<Record<RecurrenceInterval, number>> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
};

const MONTHS_BY_INTERVAL: Partial<Record<RecurrenceInterval, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The UTC calendar day of an instant, as "YYYY-MM-DD". */
export function toCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** How many days the given (0-indexed) month of the given year has. */
function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Move a date-only string forward by exactly one interval.
 *
 * Month-length arithmetic CLAMPS rather than rolling over: January 31st plus
 * one month is February 28th, not March 3rd. `new Date(Date.UTC(y, m + 1, 31))`
 * would give the latter, which is how a monthly task quietly walks off the end
 * of the month it belongs to.
 *
 * Returns `null` if `date` is not a real calendar day.
 */
export function advanceDate(
  date: string,
  interval: RecurrenceInterval
): string | null {
  if (!isCalendarDate(date)) return null;

  const days = DAYS_BY_INTERVAL[interval];
  if (days !== undefined) {
    // Fixed-length steps in UTC: no DST, no month-length surprises.
    const advanced =
      new Date(`${date}T00:00:00Z`).getTime() + days * MS_PER_DAY;
    return toCalendarDate(new Date(advanced));
  }

  const months = MONTHS_BY_INTERVAL[interval];
  /* v8 ignore next -- every interval is in one of the two tables */
  if (months === undefined) return null;

  const [year, month, day] = date.split("-").map(Number);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));

  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth + 1).padStart(2, "0"),
    String(clampedDay).padStart(2, "0"),
  ].join("-");
}

/**
 * The due date of the instance that follows this one, or `null` when the
 * series has ended.
 *
 * The step is taken from the PREVIOUS DUE DATE, not from today — a weekly task
 * completed three days late still lands on its own weekday. A task with no due
 * date at all has nothing to step from, so the completion day is the base.
 *
 * `null` is returned when the next date would fall past `endDate`. That is the
 * whole of "ending recurrence": the chain simply stops minting successors, and
 * every instance already completed stays exactly where it is.
 */
export function nextRecurrenceDueDate(
  rule: RecurrenceRule,
  previousDueDate: string | null,
  completedOn: string
): string | null {
  const base =
    previousDueDate && isCalendarDate(previousDueDate)
      ? previousDueDate
      : completedOn;

  const next = advanceDate(base, rule.interval);
  if (!next) return null;

  // Both sides are zero-padded ISO dates, so a string compare IS a date
  // compare.
  if (rule.endDate && next > rule.endDate) return null;

  return next;
}

// ============================================================================
// Form input
// ============================================================================

/**
 * The two fields the task form posts for recurrence.
 *
 * `recurrenceInterval` absent means the form did not offer the control at all
 * (quick-add, the meeting follow-up generator) — which must leave an existing
 * rule untouched rather than clearing it. That is why `parseRecurrenceForm`
 * distinguishes "absent" (`null`) from "off" (`isRecurring: false`).
 */
export const recurrenceFormSchema = z.object({
  recurrenceInterval: z
    .union([z.literal(NO_RECURRENCE), z.enum(recurrenceIntervals)])
    .optional(),
  recurrenceEndDate: z
    .string()
    .refine(isCalendarDate, { message: "Choose a valid end date" })
    .optional(),
});

/**
 * Turn raw form values into the recurrence half of a create/update.
 *
 * Returns `null` when the form said nothing about recurrence.
 * Throws nothing: an unparseable value is treated as "said nothing", because a
 * malformed hidden field must never silently switch a task's schedule.
 */
export function parseRecurrenceForm(
  raw: Record<string, unknown>
): TaskRecurrenceInput | null {
  const parsed = recurrenceFormSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { recurrenceInterval, recurrenceEndDate } = parsed.data;

  if (recurrenceInterval === undefined) return null;

  if (recurrenceInterval === NO_RECURRENCE) {
    return { isRecurring: false, recurrenceRule: null };
  }

  return {
    isRecurring: true,
    recurrenceRule: {
      interval: recurrenceInterval,
      endDate: recurrenceEndDate ?? null,
    },
  };
}
