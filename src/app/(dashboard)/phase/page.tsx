// ============================================================================
// /phase — the planter's Plant Intelligence surface (PE-001/005/007/011/014/015/016).
//
// Server component. Reads the LATEST CACHED assessment with ZERO LLM calls on
// load (getLatestAssessment, PE-011), renders the planter-audience Focus panel
// (insights ordered by rank, with severity, body, cited facts, wiki links, and
// the as-of date + what-changed delta from PE-016), the soft-gated phase control
// + advisory readiness (PE-001/015), and the self-attestation toggles (PE-005).
//
// Auth: this is the planter-facing surface — only planters with a church see it.
// Oversight users are sent to their aggregate plant-health surface instead.
// ============================================================================

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { FocusPanel } from "@/components/phase-engine/focus-panel";
import {
  readBooleanSignals,
  readDelta,
} from "@/components/phase-engine/focus-presentation";
import type { InsightFeedbackState } from "@/components/phase-engine/insight-card";
import { PhaseControl } from "@/components/phase-engine/phase-control";
import { SignalToggles } from "@/components/phase-engine/signal-toggles";
import { db } from "@/db";
import { churches, insightFeedback } from "@/db/schema";
import type { InsightFeedbackRating } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import { getLatestAssessment } from "@/lib/phase-engine/assessment";
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
    .select({ currentPhase: churches.currentPhase })
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
