// ============================================================================
// Oversight plant-health read path (privacy-gated) — PE-007 / PE-009 / PE-012 /
// PE-013 / PE-017, AC-PE-7 / AC-PE-9.
//
// The network/sending-church oversight surface reads the latest COMPLETE
// assessment snapshot per plant via `getLatestAssessment` (zero LLM on load,
// PE-011) and exposes ONLY network-audience insights. It NEVER returns a
// planter-audience insight and NEVER returns an individual-person finding.
//
// Privacy is enforced at THIS query layer, not in the component:
//   1. Access is gated by `getAccessibleChurchIds` + `canAccessFeatureData`
//      (existing helpers in @/lib/auth/access).
//   2. Each network insight is additionally gated by the church's `share_*`
//      privacy toggle that corresponds to the insight's rubric category. When
//      a planter toggles a share setting OFF, the corresponding network content
//      disappears from this read (AC-PE-9 / PE-012).
//   3. Planter-sees-first is preserved: we only read COMPLETE snapshots — the
//      same row the planter's own surface reads — so oversight never sees
//      anything generated ahead of the planter (PE-013).
//
// Framing is conservative on purpose ("observation, not verdict"): the health
// classification is a coarse, fact-derived posture, never a pass/fail judgment.
// ============================================================================

import { inArray } from "drizzle-orm";

import {
  churches,
  type PlantAssessment,
  type PlantInsight,
  type User,
} from "@/db/schema";
import type { PrivacyFeatureKey } from "@/lib/auth/access";
import type { LatestAssessment } from "@/lib/phase-engine/assessment";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

// The value imports below transitively load the DB client (`@/db`). They are
// deferred to the call sites inside async reads so the pure exports in this
// module (classification, privacy-category mapping) stay unit-testable without
// a DATABASE_URL — the same seam the assessment persistence layer uses.

// ----------------------------------------------------------------------------
// Health classification (PE-017) — pure, fact-derived, conservative.
// ----------------------------------------------------------------------------

/**
 * Coarse, "observation not verdict" posture for a plant in a portfolio view:
 *   - `on-track`   : no elevated network signals; steady.
 *   - `watch`      : at least one medium-urgency network observation.
 *   - `readiness`  : a high/critical network observation, OR launch is imminent
 *                    or past due — the plant warrants a readiness conversation.
 */
export type PlantHealthClassification = "on-track" | "watch" | "readiness";

/** DB severities that escalate a plant to the `readiness` posture. */
const READINESS_SEVERITIES = new Set<PlantInsight["severity"]>([
  "high",
  "critical",
]);
/** DB severities that escalate a plant to the `watch` posture. */
const WATCH_SEVERITIES = new Set<PlantInsight["severity"]>(["medium"]);

/** Launch within this many days (or past due) nudges toward `readiness`. */
export const READINESS_LAUNCH_WINDOW_DAYS = 30;

/**
 * Classify a plant's health from its visible NETWORK insights plus the launch
 * countdown fact. Pure: no DB, no LLM. Callers must pass only the network
 * insights that survived privacy gating, so the classification can never be
 * driven by withheld content.
 */
export function classifyPlantHealth(
  visibleNetworkInsights: Pick<PlantInsight, "severity">[],
  snapshot: PlantFactSnapshot | null
): PlantHealthClassification {
  const hasReadinessSeverity = visibleNetworkInsights.some((i) =>
    READINESS_SEVERITIES.has(i.severity)
  );
  if (hasReadinessSeverity) return "readiness";

  // Imminent or past-due launch warrants a readiness conversation.
  const days = snapshot?.launch.daysUntilLaunch ?? null;
  if (days !== null && days <= READINESS_LAUNCH_WINDOW_DAYS) {
    return "readiness";
  }

  const hasWatchSeverity = visibleNetworkInsights.some((i) =>
    WATCH_SEVERITIES.has(i.severity)
  );
  if (hasWatchSeverity) return "watch";

  return "on-track";
}

// ----------------------------------------------------------------------------
// Category → privacy feature mapping (AC-PE-9 / PE-012).
//
// Each network insight is tagged with a rubric `category`. We map that category
// to the `share_*` privacy toggle whose underlying data the insight is derived
// from. An insight is only shown to oversight when the church shares that
// feature. Toggling the corresponding share setting off removes the insight.
//
// `null` => the category is not tied to a privacy-gated feature and is gated by
// the page-level access check alone (it never names individuals).
// ----------------------------------------------------------------------------

const CATEGORY_PRIVACY_FEATURE: Record<string, PrivacyFeatureKey | null> = {
  // People-derived lenses (commitments, leadership, follow-up, generosity).
  vision_casting: "people",
  shared_ownership: "people",
  critical_mass: "people",
  unity: "people",
  prayer: "people",
  generosity: "people",
  emerging_leadership: "people",
  follow_up: "people",
  // Meeting cadence / attendance.
  launch_readiness: "meetings",
  // Training completions live under the ministry-team surface.
  comprehensive_training: "ministry_teams",
  // Cross-cutting categories not tied to one privacy-gated feature.
  phase_progress: null,
  onboarding: null,
};

