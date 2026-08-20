// ============================================================================
// Phase Engine — PE-026, trends and velocity.
//
// Split out of `queries.ts` (#319, round 4): that file was the SNAPSHOT layer's
// raw SQL primitives AND both read-layer projections, and it had grown past the
// point where its three concerns could be read apart. The division is the one
// its own section banners already drew — the primitives stay in `queries.ts`,
// PE-027's timeline is `milestones.ts`, and this file is PE-026.
//
// Nothing here reads feature data. Every number is one `#>>` extraction from a
// persisted `plant_assessments.fact_snapshot`, and every badge is a persisted
// judge severity relabelled — see the banner below, which is the rule this
// module is written against.
// ============================================================================

import { db } from "@/db";
import {
  plantAssessments,
  type InsightAudience,
  type InsightSeverity,
  type PlantInsight,
} from "@/db/schema";
// The severity scale the CSF scorecard and the exit criteria already read the
// judge's output through. Imported rather than re-declared: an alert badge on a
// trend must be the SAME relabelling of the SAME persisted severity, or the page
// would carry two urgency vocabularies that drift apart.
import {
  compareInsightUrgency,
  standingForSeverity,
  type CsfStanding,
  type LatestAssessment,
} from "../assessment/queries";
import { and, desc, eq, sql } from "drizzle-orm";

// ============================================================================
// PE-026 — trends and velocity, read out of the PERSISTED fact snapshots.
//
// Four trends a planter asks for by name: core-group growth, vision-meeting
// attendance, follow-up completion, ministry-team readiness (D-010…D-013).
//
// WHERE THE HISTORY COMES FROM, AND WHY IT IS NOT RE-DERIVED FROM FEATURE DATA.
// Every assessment persists the exact `PlantFactSnapshot` the judge reasoned
// over (`plant_assessments.fact_snapshot`, NFR-PE-5). That column is therefore
// already a dated series of deterministic readings, and reading the series out
// of it — rather than recomputing four metrics from `commitments`,
// `church_meetings`, `persons` and `ministry_teams` — is what makes "every value
// is SQL-derived from the fact snapshot" true by construction:
//
//   - each point on each trend is one `#>>` extraction from one stored snapshot,
//     taken by the SAME dotted path build-fact-snapshot.ts wrote it at, so a
//     value on a chart can be traced to the line of the builder that produced it
//     (`TREND_SNAPSHOT_PATHS`, and `TrendMetric.factPaths` carries the paths to
//     the UI so the trace survives into the surface);
//   - a plant with one assessment has one point, and a one-point metric reports
//     a VALUE with no delta and no direction. A trend line through a single
//     reading is a fabricated claim about change nobody measured;
//   - a snapshot written before a field existed yields SQL NULL at that path,
//     which drops the point rather than pinning the series to zero.
//
// AND WHY NO METRIC IS RECOMPUTED HERE EITHER. The two ratios (follow-up
// completion, team readiness) are divisions of two counts read out of the same
// snapshot, and nothing else. There is no scoring pass, no weighting, and — the
// point of the whole section — NO THRESHOLD. Nothing in this file, or in the
// components that render it, decides that a number is "low" or "bad".
//
// ALERT BADGES ARE THE JUDGE'S, RELABELLED (PE-027). A badge is the severity the
// judge already assigned to a persisted insight in the assessment's own
// category, passed through `standingForSeverity` — the SAME function the CSF
// scorecard and the exit criteria read severities through. `EngineAlert` carries
// the insight id and the raw severity it came from, so a badge on screen can be
// traced to the `plant_insights` row that set it. A second threshold system —
// "attendance below N is a warning" written into a component — is the specific
// failure this shape exists to make impossible: there is no number for a
// component to threshold, only a standing it was handed.
// ============================================================================

// ----------------------------------------------------------------------------
// The snapshot fields a trend is read from.
// ----------------------------------------------------------------------------

/**
 * Dotted paths into `PlantFactSnapshot`, as the segments the SQL `#>>` operator
 * takes. ONE table drives both the SQL and the `factPaths` reported to the UI,
 * so the path a chart claims its numbers came from is literally the path the
 * query read. Every key here is written by `assembleFactSnapshot`
 * (build-fact-snapshot.ts); `queries.test.ts` asserts that against a real
 * assembled snapshot rather than trusting this comment.
 */
