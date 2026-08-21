// ============================================================================
// FocusPanel — the planter's prioritized Focus surface (PE-007/009/011/016).
//
// Presentational server component. Renders the planter-audience insights from
// the latest CACHED assessment (the caller read it with getLatestAssessment —
// ZERO LLM calls on load, PE-011), ordered by rank. Shows the "as of <date>"
// the assessment was generated and the what-changed delta carried on the stored
// snapshot (PE-016). Each insight is an InsightCard with its severity, body,
// cited facts, wiki links, and feedback control.
//
// This component performs NO data access itself — it is handed the assessment,
// its insights, and the current user's prior feedback by the page. (Its
// InsightCard child does read the published-wiki slug index; see PE-024 there.)
//
// One escape hatch, for the one caller that has no database: pass `articleRefs`
// and the panel renders the pure `InsightCardView` with them instead of the
// reading, island-mounting `InsightCard` (issue #296 — the marketing page
// embeds this panel live from a fixture). Omit it, as the app does, and nothing
// about this component changes.
// ============================================================================

import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import {
  allocateFocus,
  deltaFieldLabel,
} from "@/components/phase-engine/focus-presentation";
import {
  InsightCard,
  type InsightFeedbackState,
} from "@/components/phase-engine/insight-card";
import {
  InsightCardView,
  type InsightArticleRef,
} from "@/components/phase-engine/insight-card-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  AssessedInsight,
  SnapshotDelta,
  SnapshotDeltaField,
} from "@/lib/phase-engine/assessment";
import type { PlantAssessment } from "@/db/schema";

// ----------------------------------------------------------------------------
// What-changed presentation (PE-016).
// ----------------------------------------------------------------------------

function formatValue(value: number | null): string {
  return value === null ? "—" : String(value);
}

function WhatChanged({ delta }: { delta: SnapshotDelta }) {
  if (delta.isFirstAssessment) {
    return (
      <p className="text-muted-foreground text-xs">
        This is the first assessment for your plant — nothing to compare against
        yet.
      </p>
    );
  }

  if (delta.changed.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No tracked metrics changed since the last assessment.
      </p>
    );
  }

  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        What changed
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {delta.changed.map((field) => (
          <DeltaChip key={field.path} field={field} />
        ))}
      </ul>
    </div>
  );
}

function DeltaChip({ field }: { field: SnapshotDeltaField }) {
  const { delta } = field;
  const Icon =
    delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  const tone =
    delta === null || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-amber-600 dark:text-amber-400";

  return (
    <li className="bg-muted/50 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
      <span className="font-medium">{deltaFieldLabel(field.path)}</span>
      <span className="text-muted-foreground">
        {formatValue(field.previous)} → {formatValue(field.current)}
      </span>
      {delta !== null && (
        <span
          className={`inline-flex items-center gap-0.5 font-medium ${tone}`}
        >
          <Icon className="h-3 w-3" aria-hidden />
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </li>
  );
}

// ----------------------------------------------------------------------------
// Focus panel
// ----------------------------------------------------------------------------

const AS_OF_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

interface FocusPanelProps {
  assessment: PlantAssessment | null;
  /**
   * Planter-audience insights, already ordered by rank.
   *
   * `AssessedInsight`, not a bare `PlantInsight`, so each row's resolved
   * `citedFactSignals` survive the trip to the card that renders them — a
   * `PlantInsight` is still accepted (the field is optional, which is what keeps
   * the marketing fixture valid), it just reads its attestations generically.
   */
  insights: AssessedInsight[];
  /** The what-changed delta carried on the stored snapshot (PE-016). */
  delta: SnapshotDelta | null;
  /** Prior feedback keyed by insight id, for the current user. */
  feedbackByInsightId?: Record<string, InsightFeedbackState>;
  /**
   * Published-wiki refs to resolve the insights' "how to improve" slugs against
   * (PE-024) — for callers that cannot reach the database.
   *
   * The app omits this: `InsightCard` does that read itself (React.cache-deduped,
   * one query per panel) and mounts the feedback island. Supplying it swaps in
   * the pure `InsightCardView`, which means no read and no feedback control —
   * correct for the marketing embed (issue #296), wrong for the app.
   */
  articleRefs?: InsightArticleRef[];
  /** Forwarded to each `InsightCardView`: render its article references as
   *  inert markup instead of links — for presentational embeds (the marketing
   *  page). Absent, as in the app, this panel is unchanged. */
  linkStatic?: boolean;
}

export function FocusPanel({
  assessment,
  insights,
  delta,
  feedbackByInsightId = {},
  articleRefs,
  linkStatic,
}: FocusPanelProps) {
  if (!assessment) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your focus</CardTitle>
          <CardDescription>
            No assessment has run for your plant yet. As you add core-group
            members, hold vision meetings, and attest your progress, your
            prioritized focus will appear here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const asOf = AS_OF_FORMAT.format(new Date(assessment.generatedAt));

  // The budget is applied HERE and nowhere else, over insights the caller has
  // already ranked (#478). One splitter, so the hero, the supplements and the
  // "going well" block cannot disagree about which insight is which.
  const focus = allocateFocus(insights);

  const card = (insight: AssessedInsight) =>
    articleRefs ? (
      <InsightCardView
        linkStatic={linkStatic}
        key={insight.id}
        insight={insight}
        articleRefs={articleRefs}
      />
    ) : (
      <InsightCard
        key={insight.id}
        insight={insight}
        feedback={feedbackByInsightId[insight.id]}
      />
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Your focus</CardTitle>
            <CardDescription>
              Your most important next steps, prioritized from the latest
              assessment.
            </CardDescription>
          </div>
          <p className="text-muted-foreground text-xs whitespace-nowrap">
            As of {asOf}
          </p>
        </div>

        {delta && (
          <div className="mt-2">
            <WhatChanged delta={delta} />
          </div>
        )}
      </CardHeader>

      <CardContent>
        {focus.primary === null && focus.positives.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No focus items from the latest assessment. You&apos;re in good shape
            — keep the momentum going.
          </p>
        ) : (
          <div className="space-y-5">
            {focus.primary && (
              <div className="space-y-2">
                <p
                  data-testid="primary-focus-label"
                  className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                >
                  Primary focus
                </p>
                {card(focus.primary)}
              </div>
            )}

            {focus.supplements.length > 0 && (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {focus.supplements.length === 1 ? "Also" : "Also worth doing"}
                </p>
                <div className="space-y-3">{focus.supplements.map(card)}</div>
              </div>
            )}

            {/*
              LEGACY ONLY. The judge schema refuses more than three actionable
              planter insights now, so this branch only ever renders for an
              assessment written before #478. Those observations were made and
              stored; collapsing them is honest, deleting them from the view
              would be a silent edit of the record.
            */}
            {focus.overflow.length > 0 && (
              <details className="group">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium">
                  {focus.overflow.length === 1
                    ? "1 more observation"
                    : `${focus.overflow.length} more observations`}
                </summary>
                <div className="mt-3 space-y-3">{focus.overflow.map(card)}</div>
              </details>
            )}

            {/*
              #478 D1 — encouragement, on its own surface. It never occupies a
              focus slot and never crowds one out. This block's final placement
              is #533's call; what is settled here is that it is not one of the
              three things the planter is being asked to do.
            */}
            {focus.positives.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <p
                  data-testid="going-well-label"
                  className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                >
                  Going well
                </p>
                <div className="space-y-3">{focus.positives.map(card)}</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
