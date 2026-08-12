// ============================================================================
// Trends — the four deterministic trends, as a KPI row of stat tiles (PE-026).
//
// Presentational server component. It performs NO data access, NO arithmetic on
// the plant's data and NO judgement: it is handed a `PlantTrends` that the
// signal read layer projected from the persisted `plant_assessments` fact
// snapshots (lib/phase-engine/signals/queries.ts, `buildPlantTrends`). Every
// number here was read out of a stored snapshot by path; every badge is a
// severity the judge already assigned.
//
// ---------------------------------------------------------------------------
// The design constraints this file is written against
// ---------------------------------------------------------------------------
//
// 1. NO THRESHOLDS LIVE HERE. This file contains no number a value is compared
//    against — no "below 10 is red", no target line, no banding. The only
//    urgency on the card is `metric.alert`, which is the engine's own severity
//    relabelled by the read layer, and the tile cannot do anything with it but
//    render the word it was given. A second threshold system written into a
//    component is the specific failure PE-027 names, and the way to make it
//    impossible is to give the component nothing to threshold with.
//
// 2. ONE READING IS A VALUE, NOT A TREND. A plant with a single completed
//    assessment shows its numbers and says, in words, that there is nothing to
//    compare them to yet. No sparkline, no delta, no arrow — a line drawn
//    through one point is a claim about change that nobody measured.
//
// 3. A MISSING READING IS NOT A ZERO. A metric no snapshot in the window can
//    answer renders an em dash and says so. Rendering `0` would be the card
//    inventing a measurement.
//
// 3b. AN OLDER READING IS DATED WHERE IT SITS. The card carries one "as of"
//    date — the newest snapshot's — but a metric the newest snapshot could not
//    answer falls back to an earlier reading (`valueIsStale` from the read
//    layer). That tile says which day its number was measured on, so the header
//    date never speaks for a number it did not produce.
//
// 4. THE CHART IS ONE SERIES OF ONE INK. Each sparkline plots one measure, so
//    there is no identity to encode and no categorical palette to reach for:
//    the line is the foreground ink faded back, the current reading is the same
//    ink at full strength, and the dot carries a 2px ring in the card's own
//    surface colour so it stays legible where it meets the line. Both steps come
//    from the theme's foreground token, so the chart is readable in light and
//    dark by construction rather than by a second hand-tuned palette. Colour
//    appears on this card in exactly one place — the alert badge — where it
//    means a status and is always paired with an icon and a word.
//
// 5. THE NUMBERS CARRY THE MEANING, THE CHART DECORATES IT. Every sparkline is
//    `aria-hidden`: its value, its delta and the period the delta is measured
//    over are all in text beside it, so nothing is gated behind reading a
//    picture, and a screen reader is not read a wall of coordinates.
//
// Server-safe on purpose: no "use client", no event handlers, no value-level
// import of anything server-only.
// ============================================================================

import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  Eye,
  Info,
  Minus,
  TriangleAlert,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { calendarTileParts, formatDate } from "@/lib/datetime";
import type {
  EngineAlert,
  PlantTrends,
  TrendMetric,
  TrendPoint,
} from "@/lib/phase-engine/signals/queries";
import type { CsfStanding } from "@/lib/phase-engine/assessment";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// The alert badge.
//
// The scale is `CsfStanding` — the CSF scorecard's, the exit criteria's, the
// same one. The words and inks are matched to those cards deliberately: a
// planter learns one attention vocabulary for the whole page, and "needs
// attention" must look the same wherever it appears. The mapping from a
// persisted severity to this standing happens once, in the read layer
// (`standingForSeverity`); this table only dresses the result.
// ----------------------------------------------------------------------------

interface StandingStyle {
  /** The word the reader actually reads. Colour only reinforces it. */
  label: string;
  Icon: typeof TriangleAlert;
  ink: string;
}

const STANDING_STYLES: Record<CsfStanding, StandingStyle> = {
  attention: {
    label: "Needs attention",
    Icon: TriangleAlert,
    ink: "text-attention-high-ink",
  },
  watch: { label: "Worth a look", Icon: Eye, ink: "text-attention-medium-ink" },
  noted: { label: "Noted", Icon: Info, ink: "text-foreground/80" },
  strength: {
    label: "Going well",
    Icon: CircleCheck,
    ink: "text-emerald-700 dark:text-emerald-400",
  },
  not_raised: {
    label: "Not raised",
    Icon: Minus,
    ink: "text-muted-foreground",
  },
};

/** Icon + word + colour. Any two of the three can be lost and it still reads. */
function AlertBadge({ alert }: { alert: EngineAlert }) {
  const style = STANDING_STYLES[alert.standing];

  return (
    <p
      data-slot="trend-alert"
      data-standing={alert.standing}
      data-severity={alert.severity ?? ""}
      data-insight-id={alert.insightId ?? ""}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-semibold tracking-wide uppercase",
        style.ink
      )}
    >
      <style.Icon className="size-3.5" aria-hidden="true" />
      {style.label}
    </p>
  );
}

