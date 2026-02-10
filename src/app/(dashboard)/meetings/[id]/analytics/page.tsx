import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getMeeting } from "@/lib/meetings/service";
import {
  getAttendanceTrend,
  getMeetingSummaryStats,
} from "@/lib/meetings/analytics";
import { notFound } from "next/navigation";
import { AnalyticsCharts } from "@/components/meetings/analytics-charts";

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
    getAttendanceTrend(user.churchId, 12, "vision_meeting"),
    getMeetingSummaryStats(user.churchId, "vision_meeting"),
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
