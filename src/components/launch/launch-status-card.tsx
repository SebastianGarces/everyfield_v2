// ============================================================================
// The dashboard's launch card (LS-005).
//
// A SERVER component — no hooks, no handlers, one link. The countdown it shows
// is NOT computed here: `daysUntil` arrives already resolved by
// `daysUntilTarget` (`src/lib/launch/countdown.ts`), the same helper the
// `/launch` page, the phase-engine snapshot and the oversight listing use. That
// is the whole point of the prop — a card that read the clock itself would be
// the #338 divergence with a nicer border, and would also render a different
// string on the server than after hydration.
// ============================================================================

import { CalendarPlus, PartyPopper, Rocket } from "lucide-react";
import Link from "next/link";

import {
  countdownFigure,
  countdownLabel,
  formatLaunchDay,
  launchedHeadline,
  launchStatusMeta,
  outcomeSummary,
  progressPercent,
} from "@/components/launch/presentation";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { LaunchStatus } from "@/db/schema/launch";

export interface LaunchStatusCardProps {
  /** `null` while the plant has no launch row, or a `planning` one with no day. */
  targetDate: string | null;
  status: LaunchStatus | null;
  /** `daysUntilTarget`'s answer. `null` when there is no date. */
  daysUntil: number | null;
  /** Readiness, when the launch has been scheduled and seeded (LS-003). */
  readiness?: { completedCount: number; totalCount: number } | null;
  /**
   * The recorded counts, once the day has been recorded (LS-006). Optional
   * because the card is useful without them: a completed launch celebrates
   * whether or not the planter filled the counts in, and `null` counts mean
   * "not recorded", never zero.
   */
  outcome?: { attendanceCount: number | null; decisionsCount: number | null };
}

export function LaunchStatusCard({
  targetDate,
  status,
  daysUntil,
  readiness,
  outcome,
}: LaunchStatusCardProps) {
  const figure = countdownFigure(daysUntil);
  const meta = launchStatusMeta(status ?? "planning");

  // ---- Launched (LS-006) --------------------------------------------------
  // A plant that has launched is not "3 days past due" — it is a plant that
  // launched. The countdown card becomes the celebrate state the moment the
  // outcome is recorded, which is what `status = 'completed'` means and the only
  // thing that sets it. It is checked BEFORE the no-date branch below: a
  // completed launch always has a day (`launches_target_date_check`), and a
  // launched plant being told "No date yet" would be the worst reading of all.
  if (status === "completed" && targetDate) {
    const summary = outcome ? outcomeSummary(outcome) : null;

    return (
      <Link
        href="/launch"
        className="from-primary/10 hover:border-primary/50 border-primary/30 block cursor-pointer rounded-xl border bg-gradient-to-br to-transparent p-6 shadow-sm transition-colors"
      >
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm font-medium">
            Launch Sunday
          </p>
          <div className="bg-primary/15 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
            <PartyPopper className="h-5 w-5" />
          </div>
        </div>

        <p className="mt-3 text-2xl font-bold tracking-tight">
          {launchedHeadline(daysUntil)}
        </p>

        <p className="text-muted-foreground mt-1 text-xs">
          {formatLaunchDay(targetDate, "short")}
          {summary ? ` · ${summary}` : ""}
        </p>

        <div className="mt-3">
          <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
        </div>
      </Link>
    );
  }

  // No date yet: the card's job is to ask for one, not to show a zero.
  if (!targetDate || !figure) {
    return (
      <Link
        href="/launch"
        className="bg-card hover:border-primary/40 block cursor-pointer rounded-xl border p-6 shadow-sm transition-colors"
      >
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm font-medium">
            Launch Sunday
          </p>
          <div className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
            <CalendarPlus className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-3 text-lg font-semibold tracking-tight">No date yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Name the day and we&apos;ll build your readiness list.
        </p>
      </Link>
    );
  }

  const isPast = daysUntil !== null && daysUntil < 0;
  const percent = readiness
    ? progressPercent(readiness.completedCount, readiness.totalCount)
    : null;

  return (
    <Link
      href="/launch"
      className="bg-card hover:border-primary/40 block cursor-pointer rounded-xl border p-6 shadow-sm transition-colors"
    >
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm font-medium">
          Launch Sunday
        </p>
        <div className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
          <Rocket className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <p className="text-3xl font-bold tracking-tight">{figure.value}</p>
        <p className="text-muted-foreground text-sm">
          {figure.unit} {isPast ? "ago" : "out"}
        </p>
      </div>

      <p className="text-muted-foreground mt-1 text-xs">
        {formatLaunchDay(targetDate, "short")} &middot;{" "}
        {countdownLabel(daysUntil)}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
        {percent !== null && readiness && readiness.totalCount > 0 && (
          <span className="text-muted-foreground text-xs">
            {/* One string for the same reason the readiness summary on
                /launch is one: the space before "milestones" is content, and
                JSX whitespace between expression containers is not something
                to trust it with. */}
            {`${readiness.completedCount}/${readiness.totalCount} milestones`}
          </span>
        )}
      </div>

      {percent !== null && readiness && readiness.totalCount > 0 && (
        <Progress
          value={percent}
          className="mt-3 h-1.5"
          aria-label="Launch readiness"
        />
      )}
    </Link>
  );
}
