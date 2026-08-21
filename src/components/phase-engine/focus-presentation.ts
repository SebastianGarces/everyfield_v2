// ============================================================================
// Focus presentation helpers — pure, DOM-free transforms shared by the planter
// Focus surfaces (PE-005/007/015/016).
//
// Extracted from the RSC page + components so the load-bearing presentation
// logic (reading the stored what-changed delta, extracting boolean
// self-attestations, mapping severities/readiness to plain language, labelling
// delta fields) is unit-testable under the repo's node:test harness, which only
// runs `src/**/*.test.ts` (no DOM / no .tsx tests).
// ============================================================================

import type { InsightSeverity } from "@/db/schema";
import type { SnapshotDelta } from "@/lib/phase-engine/assessment";
import type { PhaseReadiness } from "@/lib/phase-engine/transitions";
// Imported from the module directly, not the `@/lib/wiki` barrel: the barrel
// pulls in the DB-backed service and this file must stay DOM- and IO-free.
import { wikiHref } from "@/lib/wiki/href";

// ----------------------------------------------------------------------------
// Stored what-changed delta (PE-016).
// ----------------------------------------------------------------------------

/**
 * Read the what-changed delta the assessment carries on its stored fact snapshot
 * (the orchestrator persists it as `factSnapshot._delta`, PE-016). Returns null
 * when absent or malformed.
 */
