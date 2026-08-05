// ============================================================================
// /phase — the planter's Plant Intelligence surface (PE-001/005/007/011/014/015/016/023).
//
// Server component. Reads the LATEST CACHED assessment with ZERO LLM calls on
// load (getLatestAssessment, PE-011), renders the planter-audience Focus panel
// (insights ordered by rank, with severity, body, cited facts, wiki links, and
// the as-of date + what-changed delta from PE-016), the CSF scorecard projected
// from that same snapshot (PE-023), the soft-gated phase control + advisory
// readiness (PE-001/015), and the self-attestation toggles (PE-005).
//
// Auth: this is the planter-facing surface — only planters with a church see it.
// Oversight users are sent to their aggregate plant-health surface instead.
// ============================================================================

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { CsfScorecard } from "@/components/phase-engine/csf-scorecard";
import { FocusPanel } from "@/components/phase-engine/focus-panel";
import {
  readBooleanSignals,
  readDelta,
} from "@/components/phase-engine/focus-presentation";
import type { InsightFeedbackState } from "@/components/phase-engine/insight-card";
import { PhaseControl } from "@/components/phase-engine/phase-control";
import { SignalToggles } from "@/components/phase-engine/signal-toggles";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { churches, insightFeedback } from "@/db/schema";
import type { InsightFeedbackRating } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import {
  buildCsfScorecard,
  getLatestAssessment,
} from "@/lib/phase-engine/assessment";
import { assessmentColdStart } from "@/lib/phase-engine/cold-start";
import { listManualSignals } from "@/lib/phase-engine/signals/attestation-service";
import { getPhaseReadiness } from "@/lib/phase-engine/transitions";

export const metadata = {
  title: "Plant Intelligence",
  description: "Your prioritized focus, phase control, and self-attestations.",
};

export default async function PhasePage() {
  const { user } = await getCurrentSession();

  if (!user) {
    redirect("/login");
  }

  // Planter-facing surface only. Oversight users have their own aggregate view.
  if (user.role !== "planter" || !user.churchId) {
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

  // All reads below are pure DB reads — ZERO LLM calls on load (PE-011).
  const [latest, readiness, manualSignals] = await Promise.all([
    getLatestAssessment(churchId),
    getPhaseReadiness(churchId),
    listManualSignals(churchId),
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

  // The CSF scorecard (PE-023) is a pure projection of the SAME snapshot the
  // Focus panel renders — built here rather than re-read, so the two halves of
  // the page can never disagree and the page still costs one assessment read.
  // Null when the plant has never completed an assessment; the component turns
  // that into a cold-start state rather than eight empty rows.
  const scorecard = buildCsfScorecard(latest, "planter");

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
        {/* Scorecard first, focus list second: the breakdown says WHERE the
            plant stands, the focus list says what to do about it. */}
        <div className="space-y-6 lg:col-span-2">
          <CsfScorecard scorecard={scorecard} />
          <FocusPanel
            assessment={latest?.assessment ?? null}
            insights={planterInsights}
            delta={delta}
            feedbackByInsightId={feedbackByInsightId}
          />
        </div>

        <div className="space-y-6">
          <PhaseControl
            churchId={churchId}
            currentPhase={church.currentPhase}
            readiness={readiness}
          />
          <SignalToggles initialValues={booleanSignals} />
        </div>
      </div>
    </div>
  );
}