const TREND_SNAPSHOT_PATHS = {
  coreGroupCommittedCount: ["coreGroup", "committedCount"],
  visionMeetingLatestAttendance: ["visionMeetings", "latestAttendance"],
  followUpOpenCount: ["followUp", "openCount"],
  followUpStaleCount: ["followUp", "staleCount"],
  followUpStaleThresholdDays: ["followUp", "staleThresholdDays"],
  ministryRolesFilledCount: ["ministryRoles", "filledCount"],
  ministryRolesTotalRoles: ["ministryRoles", "totalRoles"],
} as const satisfies Record<string, readonly string[]>;

/** A snapshot field a trend may be read from. */
export type TrendSnapshotField = keyof typeof TREND_SNAPSHOT_PATHS;

/** `coreGroup.committedCount` — the form `readSnapshotFact` and the UI speak. */
export function trendSnapshotPath(field: TrendSnapshotField): string {
  return TREND_SNAPSHOT_PATHS[field].join(".");
}

/**
 * One integer read out of the stored snapshot JSON, by path.
 *
 * `#>>` returns text (SQL NULL when the path is absent or stores JSON null), so
 * the cast yields `null` for both "this snapshot predates the field" and "the
 * builder recorded no reading" — which the series treats identically, because
 * neither is a measurement. The path literal is built from the table above and
 * contains only fixed camelCase identifiers; no value from a caller reaches it.
 */
function snapshotInteger(field: TrendSnapshotField) {
  const jsonPath = sql.raw(`'{${TREND_SNAPSHOT_PATHS[field].join(",")}}'`);
  return sql<
    number | null
  >`(${plantAssessments.factSnapshot} #>> ${jsonPath})::int`;
}

/** One persisted snapshot, reduced to the fields the four trends read. */
export interface SnapshotHistoryRow {
  assessmentId: string;
  generatedAt: Date;
  coreGroupCommittedCount: number | null;
  visionMeetingLatestAttendance: number | null;
  followUpOpenCount: number | null;
  followUpStaleCount: number | null;
  followUpStaleThresholdDays: number | null;
  ministryRolesFilledCount: number | null;
  ministryRolesTotalRoles: number | null;
}

/**
 * How many assessments a trend looks back over. Twelve is the stat-tile
 * sparkline's own point budget — enough to show a shape, few enough that the
 * oldest point is still the same plant.
 */
export const TREND_HISTORY_LIMIT = 12;

/**
 * The most recent COMPLETE assessments' fact snapshots, OLDEST FIRST.
 *
 * `complete` only, and church-scoped: this is the same population every other
 * read layer surface projects (`getLatestAssessment`), so the newest point of a
 * trend is by construction the snapshot the CSF scorecard and the exit criteria
 * are showing. A pending or failed run has no snapshot worth plotting.
 */
export async function getSnapshotTrendHistory(
  churchId: string,
  limit: number = TREND_HISTORY_LIMIT
): Promise<SnapshotHistoryRow[]> {
  const rows = await db
    .select({
      assessmentId: plantAssessments.id,
      generatedAt: plantAssessments.generatedAt,
      coreGroupCommittedCount: snapshotInteger("coreGroupCommittedCount"),
      visionMeetingLatestAttendance: snapshotInteger(
        "visionMeetingLatestAttendance"
      ),
      followUpOpenCount: snapshotInteger("followUpOpenCount"),
      followUpStaleCount: snapshotInteger("followUpStaleCount"),
      followUpStaleThresholdDays: snapshotInteger("followUpStaleThresholdDays"),
      ministryRolesFilledCount: snapshotInteger("ministryRolesFilledCount"),
      ministryRolesTotalRoles: snapshotInteger("ministryRolesTotalRoles"),
    })
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.churchId, churchId),
        eq(plantAssessments.status, "complete")
      )
    )
    // Newest-first is what the index serves and what `limit` must cut from; the
    // series is chronological, so it is reversed once, here.
    .orderBy(desc(plantAssessments.generatedAt))
    .limit(limit);

  return rows.reverse();
}

// ----------------------------------------------------------------------------
// Alert badges — the judge's severity, relabelled. Never a threshold.
// ----------------------------------------------------------------------------

