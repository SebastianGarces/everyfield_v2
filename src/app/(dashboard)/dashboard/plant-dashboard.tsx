import type { Church } from "@/db/schema";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { MetricCard } from "@/components/dashboard/metric-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { LaunchStatusCard } from "@/components/launch/launch-status-card";
import { LeadershipReentry } from "@/components/onboarding/leadership-reentry";
import { NoPlanterNudge } from "@/components/onboarding/no-planter-nudge";
import { PHASES, type PhaseNumber } from "@/lib/constants";
import {
  getDashboardMetrics,
  getRecentActivity,
} from "@/lib/dashboard/service";
import { daysUntilTarget } from "@/lib/launch/countdown";
import { getLaunchReadiness } from "@/lib/launch/milestones";
import { getLaunchForChurch } from "@/lib/launch/queries";
import {
  canAnswerLeadershipQuestion,
  shouldPromptPastorConfirmation,
  shouldShowNoPlanterNudge,
  type ChurchLeadershipState,
} from "@/lib/onboarding/leadership";
import type { OnboardingFacts } from "@/lib/onboarding/steps";
import { hasInitialPhaseDeclaration } from "@/lib/phase-engine/transitions";
import { AlertCircle, CalendarCheck, Users, UsersRound } from "lucide-react";
import { getPendingInvitationsForPlant } from "@/app/(dashboard)/settings/association/queries";
import { AssociationReminder } from "./association-reminder";
import { ChurchCreatedConfetti } from "./church-created-confetti";
import { churchHasPlanterUser } from "./confirm-leadership";
import { incompleteOnboardingItems } from "./incomplete-onboarding";
import { IncompleteOnboardingIndicator } from "./incomplete-onboarding-indicator";
import { PastorConfirmationPrompt } from "./pastor-confirmation-prompt";
import { isPlantOwner, type SeatFields } from "@/lib/auth/tenancy";
import { holdsSeatFor } from "@/lib/auth/seat-rules";

/** The signed-in user, as far as the finished dashboard is concerned. */
export type PlantDashboardViewer = SeatFields & {
  id: string;
  /**
   * Non-null BY CONTRACT: the page guards the no-church viewer (a coach, or a
   * team member whose plant link is gone) before this component renders and
   * shows them `NoPlantEmptyState` instead (ruled 2026-08-12, 408-2B). Every
   * read below may therefore scope to a real plant, with no null branch to
   * carry.
   */
  churchId: string;
};

/**
 * The finished plant dashboard — the page `/dashboard` renders as once
 * `onboarding_completed_at` is set. One of the two pages the route splits
 * into; `page.tsx` holds the session, the `?step=` resolution and the
 * `shouldShowOnboarding` gate, and `onboarding-dashboard.tsx` is the other
 * half.
 */
