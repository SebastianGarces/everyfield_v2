// ============================================================================
// Launch — the pure presentation rules (LS-004/LS-005).
//
// A plain `.ts` module, extracted from the components for the reason
// `focus-presentation.ts` was: the repo's harness runs `src/**/*.test.ts` with
// node:test and no DOM, so the load-bearing decisions — what the countdown SAYS,
// which milestone may be closed — are only testable outside a `.tsx` file.
//
// THE ONE RULE THIS FILE MUST NOT BREAK. Nothing here computes a day
// difference. Every countdown number arrives already computed by
// `daysUntilTarget` (`src/lib/launch/countdown.ts`), which is also what the
// phase-engine snapshot and the oversight listing use. A second hand-rolled
// diff here is exactly bug #338 in a new place: it shipped twice, once in the
// oversight presentation layer and once in the signal layer, and both times the
// second implementation floored a day away and read "past due" on the morning
// of a plant's own launch.
// ============================================================================

import type { LaunchEventType, LaunchStatus } from "@/db/schema/launch";
import { formatDate } from "@/lib/datetime";
import { parseTargetDate } from "@/lib/launch/countdown";
// Type-only: erased at build time, so importing the server module's shapes here
// pulls no `@/db` into the client bundle.
import type { LaunchReadiness } from "@/lib/launch/milestones";

// ----------------------------------------------------------------------------
// The countdown, as words
// ----------------------------------------------------------------------------

/**
 * The headline over the number: `"Launch Sunday is today"`, `"Tomorrow"`,
 * `"12 days out"`, `"3 days ago"`.
 *
 * `days` is `daysUntilTarget`'s answer and nothing else — `null` means there is
 * no committed date, which is a different sentence from "0 days".
 */
export function countdownLabel(days: number | null): string {
  if (days === null) return "No date yet";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `${days} days out` : `${Math.abs(days)} days ago`;
}

/**
 * The big number a countdown card shows, and the word under it. `null` when
 * there is no date — the card shows a call to action instead of a zero, because
 * a zero here would read as "today".
 */
export function countdownFigure(
  days: number | null
): { value: string; unit: string } | null {
  if (days === null) return null;
  const magnitude = Math.abs(days);
  return {
    value: String(magnitude),
    unit: magnitude === 1 ? "day" : "days",
  };
}

/**
 * The countdown as ONE headline, so a card never says the same thing twice.
 *
 * Both launch surfaces used to print the figure AND the label side by side,
 * which read "302 days out · Sunday, June 6, 2027 · 302 days out". The rule
 * here: within a day either side of the launch the WORD carries it — "Today"
 * on the morning of a plant's launch is the whole message, and "0 days out"
 * beside it is worse than nothing — and beyond that the number does, with the
 * date supplying everything else.
 *
 * Does no day arithmetic: `days` is `daysUntilTarget`'s answer, and every
 * branch below is a comparison, never a subtraction (#338).
 */
export type CountdownHeadline =
  | { kind: "word"; word: string }
  | { kind: "figure"; value: string; unit: string; direction: "out" | "ago" };

export function countdownHeadline(
  days: number | null
): CountdownHeadline | null {
  if (days === null) return null;
  const figure = countdownFigure(days);
  if (!figure) return null;
  // "Today" / "Tomorrow" / "Yesterday" — the three days a number tells worse
  // than a word does.
  if (Math.abs(days) <= 1) return { kind: "word", word: countdownLabel(days) };
  return {
    kind: "figure",
    value: figure.value,
    unit: figure.unit,
    direction: days < 0 ? "ago" : "out",
  };
}

/** `"Sunday, September 20, 2026"` — pinned to `APP_TIME_ZONE`, never the runtime's. */
export function formatLaunchDay(
  targetDate: string,
  variant: "long" | "short" = "long"
): string {
  return formatDate(parseTargetDate(targetDate), variant);
}

// ----------------------------------------------------------------------------
// Status
// ----------------------------------------------------------------------------

