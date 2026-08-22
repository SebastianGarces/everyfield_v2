// ============================================================================
// /phase — the planter's Plant Intelligence surface
// (PE-001/005/007/011/014/015/016/022/023/025/026/027).
//
// Server component. Reads the LATEST CACHED assessment with ZERO LLM calls on
// load (getLatestAssessment, PE-011), renders the planter-audience Focus panel
// (insights ordered by rank, with severity, body, cited facts, wiki links, and
// the as-of date + what-changed delta from PE-016), the CSF scorecard projected
// from that same snapshot (PE-023), the current phase's exit criteria with
// their fact drill-down projected from that snapshot too (PE-022/025), the four
// deterministic trends read out of the PERSISTED snapshot series (PE-026), the
// milestone timeline including Launch Sunday (PE-027), the soft-gated phase
// control + advisory readiness (PE-001/015), and the self-attestation toggles
// (PE-005).
//
// Auth: this is the planter-facing surface — only planters with a church see it.
// Oversight users are sent to their aggregate plant-health surface instead.
// ============================================================================

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { CsfScorecard } from "@/components/phase-engine/csf-scorecard";
import { ExitCriteria } from "@/components/phase-engine/exit-criteria";
import { FocusPanel } from "@/components/phase-engine/focus-panel";
import {
  readAttestationAges,
  readBooleanSignals,
  readDelta,
} from "@/components/phase-engine/focus-presentation";
import type { InsightFeedbackState } from "@/components/phase-engine/insight-card";
import { MilestoneTimeline } from "@/components/phase-engine/milestone-timeline";
import { PhaseControl } from "@/components/phase-engine/phase-control";
import { SignalToggles } from "@/components/phase-engine/signal-toggles";
import { PlanterCheckinCard } from "@/components/phase-engine/planter-checkin-card";
import {
  checkinNudges,
  CHECKIN_HISTORY_WEEKS,
  hasAnsweredThisWeek,
  recentWeekStarts,
} from "@/lib/phase-engine/planter-checkin";
import { listRecentCheckins } from "@/lib/phase-engine/planter-checkin-db";
import { Trends } from "@/components/phase-engine/trends";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { churches, insightFeedback } from "@/db/schema";
import type { InsightFeedbackRating } from "@/db/schema";
import { verifySession } from "@/lib/auth";
import {
  buildCsfScorecard,
  buildExitCriteriaProgress,
  getLatestAssessment,
  markAssessmentSeenByPlanter,
} from "@/lib/phase-engine/assessment";
import { assessmentColdStart } from "@/lib/phase-engine/cold-start";
import { listManualSignals } from "@/lib/phase-engine/signals/attestation-service";
import { getMilestoneTimeline } from "@/lib/phase-engine/signals/milestones";
import { getPlantTrends } from "@/lib/phase-engine/signals/trends";
import { getPhaseReadiness } from "@/lib/phase-engine/transitions";
import { isPlantOwner } from "@/lib/auth/tenancy";

export const metadata = {
  title: "Plant Intelligence",
  description: "Your prioritized focus, phase control, and self-attestations.",
};

