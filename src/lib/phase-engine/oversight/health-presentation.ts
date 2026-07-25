// ============================================================================
// Oversight plant-health PRESENTATION rules — ordering, grouping, labels.
//
// The read layer (./read.ts) decides what an oversight user may see. This
// module decides the order they see it in, which is a separate concern and a
// separate reason to change. Everything here is pure so the ordering the
// operator's attention depends on is unit-testable without a DATABASE_URL.
//
// The organising idea: a portfolio view is scanned, not read. Whatever needs a
// conversation this week has to reach the eye first, so ordering runs on need
// (classification, then launch proximity) and only falls back to name to keep
// the result stable.
// ============================================================================

import type { InsightSeverity, PlantInsight } from "@/db/schema";
import type {
  PlantHealthClassification,
  PlantHealthSummary,
} from "@/lib/phase-engine/oversight/read";

// ----------------------------------------------------------------------------
// Classification presentation.
// ----------------------------------------------------------------------------

/**
 * Scan order for the three postures. Lower sorts first: the operator lands on
 * the plants that warrant a conversation before the ones that don't.
 */
const CLASSIFICATION_ORDER: Record<PlantHealthClassification, number> = {
  readiness: 0,
  watch: 1,
  "on-track": 2,
};

/** Groups render in this order, top to bottom. */
export const CLASSIFICATION_SCAN_ORDER = [
  "readiness",
  "watch",
  "on-track",
] as const;

export interface ClassificationMeta {
  /** Group heading and badge label. Sentence case, matching the page. */
  label: string;
  /** Why a plant is in this group — shown once per section, not per card. */
  description: string;
  /** Fragment id, so the summary bar can jump straight to the section. */
  anchor: string;
}

export const CLASSIFICATION_META: Record<
  PlantHealthClassification,
  ClassificationMeta
> = {
  readiness: {
    label: "Readiness focus",
    description:
      "Launch is near, or the latest assessment raised an elevated observation.",
    anchor: "readiness-focus",
  },
  watch: {
    label: "Worth a look",
    description: "One or more medium-urgency observations this cycle.",
    anchor: "worth-a-look",
  },
  "on-track": {
    label: "On track",
    description: "No elevated observations this cycle.",
    anchor: "on-track",
  },
};

// ----------------------------------------------------------------------------
// Plant ordering.
// ----------------------------------------------------------------------------

/**
 * Order two plants by how much operator attention they warrant:
 *   1. classification (readiness → watch → on-track),
 *   2. soonest launch first, since a near launch is the least reschedulable
 *      constraint on the list; plants with no launch date sort after those
 *      that have one rather than pretending to be infinitely far away,
 *   3. name, purely so the order is stable across renders.
 */
export function comparePlantsByNeed(
  a: PlantHealthSummary,
  b: PlantHealthSummary
): number {
  const byClassification =
    CLASSIFICATION_ORDER[a.classification] -
    CLASSIFICATION_ORDER[b.classification];
  if (byClassification !== 0) return byClassification;

  const aDays = a.daysUntilLaunch;
  const bDays = b.daysUntilLaunch;
  if (aDays !== bDays) {
    if (aDays === null) return 1;
    if (bDays === null) return -1;
    return aDays - bDays;
  }

  return a.churchName.localeCompare(b.churchName);
}

export interface PlantHealthGroup {
  classification: PlantHealthClassification;
  meta: ClassificationMeta;
  plants: PlantHealthSummary[];
}

/**
 * Split the portfolio into scan-ordered groups, each internally ordered by
 * need. Empty groups are dropped: a section header reading "0" is noise, and
 * the summary bar already accounts for every plant.
 */
export function groupPlantsByNeed(
  plants: readonly PlantHealthSummary[]
): PlantHealthGroup[] {
  return CLASSIFICATION_SCAN_ORDER.map((classification) => ({
    classification,
    meta: CLASSIFICATION_META[classification],
    plants: plants
      .filter((plant) => plant.classification === classification)
      .sort(comparePlantsByNeed),
  })).filter((group) => group.plants.length > 0);
}

// ----------------------------------------------------------------------------
// Insight ordering and emphasis.
// ----------------------------------------------------------------------------

/** How loudly an insight is presented. `high` and `critical` share a level. */
export type InsightEmphasis = "high" | "medium" | "low";

const SEVERITY_EMPHASIS: Record<InsightSeverity, InsightEmphasis> = {
  critical: "high",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

export function emphasisForSeverity(
  severity: InsightSeverity
): InsightEmphasis {
  return SEVERITY_EMPHASIS[severity] ?? "low";
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Order a card's observations most-urgent first, falling back to the judge's
 * own `rank` (lower = higher priority) within a severity. Non-mutating: the
 * caller's array is a query result that other callers may also hold.
 */
export function sortInsightsByUrgency<
  T extends Pick<PlantInsight, "severity" | "rank">,
>(insights: readonly T[]): T[] {
  return [...insights].sort((a, b) => {
    const bySeverity =
      (SEVERITY_ORDER[a.severity] ?? SEVERITY_ORDER.info) -
      (SEVERITY_ORDER[b.severity] ?? SEVERITY_ORDER.info);
    if (bySeverity !== 0) return bySeverity;
    return a.rank - b.rank;
  });
}

// ----------------------------------------------------------------------------
// Freshness.
// ----------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * How stale the snapshot behind a card is, as a short scan-friendly string, or
 * null when the plant has never been assessed. A portfolio read is only worth
 * acting on if you know how old it is, and "no assessment yet" is a materially
 * different state from "the planter withheld this" — the caller must be able
 * to tell them apart, so this returns null rather than a placeholder.
 */
export function assessedAgoLabel(
  generatedAt: Date | null,
  now: Date = new Date()
): string | null {
  if (!generatedAt) return null;

  const days = Math.floor((now.getTime() - generatedAt.getTime()) / MS_PER_DAY);
  if (days <= 0) return "Assessed today";
  if (days === 1) return "Assessed yesterday";
  if (days < 30) return `Assessed ${days} days ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return "Assessed last month";
  return `Assessed ${months} months ago`;
}

/**
 * The launch countdown as a label plus whether it is close enough to carry
 * emphasis. The window matches `READINESS_LAUNCH_WINDOW_DAYS` in the read
 * layer, so what the badge claims and what the copy stresses agree.
 */
export function launchLabel(
  daysUntilLaunch: number | null,
  readinessWindowDays: number
): { text: string; imminent: boolean } | null {
  if (daysUntilLaunch === null) return null;

  // Only a launch still ahead can be imminent. A date in the past is history
  // for a launched plant, and emphasising it would put a warm highlight on
  // every post-launch church in the portfolio for no reason.
  const imminent =
    daysUntilLaunch >= 0 && daysUntilLaunch <= readinessWindowDays;

  if (daysUntilLaunch < 0) {
    const days = Math.abs(daysUntilLaunch);
    return {
      text: days === 1 ? "Launched yesterday" : `Launched ${days} days ago`,
      imminent,
    };
  }
  if (daysUntilLaunch === 0) return { text: "Launches today", imminent };
  if (daysUntilLaunch === 1) return { text: "Launches tomorrow", imminent };
  return { text: `Launches in ${daysUntilLaunch} days`, imminent };
}