// ----------------------------------------------------------------------------
// The sparkline.
// ----------------------------------------------------------------------------

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 32;
/** Room for the end dot (r 3.5) and its 2px surface ring, on every side. */
const SPARK_PADDING = 6;

/** Two decimals: SSR markup stays stable and diffable, and 0.005px is nothing. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface SparkGeometry {
  d: string;
  last: { x: number; y: number };
}

/**
 * Map readings onto the plot box. A flat series sits on the middle line rather
 * than on the floor — pinning it to the bottom would read as "at zero", which is
 * a claim about the value and not about its variation.
 */
function sparkGeometry(points: TrendPoint[]): SparkGeometry | null {
  if (points.length < 2) return null;

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const plotWidth = SPARK_WIDTH - SPARK_PADDING * 2;
  const plotHeight = SPARK_HEIGHT - SPARK_PADDING * 2;

  const coords = points.map((point, index) => ({
    x: round(SPARK_PADDING + (index / (points.length - 1)) * plotWidth),
    y: round(
      span === 0
        ? SPARK_PADDING + plotHeight / 2
        : SPARK_PADDING + (1 - (point.value - min) / span) * plotHeight
    ),
  }));

  return {
    d: coords
      .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x} ${coord.y}`)
      .join(" "),
    last: coords[coords.length - 1],
  };
}

/**
 * One series, 2px line, ≥8px end marker with a 2px surface ring. No axis, no
 * gridlines, no labels: at this size every one of them is noise, and the value
 * and the delta are already spelled out in text beside it.
 *
 * Fixed pixel size rather than a stretched viewBox — scaling a viewBox
 * non-uniformly would thin the stroke on one axis and turn the end dot into an
 * ellipse.
 */
function Sparkline({ points }: { points: TrendPoint[] }) {
  const geometry = sparkGeometry(points);
  if (!geometry) return null;

  return (
    <svg
      data-testid="trend-sparkline"
      data-points={points.length}
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      // The text beside it carries every fact this draws (constraint 5).
      aria-hidden="true"
      focusable="false"
      className="mt-2 block h-8 w-[120px] overflow-visible"
    >
      <path
        d={geometry.d}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-foreground/35"
      />
      <circle
        cx={geometry.last.x}
        cy={geometry.last.y}
        r={3.5}
        strokeWidth={2}
        className="fill-foreground stroke-card"
      />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Values, deltas and periods.
// ----------------------------------------------------------------------------

/**
 * A rate is 0..1 and reads as a whole percent; a count reads as itself. An
 * absent reading is an em dash — never a zero (constraint 3).
 */
function formatValue(metric: TrendMetric): string {
  if (metric.value === null) return "—";
  if (metric.unit === "rate") return `${Math.round(metric.value * 100)}%`;
  return String(metric.value);
}

/**
 * The change, signed.
 *
 * A rate's change is in PERCENTAGE POINTS, and says so: "+12 pts" and "+12%"
 * are different numbers, and the second one would be wrong here.
 */
function formatDelta(metric: TrendMetric): string | null {
  if (metric.delta === null || metric.direction === null) return null;
  if (metric.direction === "flat") return "No change";

  const sign = metric.delta > 0 ? "+" : "−";
  const magnitude =
    metric.unit === "rate"
      ? `${Math.round(Math.abs(metric.delta) * 100)} pts`
      : String(Math.abs(metric.delta));

  return `${sign}${magnitude}`;
}

/** `Jun 12` — month and day, zone-pinned, from the one formatter module. */
function shortDay(date: Date): string {
  const [month, day] = calendarTileParts(date);
  return `${month} ${day}`;
}

/**
 * Direction ink. Colour is the reinforcement, never the message: the sign and
 * the arrow already say which way the number went, so this survives greyscale
 * and forced-colors. `higherIsBetter` is read rather than assumed, so a future
 * metric where falling is the good news cannot inherit the wrong colour.
 */
function deltaInk(metric: TrendMetric): string {
  if (metric.direction === "flat" || metric.direction === null) {
    return "text-muted-foreground";
  }
  const good = (metric.direction === "up") === metric.higherIsBetter;
  return good
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-attention-high-ink";
}

// ----------------------------------------------------------------------------
// One trend.
// ----------------------------------------------------------------------------

/**
 * `data-metric`, `data-standing`, `data-has-trend` and the `data-testid`s are
 * stable hooks in the same spirit as shadcn's `data-slot`s: they name the tile's
 * state for anything asserting on or styling it from outside, without adding a
 * class the tile would then have to keep. None of them changes what renders.
 */
export function TrendTile({ metric }: { metric: TrendMetric }) {
  const delta = formatDelta(metric);
  const hasTrend = metric.points.length >= 2;
  const DirectionIcon =
    metric.direction === "up"
      ? ArrowUpRight
      : metric.direction === "down"
        ? ArrowDownRight
        : Minus;

  return (
    <li
      data-testid="trend-metric"
      data-metric={metric.key}
      data-standing={metric.alert.standing}
      data-has-trend={String(hasTrend)}
      data-stale={String(metric.valueIsStale)}
      data-points={metric.points.length}
      className="rounded-lg border p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm leading-snug font-semibold text-pretty">
          {metric.label}
        </h3>
        <AlertBadge alert={metric.alert} />
      </div>

      {/* Proportional figures, not tabular: these are standalone display
          numbers, and tabular widths make a value like 121 look loose. */}
      <p
        data-slot="trend-value"
        className="mt-1.5 text-2xl leading-none font-semibold"
      >
        {formatValue(metric)}
      </p>

      <p className="text-muted-foreground mt-1.5 max-w-[42ch] text-sm leading-relaxed text-pretty">
        {metric.reading ?? metric.description}
      </p>

      {/* Constraint 3b: the card's header date is the newest snapshot's, and
          this number is older than it. Say when it was measured, right where the
          number is, rather than let the header date speak for it. */}
      {metric.valueIsStale && metric.valueAt && (
        <p
          data-testid="trend-stale-reading"
          data-measured-at={metric.valueAt.toISOString()}
          className="text-muted-foreground mt-1.5 max-w-[42ch] text-xs text-pretty"
        >
          Measured {shortDay(metric.valueAt)}. Your latest assessment had no
          reading for this one.
        </p>
      )}

      {metric.value === null ? (
        <p
          data-testid="trend-no-reading"
          className="text-muted-foreground mt-2 max-w-[42ch] text-xs text-pretty"
        >
          No assessment in this window recorded this one yet.
        </p>
      ) : hasTrend ? (
        <>
          <Sparkline points={metric.points} />
          <p className="mt-1.5 flex items-center gap-1 text-xs">
            <DirectionIcon
              className={cn("size-3.5 shrink-0", deltaInk(metric))}
              aria-hidden="true"
            />
            <span className={cn("font-medium", deltaInk(metric))}>{delta}</span>
            <span className="text-muted-foreground">
              since {shortDay(metric.since!)}
            </span>
          </p>
        </>
      ) : (
        // Constraint 2: one reading is a value, and says so in words rather
        // than by leaving a blank where a chart would be.
        <p
          data-testid="trend-no-history"
          className="text-muted-foreground mt-2 max-w-[42ch] text-xs text-pretty"
        >
          First reading — there is nothing to compare it to yet.
        </p>
      )}
    </li>
  );
}

// ----------------------------------------------------------------------------
// The card.
// ----------------------------------------------------------------------------

interface TrendsProps {
  /**
   * The trends projected from the persisted fact snapshots, or null when the
   * plant has never completed an assessment (cold start).
   */
  trends: PlantTrends | null;
}

export function Trends({ trends }: TrendsProps) {
  // Cold start. Four tiles reading "—" would say the engine measured four things
  // and found nothing; it has measured nothing at all. A materially different
  // claim, so no tiles render.
  if (!trends) {
    return (
      <Card data-testid="trends">
        <CardHeader>
          <CardTitle>
            <h2>Trends</h2>
          </CardTitle>
          <CardDescription className="max-w-[65ch] text-pretty">
            Your plant hasn&apos;t been assessed yet. Once assessments start
            running, four measured trends appear here — core group, vision
            meeting attendance, follow-up completion and ministry team readiness
            — each one read from your own records.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const asOf = formatDate(trends.asOf, "long");

  return (
    <Card data-testid="trends" data-snapshots={trends.snapshotCount}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {/* An h2, so the page reads h1 → h2 → h3 (the tiles), matching the
                scorecard and the exit criteria. CardTitle is a plain div, so
                nesting the real heading changes the outline, not a pixel. */}
            <CardTitle>
              <h2>Trends</h2>
            </CardTitle>
            <CardDescription className="max-w-[70ch] text-pretty">
              {trends.hasHistory
                ? `Measured from your records across your last ${trends.snapshotCount} assessments.`
                : "Measured from your records. Your first assessment is the only reading so far, so nothing here is a trend yet."}
            </CardDescription>
          </div>
          <p className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
            As of {asOf}
          </p>
        </div>
      </CardHeader>

      <CardContent>
        <ul aria-label="Trends" className="grid gap-3 sm:grid-cols-2">
          {trends.metrics.map((metric) => (
            <TrendTile key={metric.key} metric={metric} />
          ))}
        </ul>

        {/* Says the quiet part out loud: the numbers and the badges have two
            different warrants, and a reader who takes them as one will
            over-trust the softer half. */}
        <p className="text-muted-foreground mt-4 max-w-[75ch] text-xs text-pretty">
          Every number above is measured from your own records, not produced by
          the engine. The mark beside each one is the latest assessment&apos;s
          reading of that area — a judgement, not a measurement. &ldquo;Not
          raised&rdquo; means the assessment had nothing to say about it this
          time.
        </p>
      </CardContent>
    </Card>
  );
}
