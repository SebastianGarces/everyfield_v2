import { getCurrentSession, getCurrentUserChurch } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChurchCreatedConfetti } from "./church-created-confetti";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import {
  FIRST_ONBOARDING_STEP,
  isOnboardingStepId,
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
import { getLaunchForChurch } from "@/lib/launch/queries";
import { getLaunchReadiness } from "@/lib/launch/milestones";
import { daysUntilTarget } from "@/lib/launch/countdown";
import { hasInitialPhaseDeclaration } from "@/lib/phase-engine/transitions";
import { LaunchStatusCard } from "@/components/launch/launch-status-card";
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

  // OB-004: the one step a FINISHED dashboard answers to. Re-entry is a single
  // question, not the whole wizard (ruling 2026-07-31), so this stays a check
  // for one literal value rather than becoming "any step" alongside #373 below.
  const wantsLeadershipStep = step === "leadership";

  // #373: while the flow is still running the URL names the step it is showing,
  // so `?step=` addresses any of the four — read here and written by the flow
  // itself (`onboarding-flow-client.tsx`). An unrecognised value names no step
  // and is left to the resume rule.
  const requestedStep = isOnboardingStepId(step) ? step : null;

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
    // OB-003/005: step 3's fact is asked of phase HISTORY, not of
    // `current_phase` or of the launch row — "not sure, and no date yet" is a
    // real answer that leaves both of those exactly as a planter who never saw
    // the step would leave them. Only asked when there is a church to ask about.
    const journeyDeclared = user?.churchId
      ? await hasInitialPhaseDeclaration(user.churchId)
      : false;

    // The guard OB-004 already carried, widened from one step to four: a URL
    // may name a step only once step 1's church EXISTS. Deep-linking past step
    // 1 without one lands on a form that would update a church the planter has
    // not created — so step 1 is the only step a churchless planter may be
    // addressed to, and it is also the only step they resume to.
    const honouredStep =
      requestedStep &&
      (user?.churchId || requestedStep === FIRST_ONBOARDING_STEP)
        ? requestedStep
        : null;

    // Refusing is a REDIRECT, not a shrug (#373). The flow now reads its step
    // from the URL, so a refused value left sitting in the address bar would be
    // read by the client on the very next render and honoured there instead —
    // the server's answer has to be the one in the URL, and this is what makes
    // it so. Only reached when a step was asked for and declined, so a plain
    // `/dashboard` never redirects and neither does the `?step=basics` the flow
    // stamps for a planter who has no church yet.
    if (requestedStep && !honouredStep) {
      redirect("/dashboard");
    }

    return (
      <div className="p-6">
        <OnboardingFlow
          initialStep={
            honouredStep ??
            resolveResumeStep({
              churchId: user?.churchId,
              leadershipStatus: churchDuringOnboarding?.leadershipStatus,
              journeyDeclared,
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

  const [
    church,
    metrics,
    activities,
    hasPlanterUser,
    launchCard,
    journeyDeclared,
  ] = await Promise.all([
    getCurrentUserChurch(),
    getDashboardMetrics(churchId, userId),
    getRecentActivity(churchId),
    // OB-010: the IMPLICIT assignment — a `users` row with the planter role
    // pointing here. It is what tells a church that predates OB-004 apart from
    // one that genuinely has nobody leading it, and the two get opposite
    // treatment: the first is left alone, the second is asked.
    churchHasPlanterUser(churchId),
    // LS-001: the launch date moved off the church row onto its own entity
    // (migration 0032), so step 3's fact is read from here now.
    //
    // LS-003/LS-005: readiness rides along on this ARM rather than beside it,
    // because it is keyed by the launch's id and cannot start until the launch
    // read has answered. Chained here, the other three arms still overlap
    // both; hoisted out, the card's progress bar would cost the dashboard a
    // serial round trip. It is skipped for a launch that has no day (nothing
    // is seeded until one is named) and for a completed one (the celebrate
    // card shows the outcome, not a progress bar) — so the extra query is only
    // run when the card will actually render its answer.
    getLaunchForChurch(churchId).then(async (row) => ({
      launch: row,
      readiness:
        row?.targetDate && row.status !== "completed"
          ? await getLaunchReadiness(row.id, churchId)
          : null,
    })),
    // OB-003/005: step 3's fact. Phase HISTORY, not `current_phase` and not
    // the launch row — "not sure, and no date yet" is a real answer that
    // leaves both of those looking exactly like never having been asked.
    hasInitialPhaseDeclaration(churchId),
  ]);

  const { launch, readiness: launchReadiness } = launchCard;

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
    // Step 3's fact, read from the record the declaration itself writes (#306).
    // It used to be inferred from the columns — a launch date, or a phase above
    // 0 — and that inference could not see the honest answer: a planter who
    // said "not sure" and "no date yet" leaves phase 0 and no launch row, and
    // was nagged forever to answer a question they had answered.
    journeyDeclared,
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
          <div className="space-y-6">
            {/* LS-005: the compact countdown/status card. The countdown is
                computed HERE with `daysUntilTarget` — the one implementation,
                shared with /launch and the phase-engine snapshot — and handed
                down as a number, so no card can re-derive it and disagree
                (#338). */}
            <LaunchStatusCard
              targetDate={launch?.targetDate ?? null}
              status={launch?.status ?? null}
              daysUntil={daysUntilTarget(
                launch?.targetDate ?? null,
                new Date()
              )}
              readiness={launchReadiness}
              outcome={
                launch
                  ? {
                      attendanceCount: launch.attendanceCount,
                      decisionsCount: launch.decisionsCount,
                    }
                  : undefined
              }
            />
            <QuickActions />
          </div>
        </div>
      </div>
    </div>
  );
}
