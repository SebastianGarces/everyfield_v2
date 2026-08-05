import { getCurrentSession, getCurrentUserChurch } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChurchCreatedConfetti } from "./church-created-confetti";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import {
  resolveResumeStep,
  shouldShowOnboarding,
  type OnboardingFacts,
} from "@/lib/onboarding/steps";
import {
  canAnswerLeadershipQuestion,
  shouldPromptPastorConfirmation,
  shouldShowNoPlanterNudge,
  type ChurchLeadershipState,
} from "@/lib/onboarding/leadership";
import { NoPlanterNudge } from "@/components/onboarding/no-planter-nudge";
import { LeadershipReentry } from "@/components/onboarding/leadership-reentry";
import { churchHasPlanterUser } from "./confirm-leadership";
import { incompleteOnboardingItems } from "./incomplete-onboarding";
import { IncompleteOnboardingIndicator } from "./incomplete-onboarding-indicator";
import { PastorConfirmationPrompt } from "./pastor-confirmation-prompt";
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
  // somebody whose answer would be accepted (below). Honouring an arbitrary
  // `?step=` would let someone deep-link past step 1 into a form that updates a
  // church they have not created yet; anything else here is simply ignored.
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

  // Fetch dashboard data
  const churchId = user!.churchId!;
  const userId = user!.id;

  const [church, metrics, activities, hasPlanterUser] = await Promise.all([
    getCurrentUserChurch(),
    getDashboardMetrics(churchId, userId),
    getRecentActivity(churchId),
    // OB-010: the IMPLICIT assignment — a `users` row with the planter role
    // pointing here. It is what tells a church that predates OB-004 apart from
    // one that genuinely has nobody leading it, and the two get opposite
    // treatment: the first is left alone, the second is asked.
    churchHasPlanterUser(churchId),
  ]);

  const leadership: ChurchLeadershipState = {
    churchId,
    leadershipStatus: church?.leadershipStatus,
    hasPlanterUser,
  };

  const viewer = { role: user?.role, churchId: user?.churchId };

  // OB-004: the one way back INTO a finished flow. The no-planter nudge and the
  // incomplete-onboarding indicator link here; leaving onboarding is otherwise
  // one-way (ruling 2026-07-31), so this re-enters the single question rather
  // than the whole wizard — and only for somebody whose answer would be
  // accepted, which under OB-010 includes a team member of a plant with an
  // empty planter seat.
  const canAnswerLeadership = canAnswerLeadershipQuestion(viewer, leadership);

  if (wantsLeadershipStep && canAnswerLeadership) {
    return (
      <div className="p-6">
        <LeadershipReentry leadershipStatus={church?.leadershipStatus} />
      </div>
    );
  }

  const showNoPlanterNudge = shouldShowNoPlanterNudge(viewer, leadership);
  const showPastorPrompt = shouldPromptPastorConfirmation(viewer, leadership);

  // OB-011: which onboarding facts are still missing, read from the church row
  // rather than from any record of how far the flow got — answering a step's
  // question anywhere in the product drops it off this list.
  const onboardingFacts: OnboardingFacts = {
    churchId,
    leadershipStatus: church?.leadershipStatus,
    // Step 3's fact, read from the columns it will write: a declared stage or a
    // target launch date. Either is a declaration; phase 0 with no date is
    // exactly the "told us nothing" state. When step 3 ships its own record of
    // the declaration (including the explicit "no date yet"), this line is what
    // reads it instead — `OnboardingFacts` is optional per fact so that until
    // then the answer is honestly "incomplete" rather than wrong.
    journeyDeclared: !!church?.launchDate || (church?.currentPhase ?? 0) > 0,
    // Step 4's fact: anybody at all on the plant's list (OB-006).
    peopleAdded: metrics.totalPeople > 0,
  };

  // The leadership row is the raw fact — "nobody answered the question" — so it
  // is filtered twice before it can mislead. It is dropped for anybody whose
  // answer would be refused (a link that quietly does nothing is worse than no
  // link), and dropped while the pastor prompt is up, since that IS this
  // question and asking it twice on one screen reads as a bug. What survives is
  // the case the indicator is for: somebody who can answer, is not being asked,
  // and never did — a planter who skipped step 2, or a plant that predates the
  // flow entirely.
  const incompleteSteps = incompleteOnboardingItems(onboardingFacts).filter(
    (item) =>
      item.id !== "leadership" || (canAnswerLeadership && !showPastorPrompt)
  );

  const phaseLabel =
    PHASES[(church?.currentPhase ?? 0) as PhaseNumber] ?? "Pre-Phase 1";

  return (
    <div className="p-6">
      {churchCreated === "true" && <ChurchCreatedConfetti />}

      <div className="mx-auto max-w-6xl space-y-6">
        {showPastorPrompt && <PastorConfirmationPrompt churchId={churchId} />}

        {showNoPlanterNudge && <NoPlanterNudge />}

        <IncompleteOnboardingIndicator
          items={incompleteSteps}
          churchId={churchId}
        />

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
