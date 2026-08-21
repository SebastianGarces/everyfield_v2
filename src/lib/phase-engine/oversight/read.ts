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
 *   - `on-track`           : no elevated network signals, and nothing withheld.
 *   - `watch`              : at least one medium-urgency network observation.
 *   - `readiness`          : a high/critical network observation, OR launch is
 *                            imminent or past due.
 *   - `limited-visibility` : the plant would have read on-track, but content was
 *                            withheld by the privacy gate — so "nothing wrong"
 *                            cannot be distinguished from "nothing visible".
 *
 * "Past due" is the SNAPSHOT's own `launch.isPastDue`, never a negative
 * countdown re-derived here. The two are not the same: `buildLaunchSignals`
 * excludes a COMPLETED launch from `isPastDue` on purpose ("a launch that
 * HAPPENED is not overdue … otherwise every plant that launches successfully
 * accrues an escalating warning for the rest of its life"), and reading the raw
 * countdown instead brought that warning back on the one surface a sending
 * church looks at.
 *
 * WHY THE FOURTH VALUE EXISTS (#480, C11). Bryan: "I would not want absence of
 * warning signs to accidentally look like an 'on track' signal." That was the
 * behaviour: this function is fed only the insights that survived privacy
 * gating, so a fully-private plant arrived with an empty array and fell through
 * to `on-track`. It could not tell silence from health because nothing told it
 * anything had been withheld — which is why the gating outcome is now a
 * PARAMETER rather than something a caller may forget to mention.
 */
export type PlantHealthClassification =
  | "on-track"
  | "watch"
  | "readiness"
  | "limited-visibility";

/**
 * Is there something still unresolved that a launch this close makes urgent?
 *
 * TWO GAPS, both named by Bryan (C23): "30 days from launch + 3 critical roles
 * unfilled + training incomplete". Roles are the coverage half — a plant
 * launching without a worship leader has a real problem the clock makes worse.
 * Training is the preparation half.
 *
 * UNKNOWN IS NOT A GAP. A snapshot missing either block cannot establish one,
 * and the escalation needs a POSITIVE finding: "we could not tell" must not
 * manufacture a warning on somebody's overseer dashboard. An older persisted
 * snapshot therefore reads as no gap, which is the conservative direction.
 */
function hasReadinessGap(snapshot: PlantFactSnapshot | null): boolean {
  if (!snapshot) return false;

  const roles = snapshot.ministryRoles;
  const rolesUnfilled =
    roles !== undefined &&
    roles.isEmpty === false &&
    roles.filledCount < roles.totalRoles;

  const training = snapshot.training;
  const trainingIncomplete =
    training !== undefined &&
    training.isEmpty === false &&
    training.requiredCompletionRate !== null &&
    training.requiredCompletionRate < 1;

  return rolesUnfilled || trainingIncomplete;
}

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
 * What the privacy gate did to this plant's insights — the context that makes
 * `on-track` an honest claim rather than an accident of silence (#480).
 */
export interface VisibilityContext {
  /**
   * The plant shares at least one assessment-bearing category with this
   * overseer. False means the portfolio is looking at a plant that has opted
   * nothing in — the strongest form of "we cannot see".
   */
  hasSharedContent: boolean;
  /**
   * How many network insights the gate removed. Non-zero means the plant is
   * partially private: some of what the assessment found is not on this screen.
   */
  withheldCount: number;
}

/**
 * Classify a plant's health from its visible NETWORK insights, the launch
 * countdown fact, and what the privacy gate withheld. Pure: no DB, no LLM.
 *
 * Callers must pass only the network insights that survived privacy gating —
 * the classification can never be driven by withheld CONTENT — but they must
 * now also say that something WAS withheld, which is a different thing and the
 * whole point of #480.
 *
 * ESCALATIONS WIN (D1). A visible high/critical still reads "Readiness focus"
 * on a partially-private plant: what is on the screen is real, and hiding a
 * genuine escalation behind "we cannot see everything" would be a worse lie
 * than the one this issue fixes. `limited-visibility` replaces ONLY the
 * on-track claim, which is the only one silence can forge.
 */
export function classifyPlantHealth(
  visibleNetworkInsights: Pick<PlantInsight, "severity">[],
  snapshot: PlantFactSnapshot | null,
  visibility: VisibilityContext
): PlantHealthClassification {
  const hasReadinessSeverity = visibleNetworkInsights.some((i) =>
    READINESS_SEVERITIES.has(i.severity)
  );
  if (hasReadinessSeverity) return "readiness";

  // Imminent or past-due launch warrants a readiness conversation — BUT ONLY
  // ALONGSIDE AN UNRESOLVED GAP (#486, C23). Bryan: "Thirty days out alone
  // should not create a warning. Thirty days out with significant unresolved
  // readiness gaps should… '30 days from launch + everything is on track' =
  // nothing to escalate."
  //
  // TIME IS NEVER SUFFICIENT. The old rule put every plant into readiness focus
  // for the month before its launch, including the ones that had done
  // everything right — which is the month those planters least need a warning
  // about themselves on their overseer's dashboard.
  const launch = snapshot?.launch ?? null;
  const days = launch?.daysUntilLaunch ?? null;
  // AHEAD and inside the window. The lower bound is what stops a launch that
  // happened two years ago (days = −730) from satisfying `days <= 30` forever.
  const imminent =
    days !== null && days >= 0 && days <= READINESS_LAUNCH_WINDOW_DAYS;
  // BEHIND, and the snapshot says it was never recorded as held. One field, one
  // decision — see the note above `PlantHealthClassification`.
  const overdue = launch?.isPastDue === true;
  if ((imminent || overdue) && hasReadinessGap(snapshot)) {
    return "readiness";
  }

  const hasWatchSeverity = visibleNetworkInsights.some((i) =>
    WATCH_SEVERITIES.has(i.severity)
  );
  if (hasWatchSeverity) return "watch";

  // Nothing elevated is visible. Whether that means "nothing is wrong" or
  // "we cannot see" is exactly what the gate knows and this function did not.
  if (!visibility.hasSharedContent || visibility.withheldCount > 0) {
    return "limited-visibility";
  }

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
  cohesion: "people",
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

/**
 * Whether oversight has any shared content to show for a plant.
 *
 * Two independent reasons this is true:
 *   1. At least one insight survived gating. This covers the ungated categories
 *      (`phase_progress`, `onboarding`) that are visible on their own merit and
 *      reference no `share_*` toggle at all — without this clause a plant whose
 *      only network insight is ungated would be reported as "shares nothing"
 *      and the UI would suppress an insight that legitimately passed the gate.
 *   2. The church shares at least one feature the network read consulted, even
 *      if the judge produced no insight for it this cycle. The distinction
 *      matters to the planter: "shared, nothing to report" is not "withheld".
 *
 * Pure so the branch is testable without a DATABASE_URL.
 */
export function computeHasSharedContent(
  visibleInsights: readonly unknown[],
  featureAllowed: Iterable<boolean>
): boolean {
  if (visibleInsights.length > 0) return true;
  return Array.from(featureAllowed).some(Boolean);
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
   * True when there is shared content to show: either an insight survived
   * gating, or the plant shares at least one feature the read consulted. When
   * false, the planter has opted nothing into oversight; we still list the
   * plant (phase is portfolio context) but show no insights.
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
): Promise<{
  insights: PlantInsight[];
  hasSharedContent: boolean;
  withheldCount: number;
}> {
  if (!latest) {
    return { insights: [], hasSharedContent: false, withheldCount: 0 };
  }

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

  const hasSharedContent = computeHasSharedContent(
    visible,
    featureAllowed.values()
  );

  return {
    insights: visible,
    hasSharedContent,
    // What the gate removed, not what the judge did not find. A plant with no
    // network insights at all withholds nothing (#480).
    withheldCount: networkInsights.length - visible.length,
  };
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
      // THE PLANTER-FIRST GATE (#482, C16/C25). `"network"` asks for the
      // newest RELEASED assessment, which may be an older one than the planter
      // is looking at: an assessment reaches oversight when the planter has
      // opened it, or after the 72-hour window. #480's classifier therefore
      // reads released data only — one consistency rule for the whole surface.
      const latest = await getLatestAssessment(plant.id, "network");
      const { insights, hasSharedContent, withheldCount } =
        await gateNetworkInsights(user, plant.id, latest);

      const snapshot = snapshotOf(latest?.assessment ?? null);
      const classification = classifyPlantHealth(insights, snapshot, {
        hasSharedContent,
        withheldCount,
      });

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
