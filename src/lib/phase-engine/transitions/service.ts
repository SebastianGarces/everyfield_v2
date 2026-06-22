// ============================================================================
// Phase Engine — phase transition service (PE-001/002/003/015).
//
// Soft-gated phase control. A planter may advance, regress, or correct the
// current phase. Transitions are NEVER blocked on readiness — the readiness
// state is advisory only (the rubric's gates inform the planter; the planter
// decides). Every transition:
//   1. Writes an immutable `phase_transitions` row capturing the fact snapshot
//      (Signal layer) + the active rubric version at the moment of transition
//      (PE-002 / AC-PE-1 / NFR-PE-5).
//   2. Updates `churches.current_phase`.
//   3. Emits `phase.changed` for downstream consumers (PE-003).
//
// This module is church_id-scoped (NFR-PE-6). The "use server" action layer
// (../../app/(dashboard)/phase/actions.ts) performs auth + access checks and
// resolves the initiating user before calling `transitionPhase`.
//
// Pure logic (validation, the row builder, readiness derivation) is separated
// from I/O so it is unit-testable without a database.
// ============================================================================

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  phaseTransitions,
  type NewPhaseTransition,
  type PhaseTransition,
} from "@/db/schema";
import { getLatestAssessment } from "@/lib/phase-engine/assessment";
import { emitPhaseChanged } from "@/lib/phase-engine/events";
import { ACTIVE_RUBRIC } from "@/lib/phase-engine/rubric";
import {
  buildFactSnapshot,
  type PlantFactSnapshot,
} from "@/lib/phase-engine/signals";

// ----------------------------------------------------------------------------
// Phase bounds + validation
// ----------------------------------------------------------------------------

/** Lowest valid phase (Discovery). */
export const MIN_PHASE = 0;
/** Highest valid phase (Post-Launch). Mirrors rubric-v0 Part B. */
export const MAX_PHASE = 6;

/**
 * Validates a transition request. Kept here (not in the "use server" action) so
 * it is unit-testable. Soft-gated: the *only* constraints are a well-formed
 * target phase and a non-empty reason — readiness is never enforced (PE-001).
 */
export const transitionPhaseSchema = z.object({
  toPhase: z
    .number()
    .int("Phase must be an integer")
    .min(MIN_PHASE, `Phase must be >= ${MIN_PHASE}`)
    .max(MAX_PHASE, `Phase must be <= ${MAX_PHASE}`),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required")
    .max(2000, "Reason is too long"),
});

export type TransitionPhaseInput = z.infer<typeof transitionPhaseSchema>;

// ----------------------------------------------------------------------------
// Transition direction (pure)
// ----------------------------------------------------------------------------

/** The kind of move relative to the current phase. */
export type TransitionDirection = "advance" | "regress" | "skip" | "noop";

/**
 * Classify a transition by direction. Forward by one = advance; backward = a
 * regression (correction); forward by more than one = skip; same = noop. This
 * is descriptive metadata only — no direction is ever blocked (PE-001).
 */
export function classifyTransition(
  fromPhase: number,
  toPhase: number
): TransitionDirection {
  if (toPhase === fromPhase) return "noop";
  if (toPhase < fromPhase) return "regress";
  return toPhase - fromPhase === 1 ? "advance" : "skip";
}

// ----------------------------------------------------------------------------
// Immutable audit row (pure)
// ----------------------------------------------------------------------------

/** Everything needed to build a `phase_transitions` insert payload. */
export interface BuildTransitionRowInput {
  churchId: string;
  fromPhase: number;
  toPhase: number;
  initiatedById: string;
  reason: string;
  factSnapshot: PlantFactSnapshot;
  rubricVersion: string;
}

/**
 * Build the immutable audit row for a phase transition (PE-002 / AC-PE-1).
 * Pure — captures from/to, the initiating user, the reason, the deterministic
 * fact snapshot (Signal layer), and the active rubric version. The `createdAt`
 * timestamp is assigned by the DB default on insert.
 */
export function buildTransitionRow(
  input: BuildTransitionRowInput
): NewPhaseTransition {
  return {
    churchId: input.churchId,
    fromPhase: input.fromPhase,
    toPhase: input.toPhase,
    initiatedById: input.initiatedById,
    reason: input.reason,
    factSnapshot: input.factSnapshot,
    rubricVersion: input.rubricVersion,
  };
}

// ----------------------------------------------------------------------------
// Readiness derivation (pure) — PE-015
// ----------------------------------------------------------------------------

/**
 * Readiness state for the current phase, derived from the latest assessment's
 * readiness insight. Advisory only — surfaced in the phase-control UI so the
 * planter sees the rubric's gate read, but it NEVER blocks a transition.
 */
export interface PhaseReadiness {
  /** Whether a readiness signal could be derived at all. */
  hasAssessment: boolean;
  /**
   * Coarse readiness for advancing out of the current phase, inferred from the
   * severity of the latest `launch_readiness` / `phase_progress` insight:
   *   - "ready"     : no readiness concern raised (positive/info only)
   *   - "approaching": a "watch"-level readiness concern exists
   *   - "not_ready" : an "urgent" readiness concern exists
   *   - "unknown"   : no assessment / no readiness insight yet
   */
  state: "ready" | "approaching" | "not_ready" | "unknown";
  /** The headline of the driving readiness insight, for display. */
  headline: string | null;
  /** The body of the driving readiness insight, for display. */
  detail: string | null;
  /** Assessment id the readiness read came from (audit/trace). */
  assessmentId: string | null;
}