/**
 * What the engine said about the thing this badge sits on.
 *
 * `standing` is `standingForSeverity(severity)` and nothing else; `severity`,
 * `insightId` and `insightTitle` are kept beside it so the badge is traceable
 * back to the persisted `plant_insights` row that produced it. `not_raised`
 * (with a null severity) means the assessment did not speak to this — which is
 * neither good nor bad, and must never render as either.
 */
export interface EngineAlert {
  standing: CsfStanding;
  severity: InsightSeverity | null;
  insightId: string | null;
  insightTitle: string | null;
  /** How many insights in the badge's categories the assessment raised. */
  insightCount: number;
}

/** The badge for "the assessment said nothing about this". */
export const NO_ENGINE_ALERT: EngineAlert = {
  standing: "not_raised",
  severity: null,
  insightId: null,
  insightTitle: null,
  insightCount: 0,
};

/**
 * The most urgent insight in `categories`, as a badge.
 *
 * Ordering is `compareInsightUrgency` — the SCORECARD'S OWN COMPARATOR, imported
 * rather than rebuilt out of the two primitives it is made of, so the badge and
 * the tile can never disagree about which finding is the headline for the same
 * insight set. This function used to inline the same three lines, which made
 * "they cannot disagree" true only for as long as nobody edited one of them; the
 * exit criteria already import the comparator for exactly this reason.
 *
 * Callers hand in insights they have already gated: an oversight caller must
 * pass privacy-gated rows, exactly as `buildCsfScorecard` requires, or a badge
 * becomes a one-argument bypass of the `share_*` toggles.
 */
export function deriveEngineAlert(
  insights: PlantInsight[],
  categories: readonly string[]
): EngineAlert {
  const matching = insights
    .filter((insight) => categories.includes(insight.category))
    .sort(compareInsightUrgency);

  const lead = matching[0];
  if (!lead) return NO_ENGINE_ALERT;

  return {
    standing: standingForSeverity(lead.severity),
    severity: lead.severity,
    insightId: lead.id,
    insightTitle: lead.title,
    insightCount: matching.length,
  };
}

// ----------------------------------------------------------------------------
// The four trends.
// ----------------------------------------------------------------------------

export const TREND_METRIC_KEYS = [
  "core_group_growth",
  "meeting_attendance",
  "follow_up_completion",
  "team_readiness",
] as const;

export type TrendMetricKey = (typeof TREND_METRIC_KEYS)[number];

/** `count` renders as a whole number; `rate` is 0..1 and renders as a percent. */
export type TrendUnit = "count" | "rate";

interface TrendMetricDefinition {
  key: TrendMetricKey;
  label: string;
  /** One line on what the number is, shown under the value. */
  description: string;
  unit: TrendUnit;
  /**
   * Whether a rising number is the good direction. All four are — but a metric
   * where it is not (staleness, say) must not silently inherit the delta's
   * colouring, so the answer is stated per metric rather than assumed.
   */
  higherIsBetter: boolean;
  /** The snapshot fields `read` may touch. Reported to the UI as `factPaths`. */
  fields: readonly TrendSnapshotField[];
  /** Insight categories whose severity may badge this metric. */
  categories: readonly string[];
  /** The reading, or null when this snapshot cannot answer. */
  read(row: SnapshotHistoryRow): number | null;
  /** A sentence fragment spelling out the counts behind a ratio. */
  reading(row: SnapshotHistoryRow): string | null;
}