export interface LaunchStatusMeta {
  label: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  /** One line of plain English, for a card that has room for it. */
  description: string;
}

/**
 * `postponed` is deliberately NOT terminal and NOT an error state: a
 * postponement carries a NEW date and the plant goes on preparing (LS-009). It
 * reads as a neutral fact, which is why it is `secondary` rather than
 * `destructive`.
 */
export function launchStatusMeta(status: LaunchStatus): LaunchStatusMeta {
  switch (status) {
    case "scheduled":
      return {
        label: "Scheduled",
        badgeVariant: "default",
        description: "The day is set. Work the readiness list.",
      };
    case "postponed":
      return {
        label: "Postponed",
        badgeVariant: "secondary",
        description: "The day moved. The new date is below, and so is why.",
      };
    case "completed":
      return {
        label: "Launched",
        badgeVariant: "outline",
        description: "Launch Sunday happened, and the day is on the record.",
      };
    case "planning":
    default:
      return {
        label: "Planning",
        badgeVariant: "secondary",
        description: "No day named yet.",
      };
  }
}

// ----------------------------------------------------------------------------
// Readiness
// ----------------------------------------------------------------------------

/** Whole percent, 0 when there is nothing to be a percent of. */
export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * May this milestone be closed by hand?
 *
 * The hybrid model's rule (LS-003, ruled 2026-08-04): task completion moves the
 * milestone's progress, and a milestone with NO OPEN TASKS — including one with
 * no tasks at all — is manually completable. This is the button's copy of the
 * rule; the guard that decides is the `not exists` in
 * `completeLaunchMilestoneStatement`, because a teammate can reopen the last
 * task between this render and that write.
 */
export function canCompleteMilestone(milestone: {
  isComplete: boolean;
  openTaskCount: number;
}): boolean {
  return !milestone.isComplete && milestone.openTaskCount === 0;
}

/** Why the "Mark complete" control is unavailable, for a title/tooltip. */
export function completeMilestoneBlockedReason(milestone: {
  isComplete: boolean;
  openTaskCount: number;
}): string | null {
  if (milestone.isComplete) return null;
  if (milestone.openTaskCount === 0) return null;
  return milestone.openTaskCount === 1
    ? "1 task still open"
    : `${milestone.openTaskCount} tasks still open`;
}

// ----------------------------------------------------------------------------
// Optimistic readiness
// ----------------------------------------------------------------------------

/**
 * What a click changes before the server answers.
 *
 * `milestone` carries no "did it succeed" — the optimistic state is a GUESS,
 * and the server's `refresh()` is what reconciles it. The guess still has to
 * obey the model's own rule, which is why completing a milestone with open
 * tasks is a no-op here as well as in SQL: a checkbox that ticks and then
 * silently untick itself is worse than one that does not tick.
 */
export type ReadinessChange =
  | { kind: "task"; taskId: string; complete: boolean }
  | { kind: "milestone"; milestoneId: string; complete: boolean };

/**
 * Apply one change to a readiness snapshot, deriving every count exactly the
 * way the server derives it (`getLaunchReadiness`) — so the optimistic frame
 * and the reconciled frame agree about the numbers instead of flickering.
 *
 * Pure and immutable: `useOptimistic` calls this during render.
 */
export function applyReadinessChange(
  readiness: LaunchReadiness,
  change: ReadinessChange
): LaunchReadiness {
  const milestones = readiness.milestones.map((milestone) => {
    if (change.kind === "milestone") {
      if (milestone.id !== change.milestoneId) return milestone;
      // The button's rule, applied to the guess as well: a milestone with open
      // tasks does not close.
      if (change.complete && milestone.openTaskCount > 0) return milestone;
      return { ...milestone, isComplete: change.complete };
    }

    if (!milestone.tasks.some((task) => task.id === change.taskId)) {
      return milestone;
    }

    const tasks = milestone.tasks.map((task) =>
      task.id === change.taskId
        ? { ...task, isComplete: change.complete }
        : task
    );
    const completedTaskCount = tasks.filter((task) => task.isComplete).length;

    return {
      ...milestone,
      tasks,
      completedTaskCount,
      openTaskCount: tasks.length - completedTaskCount,
    };
  });

  return {
    ...readiness,
    milestones,
    completedCount: milestones.filter((milestone) => milestone.isComplete)
      .length,
    totalCount: milestones.length,
    openTaskCount: milestones.reduce(
      (total, milestone) => total + milestone.openTaskCount,
      0
    ),
  };
}

