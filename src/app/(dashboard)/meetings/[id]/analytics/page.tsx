import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AnalyticsCharts } from "@/components/meetings/analytics-charts";
import { verifySession } from "@/lib/auth/session";
import {
  getAttendanceTrend,
  getMeetingSummaryStats,
} from "@/lib/meetings/analytics";
import {
  analyticsMeetingTypeArg,
  analyticsMeetingTypeLabel,
  MEETING_TYPE_FILTERS,
  parseAnalyticsMeetingTypeFilter,
} from "@/lib/meetings/analytics-filter";
import { getMeeting } from "@/lib/meetings/service";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** How many meetings the trend charts plot. */
const TREND_LIMIT = 12;

interface AnalyticsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Meeting analytics (VM-010 / VM-010k).
 *
 * The meeting-type filter lives in the URL rather than in client state: the
 * figures are computed on the server, so the filter has to reach the server to
 * change them, and a shared or reloaded link then shows the same figures it
 * showed the person who sent it. That also keeps this page a plain server
 * component — no client boundary, no server data in `useState`
 * (memory/contracts/data-patterns.md).
 *
 * With no `?type=` the view is exactly what it was before it became
 * filterable: completed vision meetings.
 */
export default async function AnalyticsPage({
  params,
  searchParams,
}: AnalyticsPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const [{ id }, query] = await Promise.all([params, searchParams]);

  const filter = parseAnalyticsMeetingTypeFilter(query.type);
  const typeArg = analyticsMeetingTypeArg(filter);

  const [meeting, trend, stats] = await Promise.all([
    getMeeting(user.churchId, id),
    getAttendanceTrend(user.churchId, TREND_LIMIT, typeArg),
    getMeetingSummaryStats(user.churchId, typeArg),
  ]);

  if (!meeting) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <nav
          aria-label="Filter analytics by meeting type"
          className="flex flex-wrap gap-2"
          data-testid="analytics-type-filter"
        >
          {MEETING_TYPE_FILTERS.map((option) => {
            const isActive = option.value === filter;
            return (
              <Link
                key={option.value}
                href={`/meetings/${meeting.id}/analytics?type=${option.value}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>

        {/*
          Say what the figures count. Every tile below is scoped to the active
          filter AND to completed meetings, and a planter comparing two filters
          needs to know both — an unlabelled "Total Meetings" of 3 looks like a
          church with three meetings.
        */}
        <p
          className="text-muted-foreground text-sm"
          data-testid="analytics-scope"
        >
          Showing completed{" "}
          {filter === "all"
            ? "meetings"
            : analyticsMeetingTypeLabel(filter).toLowerCase()}
          , most recent {TREND_LIMIT}.
        </p>
      </div>

      <AnalyticsCharts trend={trend} stats={stats} />
    </div>
  );
}