export default async function PhasePage() {
  // The `(dashboard)` layout is what bounces a signed-out reader, and it is
  // the only place that does (#503). This asks for the session the layout has
  // already established so `user` is non-null; a second `redirect("/login")`
  // here would be a second bounce racing the first, and it wrote no return
  // path.
  const { user } = await verifySession();

  // Owner-facing surface only. An oversight tenancy has its own aggregate view.
  if (!isPlantOwner(user) || !user.churchId) {
    redirect("/dashboard");
  }

  const churchId = user.churchId;

  // Current phase for the church (the phase control's starting point).
  const [church] = await db
    .select({
      currentPhase: churches.currentPhase,
      // OB-009: what makes the cold start "queued" rather than "quiet" — set
      // when onboarding completes and by every material event since.
      lastMaterialEventAt: churches.lastMaterialEventAt,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!church) {
    redirect("/dashboard");
  }

  // ONE CLOCK READ for the whole page. Every week boundary and every
  // attestation age under it is measured against this instant, so nothing
  // recomputes it and disagrees with the markup beside it
  // (`memory/invariants.md` → Date & Time Rendering).
  const now = new Date();

  // All reads below are pure DB reads — ZERO LLM calls on load (PE-011).
  //
  // The check-ins (#484) ride along here and go NOWHERE ELSE: they are read for
  // this page, rendered on this page, and touch no signal, no snapshot and no
  // oversight payload. A plant can hit every launch metric while the planter is
  // falling apart, so the care state is read beside the assessment rather than
  // on a page somebody has to go looking for.
  const [latest, readiness, manualSignals, checkins] = await Promise.all([
    getLatestAssessment(churchId),
    getPhaseReadiness(churchId),
    listManualSignals(churchId),
    listRecentCheckins(churchId, now),
  ]);

  // OPENING THIS PAGE IS WHAT RELEASES THE ASSESSMENT TO OVERSIGHT (#482).
  // Bryan: "The planter should never discover the diagnosis through his
  // overseer." The stamp is written once (the writer guards on `IS NULL`), and
  // nothing on this page depends on it — a failure here just leaves release to
  // the 72-hour arm rather than blocking the planter from reading their own
  // assessment, which would invert the rule.
  if (latest) {
    await markAssessmentSeenByPlanter(churchId, latest.assessment.id);
  }

  // The trends (PE-026) and the milestone timeline (PE-027). Both take the
  // `latest` above rather than re-reading it, so the alert badges they carry are
  // the SAME assessment's severities the Focus panel and the scorecard render —
  // one assessment read for the whole page. Run together, after `latest`
  // resolves, because both need it as an argument.
  const [trends, timeline] = await Promise.all([
    getPlantTrends(churchId, latest, "planter"),
    getMilestoneTimeline(churchId, latest, "planter"),
  ]);

  // Planter-audience insights only, already ordered by rank (PE-011).
  const planterInsights = (latest?.insights ?? []).filter(
    (insight) => insight.audience === "planter"
  );

  // The current user's prior feedback for the rendered insights (PE-014), so
  // thumbs/comments render pre-filled. Single church-scoped query (no N+1).
  const feedbackByInsightId: Record<string, InsightFeedbackState> = {};
  if (planterInsights.length > 0) {
    const insightIds = planterInsights.map((insight) => insight.id);
    const rows = await db
      .select({
        insightId: insightFeedback.insightId,
        rating: insightFeedback.rating,
        comment: insightFeedback.comment,
      })
      .from(insightFeedback)
      .where(
        and(
          eq(insightFeedback.churchId, churchId),
          eq(insightFeedback.userId, user.id),
          inArray(insightFeedback.insightId, insightIds)
        )
      );

    for (const row of rows) {
      feedbackByInsightId[row.insightId] = {
        rating: row.rating as InsightFeedbackRating,
        comment: row.comment,
      };
    }
  }

  const delta = latest ? readDelta(latest.assessment.factSnapshot) : null;
  const booleanSignals = readBooleanSignals(manualSignals);
  // ONE clock read for the ages the card renders (#474 D2). Two ages computed
  // a millisecond apart can straddle a day boundary and disagree.
  const attestationAges = readAttestationAges(manualSignals, now);

  // The strip's twelve slots, with the unanswered ones drawn as gaps rather
  // than skipped (#484): three unanswered weeks in a row is part of the
  // picture.
  const byWeek = new Map(
    checkins.map((checkin) => [checkin.weekStart.slice(0, 10), checkin])
  );
  const checkinWeeks = recentWeekStarts(now, CHECKIN_HISTORY_WEEKS).map(
    (weekStart) => {
      const checkin = byWeek.get(weekStart);
      return {
        weekStart,
        levels: checkin
          ? {
              spiritually: checkin.spiritually,
              marriageFamily: checkin.marriageFamily,
              financially: checkin.financially,
              pace: checkin.pace,
            }
          : null,
      };
    }
  );

  // The CSF scorecard (PE-023) is a pure projection of the SAME snapshot the
  // Focus panel renders — built here rather than re-read, so the two halves of
  // the page can never disagree and the page still costs one assessment read.
  // Null when the plant has never completed an assessment; the component turns
  // that into a cold-start state rather than eight empty rows.
  const scorecard = buildCsfScorecard(latest, "planter");

  // The exit criteria (PE-022 + PE-025) are the same kind of projection over the
  // SAME `latest` and the same audience — "what is left before I can move on?"
  // to the scorecard's "where does the plant stand?". Built here for the same
  // reason: one assessment read for the whole page, and the two cards can never
  // disagree. Null (never assessed) is the component's own cold-start branch.
  const exitCriteria = buildExitCriteriaProgress(latest, "planter");

  // OB-009: before the first run this page is eight empty panels, and "nothing
  // here" reads as a broken product rather than as a schedule. The notice says
  // which of the two cold starts this is and when the first read arrives; it
  // disappears the moment there is an assessment to render.
  const coldStart = assessmentColdStart({
    hasAssessment: latest !== null,
    lastMaterialEventAt: church.lastMaterialEventAt,
  });

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Plant Intelligence
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your prioritized focus, phase control, and self-attestations — read
          from the latest assessment.
        </p>
        {/* #485 (C20) — the scope, said out loud on the surface rather than
            only in the rubric. Bryan: "the product should be really clear
            about which of those two things it is claiming to assess." */}
        <p className="text-muted-foreground mt-1 max-w-[70ch] text-sm text-pretty">
          Plant Intelligence assesses your progress toward a healthy launch —
          not the full health of a church.
        </p>
      </header>

      {coldStart && (
        <Card data-testid="assessment-cold-start">
          <CardHeader>
            <CardTitle>
              <h2>{coldStart.title}</h2>
            </CardTitle>
            <CardDescription className="max-w-[65ch] text-pretty">
              {coldStart.body}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Scorecard, then exit criteria, then the trends, then the focus list:
            where the plant stands → what is left before it moves on → which way
            it is moving → what to do about it. The trends sit above the focus
            list because they are evidence for it, and below the exit criteria
            because a direction only means something once the target is known. */}
        <div className="space-y-6 lg:col-span-2">
          <CsfScorecard scorecard={scorecard} />
          <ExitCriteria progress={exitCriteria} />
          <Trends trends={trends} />
          <FocusPanel
            assessment={latest?.assessment ?? null}
            insights={planterInsights}
            delta={delta}
            feedbackByInsightId={feedbackByInsightId}
          />
        </div>

        <div className="space-y-6">
          <PhaseControl
            currentPhase={church.currentPhase}
            readiness={readiness}
          />
          {/* The timeline sits under the phase control, not in the main column:
              it is the dated record of the moves that control makes plus the day
              the plant is heading for, so the two read as one column about
              where the plant is in time. Keeping it out of the main column also
              leaves the focus list — the only part of the page a planter acts
              on — directly under the evidence for it. */}
          {/* #484 — the private one. It sits in the same column as the
              assessment, deliberately: launch-green may not be shown without
              the planter's own state beside it. */}
          <PlanterCheckinCard
            needsAnswer={!hasAnsweredThisWeek(checkins, now)}
            weeks={checkinWeeks}
            nudges={checkinNudges(checkins)}
          />
          <MilestoneTimeline timeline={timeline} />
          <SignalToggles
            initialValues={booleanSignals}
            attestedDaysAgo={attestationAges}
          />
        </div>
      </div>
    </div>
  );
}
