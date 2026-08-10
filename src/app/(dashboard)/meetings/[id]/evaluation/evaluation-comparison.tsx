import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvaluationComparison } from "@/lib/meetings/service";

interface EvaluationComparisonCardProps {
  /** `null` when nothing was evaluated before this meeting. */
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
 * Two states, and the second is the point of the requirement: a first-ever
 * evaluated meeting says it has no comparison YET. It does not compare against
 * zero, which would render a first meeting scoring 4.2 as a 4.2-point collapse.
 *
 * Direction is never carried by colour alone — the arrow and the sentence both
 * say which way it went, so the card survives greyscale and colour blindness.
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
          <p className="text-muted-foreground text-sm">
            No comparison yet — this is the first meeting you have evaluated.
            Evaluate another and this card shows how the scores move.
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
            <dt className="text-muted-foreground">
              Average of previous {previousCount}
            </dt>
            <dd className="font-semibold">{previousAverage.toFixed(1)}</dd>
          </div>
        </dl>

        {/*
          The denominator, said out loud. "Above average" means nothing until
          the reader knows the average covers one meeting or twelve.
        */}
        <p className="text-muted-foreground text-xs">
          Scores are out of 5.0. The average covers the{" "}
          {previousCount === 1 ? "one meeting" : `${previousCount} meetings`}{" "}
          you evaluated before this one.
        </p>
      </CardContent>
    </Card>
  );
}