// ----------------------------------------------------------------------------
// The journal
// ----------------------------------------------------------------------------

/**
 * How a journal row reads in the history list (LS-002/LS-006/LS-009).
 *
 * IT TAKES THE ROW, NOT THE EVENT, and that is the whole point. A CORRECTION to
 * a recorded outcome is a `completed` row like the first recording — the event
 * vocabulary is a fixed four-value enum owned by the schema — and the pair that
 * tells them apart is `previous_status`: only a correction comes from a launch
 * that was ALREADY `completed`. Reading the event alone would label a Monday
 * fix-up "Outcome recorded" a second time, which reads as a launch that
 * happened twice.
 */
export function journalEntryLabel(entry: {
  event: LaunchEventType;
  previousStatus: LaunchStatus;
}): string {
  switch (entry.event) {
    case "scheduled":
      return "Scheduled";
    case "moved":
      return "Date moved";
    case "postponed":
      return "Postponed";
    case "completed":
      return entry.previousStatus === "completed"
        ? "Outcome corrected"
        : "Outcome recorded";
  }
}

// ----------------------------------------------------------------------------
// Two histories, cut from one journal
// ----------------------------------------------------------------------------

/**
 * Is this row about the DAY, or about what happened on it?
 *
 * The split is what lets the page put each half where it belongs: scheduling,
 * moving and postponing are admin context and live with the date control, while
 * recording and correcting the outcome are the plant's own story and belong in
 * the history the whole team reads. The enum has four values and the schema owns
 * them, so this is a partition rather than a filter with a default.
 */
export function isLaunchDateEvent(event: LaunchEventType): boolean {
  return event !== "completed";
}

/** The date journal: scheduled, moved, postponed. Order preserved. */
export function launchDateEvents<T extends { event: LaunchEventType }>(
  entries: T[]
): T[] {
  return entries.filter((entry) => isLaunchDateEvent(entry.event));
}

/**
 * One row of the plant-facing history: a milestone somebody closed, or the
 * outcome being recorded or corrected.
 */
export type LaunchHistoryEntry =
  | {
      kind: "milestone";
      key: string;
      at: Date;
      title: string;
      actorName: string | null;
    }
  | {
      kind: "outcome";
      key: string;
      at: Date;
      label: string;
      note: string | null;
      actorName: string | null;
    };

/**
 * The launch's activity, newest first — milestone completions interleaved with
 * the outcome events, because they are the same story told by two tables.
 *
 * MILESTONE COMPLETIONS ARE READ, NOT JOURNALLED. `launch_milestones` already
 * stores `completed_at` and `completed_by_user_id`; this reads that pair rather
 * than adding a second event log that could disagree with it. A milestone that
 * is reopened therefore leaves this list — which is correct, because the row is
 * a statement about the milestone's state, not a claim about the past that a
 * reopen would falsify.
 *
 * Ties break on the key so two milestones closed in the same millisecond render
 * in a stable order instead of shuffling between renders.
 */