const TREND_METRIC_DEFINITIONS: readonly TrendMetricDefinition[] = [
  {
    key: "core_group_growth",
    label: "Core group",
    description: "People with a signed core-group commitment.",
    unit: "count",
    higherIsBetter: true,
    fields: ["coreGroupCommittedCount"],
    // CSF-3 is the critical-mass lens; the judge files core-group trajectory
    // findings there (rubric-v0 Part A).
    categories: ["critical_mass"],
    read: (row) => row.coreGroupCommittedCount,
    reading: () => null,
  },
  {
    key: "meeting_attendance",
    label: "Vision meeting attendance",
    description: "People at your most recent completed vision meeting.",
    unit: "count",
    higherIsBetter: true,
    fields: ["visionMeetingLatestAttendance"],
    categories: ["vision_casting"],
    read: (row) => row.visionMeetingLatestAttendance,
    reading: () => null,
  },
  {
    // THE DENOMINATOR IS FIRST-TIMERS, AND THE LABEL SAYS SO (#323 WS2).
    // `followUpOpenCount` counts people in the three open follow-up statuses
    // (attendee / following_up / interviewed), and the only way into that
    // cohort is `prospect -> attendee` on a vision meeting — which by
    // derivation is a person's FIRST one (`meetings/attendance-type.ts`). So
    // the cohort was always the first-timers; what changed is that VM-007 now
    // generates a follow-up task for exactly that cohort and nobody else, so
    // the rate and the work it measures finally name the same people. A label
    // reading plain "Follow-up completion" invited the planter to read it as
    // "of everyone I mean to follow up", which is a wider set than anything
    // here counts.
    key: "follow_up_completion",
    label: "First-time follow-up completion",
    description: "First-time attendees still open, reached inside the window.",
    unit: "rate",
    higherIsBetter: true,
    fields: [
      "followUpOpenCount",
      "followUpStaleCount",
      "followUpStaleThresholdDays",
    ],
    categories: ["follow_up", "shared_ownership"],
    read: (row) => {
      const { followUpOpenCount: open, followUpStaleCount: stale } = row;
      if (open === null || stale === null) return null;
      // A rate with a zero denominator is UNKNOWN, never 100% — the same rule
      // the communication figures are held to (invariants.md → Communication).
      // "No open follow-ups" is not "every follow-up completed".
      if (open <= 0) return null;
      return (open - stale) / open;
    },
    reading: (row) => {
      const { followUpOpenCount: open, followUpStaleCount: stale } = row;
      if (open === null || stale === null || open <= 0) return null;
      const days = row.followUpStaleThresholdDays;
      const window = days === null ? "the follow-up window" : `${days} days`;
      return `${open - stale} of ${open} open contacts touched within ${window}`;
    },
  },
  {
    key: "team_readiness",
    label: "Ministry team readiness",
    description: "The eight ministry roles with a leader assigned.",
    unit: "rate",
    higherIsBetter: true,
    fields: ["ministryRolesFilledCount", "ministryRolesTotalRoles"],
    // CSF-7 — leaders rising from within to fill the eight roles.
    categories: ["emerging_leadership"],
    read: (row) => {
      const {
        ministryRolesFilledCount: filled,
        ministryRolesTotalRoles: total,
      } = row;
      if (filled === null || total === null || total <= 0) return null;
      return filled / total;
    },
    reading: (row) => {
      const {
        ministryRolesFilledCount: filled,
        ministryRolesTotalRoles: total,
      } = row;
      if (filled === null || total === null || total <= 0) return null;
      return `${filled} of ${total} roles have a leader`;
    },
  },
];

/** One dated reading on a trend. */
export interface TrendPoint {
  /** The assessment's `generatedAt` — the moment the reading was taken. */
  at: Date;
  value: number;
}

/** One trend: the latest reading, its series, and what the engine said about it. */
export interface TrendMetric {
  key: TrendMetricKey;
  label: string;
  description: string;
  unit: TrendUnit;
  higherIsBetter: boolean;
  /** The newest reading, or null when no snapshot in the window carries it. */
  value: number | null;
  /**
   * When `value` was taken. Null when nothing in the window answered the metric.
   *
   * NOT always `asOf`: `value` is the newest AVAILABLE reading, and a metric the
   * newest snapshot could not answer (`followUp.openCount` at zero makes the
   * follow-up rate unknown, not 100%) falls back to an earlier one. Carrying the
   * reading's own date is what keeps the card from showing that older number
   * under the header's single "As of <newest snapshot>".
   */
  valueAt: Date | null;
  /**
   * True when `valueAt` is older than the window's `asOf` — the latest
   * assessment did not record this metric and what is shown is an earlier
   * reading. The surface must SAY so; it must never silently pass a stale
   * reading off as current.
   */
  valueIsStale: boolean;
  /** The counts behind a ratio, spelled out. Null when there is nothing to add. */
  reading: string | null;
  /** Chronological readings, oldest first. Fewer than 2 = no trend to draw. */
  points: TrendPoint[];
  /** Newest minus oldest reading in the window; null with fewer than 2 points. */
  delta: number | null;
  direction: "up" | "down" | "flat" | null;
  /** When the comparison starts — the date `delta` is measured from. */
  since: Date | null;
  /** The snapshot paths every number above was read from. */
  factPaths: readonly string[];
  alert: EngineAlert;
}

