import { getCurrentSession, getCurrentUserChurch } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChurchCreatedConfetti } from "./church-created-confetti";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import {
  resolveResumeStep,
  shouldShowOnboarding,
} from "@/lib/onboarding/steps";
import { churchHasNoPlanter } from "@/lib/onboarding/leadership";
import { NoPlanterNudge } from "@/components/onboarding/no-planter-nudge";
import { LeadershipReentry } from "@/components/onboarding/leadership-reentry";
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
  searchParams: Promise<{ churchCreated?: string; step?: string }>;
}) {
  const [{ user }, resolvedSearchParams] = await Promise.all([
    getCurrentSession(),
    searchParams,
  ]);
  const { churchCreated, step } = resolvedSearchParams;

  // OB-004: `?step=leadership` is the ONLY step a URL may ask for, and only for
  // a planter whose church already exists. Honouring an arbitrary `?step=`
  // would let someone deep-link past step 1 into a form that updates a church
  // they have not created yet; anything else here is simply ignored.
  const wantsLeadershipStep = step === "leadership";

  // Redirect oversight users to their dedicated dashboard
  if (user?.role === "sending_church_admin" || user?.role === "network_admin") {
    redirect("/oversight");
  }

  // F12 / OB-001: the onboarding flow is the primary dashboard content for a
  // planter who has not finished setting up — whether that means no church at
  // all, or a church created at step 1 and then abandoned. `getCurrentUserChurch`
  // is request-cached, so reading it here does not cost the render below a query.
  const churchDuringOnboarding = await getCurrentUserChurch();

  if (
    shouldShowOnboarding({
      role: user?.role,
      churchId: user?.churchId,
      onboardingCompletedAt: churchDuringOnboarding?.onboardingCompletedAt,
    })
  ) {
    return (
      <div className="p-6">
        <OnboardingFlow
          initialStep={
            wantsLeadershipStep && user?.churchId
              ? "leadership"
              : resolveResumeStep({
                  churchId: user?.churchId,
                  leadershipStatus: churchDuringOnboarding?.leadershipStatus,
                })
          }
          leadershipStatus={churchDuringOnboarding?.leadershipStatus}
        />
      </div>
    );
  }

  // OB-004: the one way back INTO a finished flow. The no-planter nudge links
  // here; leaving onboarding is otherwise one-way (ruling 2026-07-31), so this
  // re-enters the single question rather than the whole wizard, and only for
  // the planter who can actually answer it.
  const isPlanterWithChurch = user?.role === "planter" && !!user.churchId;

  if (isPlanterWithChurch && wantsLeadershipStep) {
    return (
      <div className="p-6">
        <LeadershipReentry
          leadershipStatus={churchDuringOnboarding?.leadershipStatus}
        />
      </div>
    );
  }

  const showNoPlanterNudge =
    isPlanterWithChurch &&
    churchHasNoPlanter({
      leadershipStatus: churchDuringOnboarding?.leadershipStatus,
    });

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
        {showNoPlanterNudge && <NoPlanterNudge />}

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
