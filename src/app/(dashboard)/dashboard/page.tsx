import { getCurrentSession, getCurrentUserChurch } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChurchCreatedConfetti } from "./church-created-confetti";
import { CreateChurchCard } from "./create-church-card";
import {
  getDashboardMetrics,
  getRecentActivity,
} from "@/lib/dashboard/service";
import { PHASES, type PhaseNumber } from "@/lib/constants";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { AlertCircle, CalendarCheck, Users, UsersRound } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ churchCreated?: string }>;
}) {
  const [{ user }, resolvedSearchParams] = await Promise.all([
    getCurrentSession(),
    searchParams,
  ]);
  const { churchCreated } = resolvedSearchParams;

  // Redirect oversight users to their dedicated dashboard
  if (user?.role === "sending_church_admin" || user?.role === "network_admin") {
    redirect("/oversight");
  }

  const needsChurch = user?.role === "planter" && !user.churchId;

  if (needsChurch) {
    return (
      <div className="p-6">
        {churchCreated === "true" && <ChurchCreatedConfetti />}
        <div className="flex min-h-[60vh] items-center justify-center">
          <CreateChurchCard />
        </div>
      </div>
    );
  }

  // Fetch dashboard data
  const churchId = user!.churchId!;
  const userId = user!.id;

  const [church, metrics, activities] = await Promise.all([
    getCurrentUserChurch(),
    getDashboardMetrics(churchId, userId),
    getRecentActivity(churchId),
  ]);

  const phaseLabel =
    PHASES[(church?.currentPhase ?? 0) as PhaseNumber] ?? "Pre-Phase 1";

  return (
    <div className="p-6">
      {churchCreated === "true" && <ChurchCreatedConfetti />}

      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {church?.name ?? "Dashboard"}
          </h1>
          <p className="text-muted-foreground mt-1">{phaseLabel}</p>
        </div>

        {/* Metric Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Core Group"
            value={metrics.coreGroupSize}
            icon={UsersRound}
            variant="success"
            description="Core group, launch team & leaders"
          />
          <MetricCard
            title="Total People"
            value={metrics.totalPeople}
            icon={Users}
            description="All contacts in your pipeline"
          />
          <MetricCard
            title="Overdue Tasks"
            value={metrics.overdueTasks}
            icon={AlertCircle}
            variant={metrics.overdueTasks > 0 ? "warning" : "default"}
            description={
              metrics.overdueTasks > 0
                ? "Tasks past their due date"
                : "You're all caught up!"
            }
          />
          <MetricCard
            title="Vision Meetings"
            value={metrics.visionMeetingsHeld}
            icon={CalendarCheck}
            variant="success"
            description="Completed vision meetings"
          />
        </div>

        {/* Activity Feed + Quick Actions */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ActivityFeed activities={activities} />
          </div>
          <div>
            <QuickActions />
          </div>
        </div>
      </div>
    </div>
  );
}