export function buildLaunchHistory(
  milestones: {
    milestoneId: string;
    title: string;
    completedAt: Date;
    actorName: string | null;
  }[],
  journal: {
    id: string;
    event: LaunchEventType;
    previousStatus: LaunchStatus;
    note: string | null;
    actorName: string | null;
    createdAt: Date;
  }[]
): LaunchHistoryEntry[] {
  const entries: LaunchHistoryEntry[] = [
    ...milestones.map(
      (milestone): LaunchHistoryEntry => ({
        kind: "milestone",
        key: `milestone:${milestone.milestoneId}`,
        at: milestone.completedAt,
        title: milestone.title,
        actorName: milestone.actorName,
      })
    ),
    ...journal
      .filter((entry) => !isLaunchDateEvent(entry.event))
      .map(
        (entry): LaunchHistoryEntry => ({
          kind: "outcome",
          key: `outcome:${entry.id}`,
          at: entry.createdAt,
          label: journalEntryLabel(entry),
          note: entry.note,
          actorName: entry.actorName,
        })
      ),
  ];

  return entries.sort((a, b) => {
    const byTime = b.at.getTime() - a.at.getTime();
    return byTime !== 0 ? byTime : a.key.localeCompare(b.key);
  });
}

// ----------------------------------------------------------------------------
// The launch itself, once it has happened
// ----------------------------------------------------------------------------

/**
 * The dashboard card's celebrate state (LS-005/LS-006): a plant that has
 * launched should not be told how many days late it is.
 *
 * `days` is `daysUntilTarget`'s answer and nothing else — this function does no
 * day arithmetic, on the same terms as everything else in this file (#338).
 * A completed launch always has a date (the schema's `launches_target_date_check`
 * guarantees it), so `null` is defensive rather than expected.
 */
export function launchedHeadline(days: number | null): string {
  if (days === null) return "Launched";
  if (days >= 0) return "Launched today";
  const ago = Math.abs(days);
  if (ago === 1) return "Launched yesterday";
  return `Launched ${ago} days ago`;
}

/**
 * The one-line account of the day for a card that has no room for the record
 * itself. `null` when neither count was recorded — an empty answer is a
 * sentence the card should not print, and "0 attended" is a real answer that
 * must not be confused with "not recorded" (the nullable counts exist for
 * exactly that distinction).
 */
export function outcomeSummary(outcome: {
  attendanceCount: number | null;
  decisionsCount: number | null;
}): string | null {
  const parts: string[] = [];
  if (outcome.attendanceCount !== null) {
    parts.push(
      outcome.attendanceCount === 1
        ? "1 person present"
        : `${outcome.attendanceCount} present`
    );
  }
  if (outcome.decisionsCount !== null) {
    parts.push(
      outcome.decisionsCount === 1
        ? "1 decision or response"
        : `${outcome.decisionsCount} decisions and responses`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * What the no-date card says UNDER "No date yet", which is not one sentence for
 * every seat (#659).
 *
 * "Name the day" is an imperative, and naming the day is `launch.schedule` —
 * OWNER_ONLY on a plant. A Member who read it was being told to do a thing the
 * server refuses them, by a card whose link lands on `/launch`, where the same
 * condition is already stated properly: "No date is set yet. Your planter names
 * the day." So the second sentence here is that page's, verbatim — a card and
 * its destination disagreeing about who acts is the defect, and one string is
 * how they stop.
 *
 * The card still LINKS for both seats. `/launch` is readable by a Member —
 * milestones, history, the readiness list — and #499's rule is about write
 * affordances, not about destinations.
 */
export function launchDateInvitation(canSchedule: boolean): string {
  return canSchedule
    ? "Name the day and we'll build your readiness list."
    : PLANTER_NAMES_THE_DAY;
}

/**
 * WHO NAMES THE DAY, IN ONE PLACE — the sentence a reader without
 * `launch.schedule` is given instead of an instruction.
 *
 * Shared by the dashboard card and `/launch`'s own date card, because those two
 * disagreeing is the whole of #659: the page said this and the card pointing at
 * it said "Name the day". The INVITATION differs between them on purpose — the
 * page has room to name the Playbook and the card does not — but the condition
 * is one fact and reads the same wherever a reader meets it.
 */
export const PLANTER_NAMES_THE_DAY = "Your planter names the day.";