export function readDelta(factSnapshot: unknown): SnapshotDelta | null {
  if (
    factSnapshot &&
    typeof factSnapshot === "object" &&
    "_delta" in factSnapshot
  ) {
    return (factSnapshot as { _delta?: SnapshotDelta })._delta ?? null;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Manual self-attestations (PE-005).
// ----------------------------------------------------------------------------

/**
 * Extract the boolean self-attestations the toggle UI renders, keyed by signal
 * key. Non-boolean attestation values (free-text / numeric signals) are ignored.
 */
export function readBooleanSignals(
  signals: { signalKey: string; value: unknown }[]
): Record<string, boolean> {
  const values: Record<string, boolean> = {};
  for (const signal of signals) {
    if (typeof signal.value === "boolean") {
      values[signal.signalKey] = signal.value;
    }
  }
  return values;
}

/**
 * Whole days since each attestation was last answered, keyed by signal key
 * (#474 D2) — what the toggle card needs to know which answers have gone stale.
 *
 * Measured against ONE `asOf` the caller supplies, for the same reason `/tasks`
 * takes one clock read for its whole render: two ages computed a millisecond
 * apart can straddle a day boundary and disagree (`memory/invariants.md` → Date
 * & Time Rendering).
 *
 * Clamped at 0 — a clock skew must not render "confirmed -3 days ago".
 */
export function readAttestationAges(
  signals: { signalKey: string; attestedAt: Date }[],
  asOf: Date
): Record<string, number> {
  const ages: Record<string, number> = {};
  for (const signal of signals) {
    ages[signal.signalKey] = Math.max(
      0,
      Math.floor((asOf.getTime() - signal.attestedAt.getTime()) / 86_400_000)
    );
  }
  return ages;
}

// ----------------------------------------------------------------------------
// Severity presentation — plain language, never a raw enum (PE-009).
// ----------------------------------------------------------------------------

export interface SeverityMeta {
  label: string;
  badgeVariant: "secondary" | "outline" | "destructive";
}

export const SEVERITY_META: Record<InsightSeverity, SeverityMeta> = {
  critical: { label: "Urgent", badgeVariant: "destructive" },
  high: { label: "Needs attention", badgeVariant: "destructive" },
  medium: { label: "Worth a look", badgeVariant: "outline" },
  low: { label: "FYI", badgeVariant: "secondary" },
  info: { label: "Going well", badgeVariant: "secondary" },
};

export function severityMeta(severity: InsightSeverity): SeverityMeta {
  return SEVERITY_META[severity] ?? SEVERITY_META.info;
}

// ----------------------------------------------------------------------------
// The observation budget: one primary focus + up to two supplements (#478).
//
// Bryan (C09): "As a planter, I already have 25 things competing for my
// attention. The value of this tool would be telling me, 'Of everything going
// on, these are the 1–3 things that matter most right now.'" And (C18), more
// bluntly: "too many... 1 main 2 supplement." The panel was rendering every
// planter insight, four to seven of them, each one looking as important as the
// last.
//
// POSITIVES DO NOT COMPETE FOR THE SLOTS (D1, Sebastian 2026-08-20): "They
// don't have to be tied together or presented together." The budget is "things
// to focus on this week" — work items. Encouragement is still first-class and
// still generated; it is simply not one of the three things a planter is being
// asked to do.
// ----------------------------------------------------------------------------

/**
 * The stored severity a judge `positive` lands on.
 *
 * The judge's vocabulary (positive|info|watch|urgent) is mapped onto the stored
 * one (info|low|medium|high|critical) by `assessment/persist.ts`, and
 * `positive → info` is the only thing that produces a stored `info`. So the
 * stored value IS the positive marker — `SEVERITY_META.info` has read "Going
 * well" since before this issue — and nothing new had to be persisted for the
 * panel to tell encouragement from work.
 */
export const POSITIVE_SEVERITY: InsightSeverity = "info";

/** Is this insight encouragement rather than a thing to do? */
export function isPositive(insight: { severity: InsightSeverity }): boolean {
  return insight.severity === POSITIVE_SEVERITY;
}

/** One primary focus plus at most two supplements. */
export const FOCUS_BUDGET = 3;

/** How the planter's insights divide across the surfaces that show them. */
export interface FocusAllocation<T> {
  /** The one thing to do first. `null` only when there is no work at all. */
  primary: T | null;
  /** At most two more, in the order the assessment ranked them. */
  supplements: T[];
  /**
   * Work items past the budget. Only a LEGACY assessment produces these — the
   * judge schema now refuses more than three — and they go behind a disclosure
   * rather than being dropped, because an assessment that already exists said
   * them and hiding them outright would be a silent edit of the record.
   */
  overflow: T[];
  /** Encouragement, on its own surface. Never counted against the budget. */
  positives: T[];
}

/**
 * Split planter insights into the focus budget and the positives beside it.
 *
 * ORDER IS THE CALLER'S. The insights arrive ranked (`persist.ts` sorts by
 * urgency and stamps `rank`), so this takes the first work item as primary
 * rather than re-deciding urgency — two modules ranking the same list is how
 * the hero and the drill-down come to disagree about what matters most.
 */
export function allocateFocus<T extends { severity: InsightSeverity }>(
  insights: readonly T[]
): FocusAllocation<T> {
  const work = insights.filter((insight) => !isPositive(insight));
  const positives = insights.filter(isPositive);

  return {
    primary: work[0] ?? null,
    supplements: work.slice(1, FOCUS_BUDGET),
    overflow: work.slice(FOCUS_BUDGET),
    positives,
  };
}

// ----------------------------------------------------------------------------
// Readiness presentation (PE-015) — advisory only.
// ----------------------------------------------------------------------------

export interface ReadinessMeta {
  label: string;
  badgeVariant: "secondary" | "outline" | "destructive";
}

export const READINESS_META: Record<PhaseReadiness["state"], ReadinessMeta> = {
  ready: { label: "Ready to advance", badgeVariant: "secondary" },
  approaching: { label: "Approaching readiness", badgeVariant: "outline" },
  not_ready: { label: "Not yet ready", badgeVariant: "destructive" },
  unknown: { label: "Readiness unknown", badgeVariant: "outline" },
};

export function readinessMeta(state: PhaseReadiness["state"]): ReadinessMeta {
  return READINESS_META[state] ?? READINESS_META.unknown;
}

// ----------------------------------------------------------------------------
// What-changed field labels (PE-016).
// ----------------------------------------------------------------------------

/** Human labels for the tracked numeric fact paths in the snapshot delta. */
export const DELTA_FIELD_LABELS: Record<string, string> = {
  currentPhase: "Phase",
  "coreGroup.committedCount": "Core group",
  "coreGroup.launchTeamCount": "Launch team",
  "visionMeetings.totalCompleted": "Vision meetings held",
  "visionMeetings.latestAttendance": "Latest meeting attendance",
  "followUp.openCount": "Open follow-ups",
  "followUp.staleCount": "Stale follow-ups",
  "ministryRoles.filledCount": "Ministry roles filled",
  "training.completionCount": "Training completions",
  "launch.daysUntilLaunch": "Days until launch",
};

export function deltaFieldLabel(path: string): string {
  return DELTA_FIELD_LABELS[path] ?? path;
}

// ----------------------------------------------------------------------------
// Phase + transition labels.
// ----------------------------------------------------------------------------

/** Describe the move direction in plain language for the soft-confirm dialog. */
export function transitionDirectionLabel(from: number, to: number): string {
  if (to === from) return "stay in";
  if (to > from) return to - from === 1 ? "advance to" : "jump to";
  return "move back to";
}

/** Turn an article slug into a readable label, e.g. "core-group" → "Core group". */
export function slugToLabel(slug: string): string {
  const last = slug.split("/").filter(Boolean).pop() ?? slug;
  const words = last.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ----------------------------------------------------------------------------
// "How to improve" wiki links (PE-024).
//
// Persistence only stores slugs the RAG layer actually retrieved
// (assessment/persist.ts → reconcileArticleSlugs), but a stored slug can still
// go stale: the article can be renamed, archived, or unpublished long after the
// assessment ran. A link to a dead slug is a 404 in the middle of a coaching
// moment, so resolution happens at RENDER time against the live published set —
// a slug that no longer resolves yields no link at all.
//
// Resolution filters *which* slugs get linked; it says nothing about whether the
// href for a linked slug is well-formed. A slug is authored content and may hold
// a space, `#` or `?`, so the path is built by `wikiHref()` (per-segment
// percent-encoding), never by raw interpolation.
// ----------------------------------------------------------------------------

/** A resolved, safe-to-render link to a wiki article. */
export interface InsightArticleLink {
  /** The stored slug, raw and undecorated. */
  slug: string;
  /** The URL-safe path for `slug` — percent-encoded per segment. */
  href: string;
  /** The article's real title (falls back to a humanized slug if untitled). */
  label: string;
}

/**
 * Resolve an insight's stored article slugs against the published wiki.
 *
 * @param slugs     the insight's `relatedArticleSlugs` (may be null/empty)
 * @param published slug → title refs for currently published articles
 * @returns one link per slug that still resolves, in stored order, deduped.
 *          Unresolvable (stale) slugs are dropped rather than linked.
 */
export function buildArticleLinks(
  slugs: string[] | null | undefined,
  published: { slug: string; title: string }[]
): InsightArticleLink[] {
  if (!slugs || slugs.length === 0) return [];

  const titleBySlug = new Map(published.map((a) => [a.slug, a.title]));

  const links: InsightArticleLink[] = [];
  const seen = new Set<string>();

  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    const title = titleBySlug.get(slug);
    // Stale slug: the article is gone/unpublished — render nothing, not a 404.
    if (title === undefined) continue;
    seen.add(slug);
    links.push({
      slug,
      href: wikiHref(slug),
      label: title.trim() || slugToLabel(slug),
    });
  }

  return links;
}
