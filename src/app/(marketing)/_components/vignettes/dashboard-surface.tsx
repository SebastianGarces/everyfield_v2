import { AlertCircle, CalendarCheck, Users, UsersRound } from "lucide-react";

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { MetricCard } from "@/components/dashboard/metric-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { PHASES, type PhaseNumber } from "@/lib/constants";
import type { ActivityItem, DashboardMetrics } from "@/lib/dashboard/service";

/**
 * The dashboard, chrome-less — the app's own surface with the shell taken off.
 *
 * Two landing surfaces show a plant's dashboard (the hero, and the last stop
 * of the journey), so the composition lives here once. Everything inside is
 * the app's own component: `MetricCard`, `ActivityFeed`, `QuickActions`, fed a
 * frozen read of a real church. What this file owns is only the arrangement,
 * and that is a transcription of the app's own dashboard page
 * (app/(dashboard)/dashboard/page.tsx) — same order, same titles, same icons,
 * same variants, same descriptions, same grid.
 *
 * What is deliberately NOT here is the shell: the sidebar, the header bar and
 * the page padding. The captures this replaces carried all three, and spent
 * about a fifth of their pixels on navigation nobody can click in a picture.
 * Dropping it is the difference between the dashboard being readable on the
 * page and being a thumbnail of a browser window.
 *
 * Server component. Nothing here is interactive; the links inside
 * `QuickActions` are neutralised at the mount (see hero-dashboard.tsx).
 */

/**
 * The metric row, as data, so the phone composition can take the first two
 * without restating any of the app's copy. Order, titles, icons, variants and
 * descriptions are the dashboard page's.
 */
export function metricCards(
  metrics: DashboardMetrics
): (React.ComponentProps<typeof MetricCard> & { key: string })[] {
  return [
    {
      key: "core-group",
      title: "Core Group",
      value: metrics.coreGroupSize,
      icon: UsersRound,
      variant: "success",
      description: "Core group, launch team & leaders",
    },
    {
      key: "total-people",
      title: "Total People",
      value: metrics.totalPeople,
      icon: Users,
      description: "All contacts in your pipeline",
    },
    {
      key: "overdue-tasks",
      title: "Overdue Tasks",
      value: metrics.overdueTasks,
      icon: AlertCircle,
      variant: metrics.overdueTasks > 0 ? "warning" : "default",
      description:
        metrics.overdueTasks > 0
          ? "Tasks past their due date"
          : "You're all caught up!",
    },
    {
      key: "vision-meetings",
      title: "Vision Meetings",
      value: metrics.visionMeetingsHeld,
      icon: CalendarCheck,
      variant: "success",
      description: "Completed vision meetings",
    },
  ];
}

export function DashboardSurface({
  churchName,
  phase,
  metrics,
  activities,
  quickActions = false,
}: {
  churchName: string;
  phase: PhaseNumber;
  metrics: DashboardMetrics;
  activities: ActivityItem[];
  /**
   * Whether the week's actions stand beside the feed. The journey's last panel
   * leaves them out and gives the column to a marketing vignette instead; the
   * hero keeps them, because "here is everything you do next" is the hero's
   * whole claim.
   */
  quickActions?: boolean;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{churchName}</h1>
        <p className="text-muted-foreground mt-1">{PHASES[phase]}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards(metrics).map(({ key, ...card }) => (
          <MetricCard key={key} {...card} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityFeed activities={activities} />
        </div>
        {quickActions ? (
          <div>
            <QuickActions />
          </div>
        ) : null}
      </div>
    </div>
  );
}
