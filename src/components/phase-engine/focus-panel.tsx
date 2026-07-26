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
// This component performs NO data access — it is handed the assessment, its
// insights, and the current user's prior feedback by the page.
// ============================================================================

import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { deltaFieldLabel } from "@/components/phase-engine/focus-presentation";
import {
  InsightCard,
  type InsightFeedbackState,
} from "@/components/phase-engine/insight-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  SnapshotDelta,
  SnapshotDeltaField,
} from "@/lib/phase-engine/assessment";
import type { PlantAssessment, PlantInsight } from "@/db/schema";

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
  /** Planter-audience insights, already ordered by rank. */
  insights: PlantInsight[];
  /** The what-changed delta carried on the stored snapshot (PE-016). */
  delta: SnapshotDelta | null;
  /** Prior feedback keyed by insight id, for the current user. */
  feedbackByInsightId?: Record<string, InsightFeedbackState>;
}

export function FocusPanel({
  assessment,
  insights,
  delta,
  feedbackByInsightId = {},
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
        {insights.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No focus items from the latest assessment. You&apos;re in good shape
            — keep the momentum going.
          </p>
        ) : (
          <div className="space-y-3">
            {insights.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                feedback={feedbackByInsightId[insight.id]}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
