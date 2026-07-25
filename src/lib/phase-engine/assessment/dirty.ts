// ============================================================================
// Dirty / stale selection (PE-010 / AC-PE-8) — pure logic.
//
// A plant is selected for (re-)assessment when EITHER:
//   1. it is "dirty" — a material event landed after the last assessment was
//      generated (`lastMaterialEventAt > latestGeneratedAt`), OR
//   2. it is "stale" — the last assessment is older than the max-staleness
//      window, so even a quiet plant gets a periodic refresh.
//
// A plant with no assessment yet is always selected (never assessed = dirty).
// A quiet plant whose last assessment is recent and has seen no material event
// is excluded.
//
// These helpers are intentionally pure (no DB, no clock) so they can be
// unit-tested deterministically. The DB-backed selection that feeds them lives
// in queries.ts; this module only decides yes/no given the facts.
// ============================================================================

/**
 * Default max-staleness window. Even with no material events, a plant is
 * re-assessed at least this often so its snapshot never goes stale.
 */
export const MAX_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** The per-church facts needed to decide selection. */
export interface PlantSelectionInput {
  churchId: string;
  /** When a material event last landed for this plant, or null if never. */
  lastMaterialEventAt: Date | null;
  /**
   * `generatedAt` of this plant's latest COMPLETE assessment, or null if the
   * plant has never been assessed. Pending/failed runs do not count — a failed
   * run must not suppress re-selection.
   */
  latestAssessmentAt: Date | null;
}

/** Why a plant was selected — useful for logging/observability. */
export type SelectionReason = "never-assessed" | "dirty" | "stale";

/**
 * Decide whether a single plant should be (re-)assessed, given a reference
 * time. Returns the reason when selected, or `null` when the plant is quiet and
 * fresh enough to skip.
 *
 * @param input          per-church selection facts
 * @param now            reference time (injected for determinism)
 * @param maxStalenessMs max age of the latest assessment before forced refresh
 */
export function selectionReasonFor(
  input: PlantSelectionInput,
  now: Date,
  maxStalenessMs: number = MAX_STALENESS_MS
): SelectionReason | null {
  // Never assessed → always select.
  if (input.latestAssessmentAt === null) {
    return "never-assessed";
  }

  const latestMs = input.latestAssessmentAt.getTime();

  // Dirty: a material event occurred strictly after the last assessment.
  if (
    input.lastMaterialEventAt !== null &&
    input.lastMaterialEventAt.getTime() > latestMs
  ) {
    return "dirty";
  }

  // Stale: the latest assessment is older than the staleness window.
  if (now.getTime() - latestMs > maxStalenessMs) {
    return "stale";
  }

  // Quiet and fresh → skip.
  return null;
}

/** True when the plant should be (re-)assessed (AC-PE-8). */
export function isDirtyOrStale(
  input: PlantSelectionInput,
  now: Date,
  maxStalenessMs: number = MAX_STALENESS_MS
): boolean {
  return selectionReasonFor(input, now, maxStalenessMs) !== null;
}

/**
 * Filter a batch of plants down to those needing (re-)assessment, preserving
 * input order. Pure over its inputs (AC-PE-8).
 */
export function filterDirtyOrStale(
  inputs: PlantSelectionInput[],
  now: Date,
  maxStalenessMs: number = MAX_STALENESS_MS
): PlantSelectionInput[] {
  return inputs.filter((p) => isDirtyOrStale(p, now, maxStalenessMs));
}
