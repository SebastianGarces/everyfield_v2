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