/** The four trends plus the identity of the window they were read over. */
export interface PlantTrends {
  metrics: TrendMetric[];
  /** Complete assessments in the window. */
  snapshotCount: number;
  /** `generatedAt` of the newest snapshot in the window. */
  asOf: Date;
  /** `generatedAt` of the oldest snapshot in the window. */
  since: Date;
  /**
   * False when the plant has only ever completed one assessment. Nothing on the
   * card draws a line in that state — a value is still a fact, a trend is not.
   */
  hasHistory: boolean;
  /** Which audience's insights the alert badges were derived from. */
  audience: InsightAudience;
}

const DELTA_EPSILON = 1e-9;

function directionOf(delta: number): "up" | "down" | "flat" {
  if (delta > DELTA_EPSILON) return "up";
  if (delta < -DELTA_EPSILON) return "down";
  return "flat";
}

/**
 * Project persisted snapshots + persisted insights onto the four trends (PE-026).
 *
 * Pure — no DB, no LLM, no recomputation from feature tables. Returns null when
 * the plant has no complete assessment at all: four empty tiles would claim the
 * engine measured four things and found nothing, and it has measured nothing.
 *
 * @param history  snapshot rows in any order (sorted chronologically here, so a
 *                 caller passing newest-first cannot invert every delta)
 * @param latest   the latest complete assessment + insights, for the badges only
 * @param audience which audience's insights may badge a metric. A `"network"`
 *                 caller must hand in already privacy-gated insights.
 */
export function buildPlantTrends(
  history: SnapshotHistoryRow[],
  latest: LatestAssessment | null,
  audience: InsightAudience = "planter"
): PlantTrends | null {
  if (history.length === 0) return null;

  const ordered = [...history].sort(
    (a, b) => a.generatedAt.getTime() - b.generatedAt.getTime()
  );
  const newest = ordered[ordered.length - 1];
  const insights = (latest?.insights ?? []).filter(
    (insight) => insight.audience === audience
  );

  const metrics = TREND_METRIC_DEFINITIONS.map((definition) => {
    const points: TrendPoint[] = [];
    for (const row of ordered) {
      const value = definition.read(row);
      if (value !== null && Number.isFinite(value)) {
        points.push({ at: row.generatedAt, value });
      }
    }

    const last = points[points.length - 1] ?? null;
    // Two readings are the minimum a change can be claimed from. One reading is
    // a value; zero is silence. Neither gets a delta, a direction or a line.
    const comparable = points.length >= 2;
    const delta = comparable ? last!.value - points[0].value : null;

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      unit: definition.unit,
      higherIsBetter: definition.higherIsBetter,
      value: last?.value ?? null,
      valueAt: last?.at ?? null,
      // The newest snapshot could not answer this metric, so `value` is an
      // earlier reading. Stated here rather than left for the card to work out,
      // because the card carries ONE "as of" date and it is the window's.
      valueIsStale:
        last !== null && last.at.getTime() < newest.generatedAt.getTime(),
      reading: definition.reading(newest),
      points,
      delta,
      direction: delta === null ? null : directionOf(delta),
      since: comparable ? points[0].at : null,
      factPaths: definition.fields.map(trendSnapshotPath),
      alert: deriveEngineAlert(insights, definition.categories),
    } satisfies TrendMetric;
  });

  return {
    metrics,
    snapshotCount: ordered.length,
    asOf: newest.generatedAt,
    since: ordered[0].generatedAt,
    hasHistory: ordered.length >= 2,
    audience,
  };
}

/**
 * The PLANTER's trends for a church (PE-026).
 *
 * Takes the assessment the caller has ALREADY read rather than reading it again:
 * `/phase` loads `getLatestAssessment` once for the Focus panel, and the badges
 * here must come from that same row or the page could show two different
 * assessments' urgency side by side.
 */
export async function getPlantTrends(
  churchId: string,
  latest: LatestAssessment | null,
  audience: InsightAudience = "planter",
  limit: number = TREND_HISTORY_LIMIT
): Promise<PlantTrends | null> {
  const history = await getSnapshotTrendHistory(churchId, limit);
  return buildPlantTrends(history, latest, audience);
}
