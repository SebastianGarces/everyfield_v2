import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EVALUATION_COMPARISON_WINDOW,
  type EvaluationComparison,
} from "@/lib/meetings/service";

interface EvaluationComparisonCardProps {
  /** `null` when nothing in the fetched window is earlier than this meeting. */
  comparison: EvaluationComparison | null;
  /**
   * PROTOTYPE ONLY (variant C) — whether the fetched window came back full.
   * A window that is not full holds the church's whole evaluated history, so
   * `null` then means nothing earlier exists. A full window cannot tell the
   * two causes apart. This is the discriminator option C costs; it is deleted
   * with the losing variants once the sentence is ruled.
   */
  windowFull?: boolean;
}

/** Signed to one decimal, so "+0.0" and "-0.0" never appear. */
function formatDelta(delta: number): string {
  if (delta === 0) return "0.0";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`;
}

/**
 * How this meeting's evaluation compares to the ones before it (VM-016c).
 *
 * Two states, and the second is the point of the requirement: a meeting with
 * no baseline says it has no comparison. It does not compare against zero,
 * which would render a meeting scoring 4.2 as a 4.2-point collapse.
 *
 * The empty state does NOT say "this is your first evaluated meeting" — ruled
 * 2026-08-10 on #312. `null` has two causes and the card cannot tell them
 * apart: nothing was evaluated earlier, OR everything earlier fell outside the
 * `EVALUATION_COMPARISON_WINDOW` most recent evaluations. A planter opening
 * their third meeting out of sixty was being told it was their first. The
 * window is deliberately unchanged; only this sentence is, and it must stay
 * true of both causes.
 *
 * Direction is never carried by colour alone — the arrow and the sentence both
 * say which way it went, so the card survives greyscale and colour blindness.
 */
export function EvaluationComparisonCard({
  comparison,
  windowFull = false,
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
          {/*
            PROTOTYPE (2026-08-10, #312) — four competing sentences for this
            empty state, all in the DOM, selected by `data-cmp-proto` on
            <html> from the floating switcher. Only the winner survives; the
            losers, the `windowFull` prop and the switcher mount are deleted
            when the ruling is applied.

            The window is named from the constant, never typed as a literal —
            a hand-written number here is the copy that goes quietly wrong the
            day the window changes.
          */}
          <p
            data-variant="a"
            className="text-muted-foreground hidden text-sm [[data-cmp-proto=a]_&]:block"
          >
            No comparison available. This card measures a meeting against the
            evaluated meetings before it, and none of your{" "}
            {EVALUATION_COMPARISON_WINDOW} most recent evaluations came before
            this one.
          </p>

          <p
            data-variant="b"
            className="text-muted-foreground hidden text-sm [[data-cmp-proto=b]_&]:block"
          >
            No comparison available — nothing you evaluated earlier is in range
            for this meeting.
          </p>

          <p
            data-variant="c"
            className="text-muted-foreground hidden text-sm [[data-cmp-proto=c]_&]:block"
          >
            {windowFull ? (
              <>
                No comparison available. None of your{" "}
                {EVALUATION_COMPARISON_WINDOW} most recent evaluations came
                before this meeting.
              </>
            ) : (
              <>
                No comparison available. Nothing you evaluated came before this
                meeting.
              </>
            )}
          </p>

          <div data-variant="d" className="hidden [[data-cmp-proto=d]_&]:block">
            <p className="text-sm">No comparison available.</p>
            <p className="text-muted-foreground mt-1 text-xs">
              This card compares a meeting with the evaluated meetings before
              it, drawn from your {EVALUATION_COMPARISON_WINDOW} most recent
              evaluations.
            </p>
          </div>
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
