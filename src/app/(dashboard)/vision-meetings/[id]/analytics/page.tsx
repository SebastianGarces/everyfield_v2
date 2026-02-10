import { AnalyticsCharts } from "@/components/vision-meetings/analytics-charts";
import { verifySession } from "@/lib/auth/session";
import {
  getAttendanceTrend,
  getMeetingSummaryStats,
} from "@/lib/vision-meetings/analytics";
import { getMeeting } from "@/lib/vision-meetings/service";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface AnalyticsPageProps {
  params: Promise<{ id: string }>;
}

export default async function AnalyticsPage({ params }: AnalyticsPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, trend, stats] = await Promise.all([
    getMeeting(user.churchId, id),
    getAttendanceTrend(user.churchId),
    getMeetingSummaryStats(user.churchId),
  ]);

  if (!meeting) notFound();

  return (
    <AnalyticsCharts
      trend={trend}
      stats={stats}
      currentMeetingId={meeting.id}
    />
  );
}