/**
 * The privacy feature an insight category is gated by, or null if ungated.
 * Unknown categories fail closed: they require the broadest (`people`) toggle.
 */
export function privacyFeatureForCategory(
  category: string
): PrivacyFeatureKey | null {
  return category in CATEGORY_PRIVACY_FEATURE
    ? CATEGORY_PRIVACY_FEATURE[category]
    : "people";
}

// ----------------------------------------------------------------------------
// Read result types.
// ----------------------------------------------------------------------------

/** One plant's privacy-safe, network-only health summary for the portfolio. */
export interface PlantHealthSummary {
  churchId: string;
  churchName: string;
  currentPhase: number;
  classification: PlantHealthClassification;
  /** Network-audience insights that survived privacy gating (may be empty). */
  insights: PlantInsight[];
  /** Whole days until launch, or null when no launch date is set. */
  daysUntilLaunch: number | null;
  /** When the latest snapshot was generated, or null if never assessed. */
  generatedAt: Date | null;
  /**
   * True when the plant shares at least one feature relevant to the network
   * read. When false, the planter has not opted any data into oversight; we
   * still list the plant (phase is portfolio context) but show no insights.
   */
  hasSharedContent: boolean;
}

// ----------------------------------------------------------------------------
// Privacy gating of a single assessment's insights.
// ----------------------------------------------------------------------------

/**
 * Filter a latest-assessment payload down to the NETWORK insights an oversight
 * user may see for this church. Drops:
 *   - every planter-audience insight (PE-012),
 *   - any insight whose corresponding `share_*` toggle is off (AC-PE-9).
 *
 * Individual-person findings were already excluded at persistence time
 * (assessment/persist.ts); we re-assert audience here as defense in depth.
 */
async function gateNetworkInsights(
  user: User,
  churchId: string,
  latest: LatestAssessment | null
): Promise<{ insights: PlantInsight[]; hasSharedContent: boolean }> {
  if (!latest) return { insights: [], hasSharedContent: false };

  const { canAccessFeatureData } = await import("@/lib/auth/access");

  const networkInsights = latest.insights.filter(
    (i) => i.audience === "network"
  );

  // Resolve each distinct feature's share status once.
  const features = new Set<PrivacyFeatureKey>();
  for (const insight of networkInsights) {
    const feature = privacyFeatureForCategory(insight.category);
    if (feature) features.add(feature);
  }

  const featureAllowed = new Map<PrivacyFeatureKey, boolean>();
  await Promise.all(
    Array.from(features).map(async (feature) => {
      featureAllowed.set(
        feature,
        await canAccessFeatureData(user, churchId, feature)
      );
    })
  );

  const visible = networkInsights.filter((insight) => {
    const feature = privacyFeatureForCategory(insight.category);
    if (feature === null) return true; // not privacy-gated
    return featureAllowed.get(feature) === true;
  });

  const hasSharedContent = Array.from(featureAllowed.values()).some(Boolean);

  return { insights: visible, hasSharedContent };
}

// ----------------------------------------------------------------------------
// Portfolio read.
// ----------------------------------------------------------------------------

/**
 * Build the privacy-safe oversight portfolio for the given user. Reads the
 * latest COMPLETE snapshot per accessible plant (no LLM, PE-011), exposes only
 * network insights, and applies the per-feature privacy gate (AC-PE-9).
 *
 * Returns one summary per accessible church, ordered by name.
 */
export async function getOversightPlantHealth(
  user: User
): Promise<PlantHealthSummary[]> {
  // Deferred (DB-touching) imports — see the note at the top of this module.
  const { db } = await import("@/db");
  const { getAccessibleChurchIds } = await import("@/lib/auth/access");
  const { getLatestAssessment } = await import("@/lib/phase-engine/assessment");

  const churchIds = await getAccessibleChurchIds(user);
  if (churchIds.length === 0) return [];

  const plants = await db
    .select({
      id: churches.id,
      name: churches.name,
      currentPhase: churches.currentPhase,
    })
    .from(churches)
    .where(inArray(churches.id, churchIds));

  const summaries = await Promise.all(
    plants.map(async (plant) => {
      const latest = await getLatestAssessment(plant.id);
      const { insights, hasSharedContent } = await gateNetworkInsights(
        user,
        plant.id,
        latest
      );

      const snapshot = snapshotOf(latest?.assessment ?? null);
      const classification = classifyPlantHealth(insights, snapshot);

      return {
        churchId: plant.id,
        churchName: plant.name,
        currentPhase: plant.currentPhase,
        classification,
        insights,
        daysUntilLaunch: snapshot?.launch.daysUntilLaunch ?? null,
        generatedAt: latest?.assessment.generatedAt ?? null,
        hasSharedContent,
      } satisfies PlantHealthSummary;
    })
  );

  return summaries.sort((a, b) => a.churchName.localeCompare(b.churchName));
}

/** Narrow the stored `factSnapshot` jsonb to the typed snapshot, or null. */
function snapshotOf(
  assessment: PlantAssessment | null
): PlantFactSnapshot | null {
  if (!assessment) return null;
  return assessment.factSnapshot as PlantFactSnapshot;
}
