import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  evaluationComparisonDenominatorCopy,
  EVALUATION_COMPARISON_EMPTY_COPY,
} from "@/lib/meetings/copy";
import type { EvaluationComparison } from "@/lib/meetings/service";

interface EvaluationComparisonCardProps {
  /** `null` when nothing in the fetched window is earlier than this meeting. */
  comparison: EvaluationComparison | null;
}

/** Signed to one decimal, so "+0.0" and "-0.0" never appear. */
function formatDelta(delta: number): string {
  if (delta === 0) return "0.0";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`;
}

/**
 * How this meeting's evaluation compares to the ones before it (VM-016c).
 *
 * Both sentences it can show are ruled copy from `copy.ts` — rationale there.
 * No baseline shows the empty state, never a comparison against zero. Direction
 * is never carried by colour alone: the arrow and the sentence both say it.
 */
export function EvaluationComparisonCard({
  comparison,
}: EvaluationComparisonCardProps) {
  if (!comparison) {
    return (
      <Card data-testid="evaluation-comparison-empty">
        <CardHeader>
          <CardTitle className="text-base">
            Compared with previous meetings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Ruled 2026-08-10 on #312 (round 2) — rationale in copy.ts. */}
          <p className="text-muted-foreground text-sm">
            {EVALUATION_COMPARISON_EMPTY_COPY}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { currentScore, previousAverage, previousScore, previousCount, delta } =
    comparison;

  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  const Icon =
    direction === "up"
      ? TrendingUp
      : direction === "down"
        ? TrendingDown
        : Minus;

  const toneClass =
    direction === "up"
      ? "text-emerald-700 dark:text-emerald-400"
      : direction === "down"
        ? "text-red-700 dark:text-red-400"
        : "text-muted-foreground";

  const sentence =
    direction === "up"
      ? "above your previous average"
      : direction === "down"
        ? "below your previous average"
        : "level with your previous average";

  return (
    <Card data-testid="evaluation-comparison">
      <CardHeader>
        <CardTitle className="text-base">
          Compared with previous meetings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`flex items-center gap-2 ${toneClass}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span className="text-2xl font-bold">{formatDelta(delta)}</span>
          <span className="text-sm font-medium">{sentence}</span>
        </div>

        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">This meeting</dt>
            <dd className="font-semibold">{currentScore.toFixed(1)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Previous meeting</dt>
            <dd className="font-semibold">{previousScore.toFixed(1)}</dd>
          </div>
          <div>
            {/* Static by ruling (2026-08-12 on #312, decision 1) — the count belongs
                to the sentence below, and only to it. Rationale in copy.ts. */}
            <dt className="text-muted-foreground">
              Average of previous meetings
            </dt>
            <dd className="font-semibold">{previousAverage.toFixed(1)}</dd>
          </div>
        </dl>

        {/* The card's ONE statement of the denominator. Ruled 2026-08-12 on #312
            (decision 1, option B) — rationale in copy.ts. */}
        <p className="text-muted-foreground text-xs">
          {evaluationComparisonDenominatorCopy(previousCount)}
        </p>
      </CardContent>
    </Card>
  );
}