export async function PlantDashboard({
  viewer,
  church,
  wantsLeadershipStep,
  showConfetti,
}: {
  viewer: PlantDashboardViewer;
  /** The viewer's church row, read once by the page and handed down. */
  church: Church | null;
  /** OB-004's re-entry — `?step=leadership`, already resolved by the page. */
  wantsLeadershipStep: boolean;
  showConfetti: boolean;
}) {
  const { churchId } = viewer;

  const [
    metrics,
    activities,
    hasPlanterUser,
    launchCard,
    pendingInvitations,
    declaredInPhaseHistory,
  ] = await Promise.all([
    getDashboardMetrics(churchId, viewer.id),
    getRecentActivity(churchId),
    // OB-010: the IMPLICIT assignment — a `users` row with the planter
    // role pointing here. It is what tells a church that predates OB-004
    // apart from one that genuinely has nobody leading it, and the two
    // get opposite treatment: the first is left alone, the second is
    // asked.
    churchHasPlanterUser(churchId),
    // LS-001: the launch date moved off the church row onto its own
    // entity (migration 0032), so step 3's fact is read from here now.
    //
    // LS-003/LS-005: readiness rides along on this ARM rather than
    // beside it, because it is keyed by the launch's id and cannot start
    // until the launch read has answered. Chained here, the other three
    // arms still overlap both; hoisted out, the card's progress bar
    // would cost the dashboard a serial round trip. It is skipped for a
    // launch that has no day (nothing is seeded until one is named) and
    // for a completed one (the celebrate card shows the outcome, not a
    // progress bar) — so the extra query is only run when the card will
    // actually render its answer.
    getLaunchForChurch(churchId).then(async (row) => ({
      launch: row,
      readiness:
        row?.targetDate && row.status !== "completed"
          ? await getLaunchReadiness(row.id, churchId)
          : null,
    })),
    // OV-005: the persistent reminder's data. Only the plant's OWNER can
    // answer an invitation (OV-010 / AS-003), so nobody else is asked — a
    // banner whose buttons the server refuses is worse than no banner. It rides this same
    // `Promise.all`, so the reminder costs the dashboard no serial round trip.
    isPlantOwner(viewer)
      ? getPendingInvitationsForPlant(churchId)
      : Promise.resolve([]),
    // OB-003/005: the half of step 3's fact that only phase HISTORY can
    // answer — "not sure, and no date yet" leaves `current_phase` at 0 and
    // writes no launch row (#306). The other half rides on reads this
    // dashboard already makes; the two are joined below.
    hasInitialPhaseDeclaration(churchId),
  ]);

  const { launch, readiness: launchReadiness } = launchCard;

  // The church's leadership, both explicit and implicit.
  const leadership: ChurchLeadershipState = {
    churchId,
    leadershipStatus: church?.leadershipStatus,
    hasPlanterUser,
  };

  // OB-004: the one way back INTO a finished flow. The no-planter nudge and the
  // incomplete-onboarding indicator link here; leaving onboarding is otherwise
  // one-way (ruling 2026-07-31), so this re-enters the single question rather
  // than the whole wizard — and only for somebody whose answer would be
  // accepted, which under OB-010 includes a team member of a plant with an
  // empty planter seat.
  const canAnswerLeadership = canAnswerLeadershipQuestion(viewer, leadership);

  if (wantsLeadershipStep && canAnswerLeadership) {
    return (
      <PageCanvas context="none" contentFocusTarget>
        <WorkspacePanel className="mx-auto min-h-full max-w-3xl p-4 sm:p-6">
          <LeadershipReentry leadershipStatus={church?.leadershipStatus} />
        </WorkspacePanel>
      </PageCanvas>
    );
  }

  const showNoPlanterNudge = shouldShowNoPlanterNudge(viewer, leadership);
  const showPastorPrompt = shouldPromptPastorConfirmation(viewer, leadership);

  // OB-011: which onboarding facts are still missing, read from the church row
  // rather than from any record of how far the flow got — answering a step's
  // question anywhere in the product drops it off this list. The leadership
  // row's visibility rules live with the list itself
  // (`incompleteOnboardingItems`), where its tests drive them.
  const onboardingFacts: OnboardingFacts = {
    churchId,
    leadershipStatus: church?.leadershipStatus,
    // Step 3's evidence, all of it: the attestation record AND the footprints
    // an attestation made elsewhere leaves. Neither alone is the fact — the
    // record is the only trace of "not sure, and no date yet" (#306), and the
    // columns are the only trace of a phase or a launch set through the phase
    // control (#675). The rule joining them lives on `JourneyEvidence`, not
    // here; this hands over what the reads already know. Both extra fields are
    // free — `church` came down from the page, `launch` is read three lines up.
    journey: {
      declaredInPhaseHistory,
      currentPhase: church?.currentPhase ?? 0,
      hasLaunch: launch !== null,
    },
    // Step 4's fact: anybody at all on the plant's list (OB-006).
    peopleAdded: metrics.totalPeople > 0,
  };

  const incompleteSteps = incompleteOnboardingItems(onboardingFacts, {
    canAnswerLeadership,
    pastorPromptShowing: showPastorPrompt,
    // AS-020: each row is a call to action, so a row this viewer would be
    // refused is dropped rather than shown and bounced. A Member loses every
    // row and the card with them; an Admin keeps "Add your people".
    holds: (capability) => holdsSeatFor(viewer, capability),
  });

  const phaseLabel =
    PHASES[(church?.currentPhase ?? 0) as PhaseNumber] ?? "Pre-Phase 1";

  // AS-020: two of the four quick-action tiles are CREATE verbs — Add Person
  // and Schedule Meeting — and a plant Member holds neither. This is a server
  // component with the session in hand, so it asks `holdsSeatFor` directly,
  // which is the same table `requireSeat` refuses the POST with; the tile is
  // absent rather than dimmed, per the FRD.
  //
  // The other two tiles are reads and are not named here at all. The
  // association reminder is Owner-gated at its data read above, and the
  // leadership prompts by `canAnswerLeadershipQuestion`.
  //
  // THIS COMMENT USED TO END "nothing else on this dashboard needs a gate", and
  // that sentence was wrong when it was written (#659). The Launch Sunday card
  // below told every seat to "Name the day" — `launch.schedule`, OWNER_ONLY —
  // and a sweep looking for BUTTONS walked past it, because the affordance was
  // a sentence. There are two gates on this screen now, and the next one to be
  // missed will not look like a control either.
  const quickActionCapabilities = (
    ["people.write", "meetings.write"] as const
  ).filter((capability) => holdsSeatFor(viewer, capability));

  return (
    <PageCanvas context="none" contentFocusTarget>
      {showConfetti && <ChurchCreatedConfetti />}

      <div
        data-slot="completed-dashboard-content"
        className="mx-auto min-h-full max-w-6xl space-y-6"
      >
        {/* OV-005 — first, and not dismissible. An unanswered invitation
            decides who can see this plant, so it outranks every other banner
            here and stays until it is ANSWERED. */}
        <AssociationReminder invitations={pendingInvitations} />

        {showPastorPrompt && (
          <PastorConfirmationPrompt churchId={leadership.churchId} />
        )}

        {showNoPlanterNudge && <NoPlanterNudge />}

        <IncompleteOnboardingIndicator
          items={incompleteSteps}
          churchId={churchId}
        />

        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {church?.name ?? "Dashboard"}
          </h1>
          <p className="text-foreground mt-1 text-sm">{phaseLabel}</p>
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
              // #659: the card's no-date line is a call to action, and naming
              // the day is `launch.schedule`. Asked of the CAPABILITY TABLE —
              // the same declaration `requireSeat` refuses the write with — so
              // the sentence a Member reads and the answer the server would
              // give cannot drift apart.
              canSchedule={holdsSeatFor(viewer, "launch.schedule")}
              outcome={
                launch
                  ? {
                      attendanceCount: launch.attendanceCount,
                      decisionsCount: launch.decisionsCount,
                    }
                  : undefined
              }
            />
            <QuickActions capabilities={quickActionCapabilities} />
          </div>
        </div>
      </div>
    </PageCanvas>
  );
}