/** Insight categories that speak to readiness/phase progression. */
const READINESS_CATEGORIES = new Set(["launch_readiness", "phase_progress"]);

/** A minimal insight shape — just the fields readiness derivation needs. */
interface ReadinessInsightLike {
  category: string;
  audience: string;
  severity: string;
  title: string;
  body: string;
  rank: number;
}

/**
 * Derive the readiness state from a latest-assessment payload (PE-015). Pure:
 * given the assessment id + its insights, picks the highest-priority
 * planter-facing readiness insight and maps its severity to a coarse state.
 * Returns an "unknown" state when there is no assessment or no readiness insight.
 */
export function deriveReadiness(
  assessmentId: string | null,
  insights: ReadinessInsightLike[]
): PhaseReadiness {
  if (!assessmentId) {
    return {
      hasAssessment: false,
      state: "unknown",
      headline: null,
      detail: null,
      assessmentId: null,
    };
  }

  // Planter-facing readiness insights, highest priority first (lower rank wins).
  const readiness = insights
    .filter(
      (i) => i.audience === "planter" && READINESS_CATEGORIES.has(i.category)
    )
    .sort((a, b) => a.rank - b.rank);

  if (readiness.length === 0) {
    return {
      hasAssessment: true,
      state: "unknown",
      headline: null,
      detail: null,
      assessmentId,
    };
  }

  const driving = readiness[0];
  const state = severityToReadiness(driving.severity);

  return {
    hasAssessment: true,
    state,
    headline: driving.title,
    detail: driving.body,
    assessmentId,
  };
}

/** Map an insight severity to a coarse readiness state. */
function severityToReadiness(
  severity: string
): "ready" | "approaching" | "not_ready" {
  switch (severity) {
    case "urgent":
      return "not_ready";
    case "watch":
      return "approaching";
    // positive / info → no concern raised
    default:
      return "ready";
  }
}

// ----------------------------------------------------------------------------
// Transition (I/O) — PE-001/002/003
// ----------------------------------------------------------------------------

/** Result of a successful phase transition. */
export interface TransitionResult {
  transition: PhaseTransition;
  fromPhase: number;
  toPhase: number;
  direction: TransitionDirection;
}

/** Raised when the target church does not exist. */
export class ChurchNotFoundError extends Error {
  constructor() {
    super("Church not found");
    this.name = "ChurchNotFoundError";
  }
}

/**
 * Transition a plant to `toPhase` with a required `reason` (PE-001/002/003).
 *
 * Soft-gated: forward, backward, and skip moves are all allowed and NEVER
 * blocked. The caller (the action layer) is responsible for verifying that
 * `initiatedById` is a planter with access to `churchId`.
 *
 * Steps:
 *   1. Resolve the church + its current phase (church_id-scoped).
 *   2. Capture the deterministic fact snapshot (Signal layer) + active rubric
 *      version, and write an immutable `phase_transitions` row (AC-PE-1).
 *   3. Update `churches.current_phase`.
 *   4. Emit `phase.changed` for downstream consumers (PE-003).
 *
 * @param churchId       Tenant scope (caller must have verified access).
 * @param initiatedById  The planter initiating the transition.
 * @param input          Validated target phase + reason.
 * @throws ChurchNotFoundError if the church does not exist.
 * @returns The persisted transition row + direction metadata.
 */
export async function transitionPhase(
  churchId: string,
  initiatedById: string,
  input: TransitionPhaseInput
): Promise<TransitionResult> {
  const [church] = await db
    .select({ id: churches.id, currentPhase: churches.currentPhase })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!church) {
    throw new ChurchNotFoundError();
  }

  const fromPhase = church.currentPhase;
  const { toPhase, reason } = input;

  // Deterministic fact snapshot at the moment of transition (Signal layer) +
  // the active rubric version, captured for the immutable audit row (AC-PE-1).
  const factSnapshot = await buildFactSnapshot(churchId);
  const rubricVersion = ACTIVE_RUBRIC.version;

  const [transition] = await db
    .insert(phaseTransitions)
    .values(
      buildTransitionRow({
        churchId,
        fromPhase,
        toPhase,
        initiatedById,
        reason,
        factSnapshot,
        rubricVersion,
      })
    )
    .returning();

  // Move the plant to the new phase.
  await db
    .update(churches)
    .set({ currentPhase: toPhase })
    .where(eq(churches.id, churchId));

  // Notify downstream consumers (PE-003). The event bus no-ops on zero handlers
  // until the PE-event-wiring unit registers them.
  await emitPhaseChanged({
    churchId,
    fromPhase,
    toPhase,
    initiatedById,
    rubricVersion,
  });

  return {
    transition,
    fromPhase,
    toPhase,
    direction: classifyTransition(fromPhase, toPhase),
  };
}

/**
 * Read the readiness state for a church's current phase (PE-015). Derived from
 * the latest COMPLETE assessment's readiness insight — no LLM call. Advisory
 * only; surfaced in the phase-control UI alongside the transition control.
 *
 * @param churchId Tenant scope (caller must have verified access).
 */
export async function getPhaseReadiness(
  churchId: string
): Promise<PhaseReadiness> {
  const latest = await getLatestAssessment(churchId);
  if (!latest) {
    return deriveReadiness(null, []);
  }
  return deriveReadiness(latest.assessment.id, latest.insights);
}
