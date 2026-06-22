"use server";

import { revalidatePath } from "next/cache";

import { requireChurchAccess, requireRole } from "@/lib/auth/access";
import { verifySession } from "@/lib/auth/session";
import {
  getPhaseReadiness,
  transitionPhase,
  transitionPhaseSchema,
  type PhaseReadiness,
  type TransitionResult,
} from "@/lib/phase-engine/transitions";
import type { ActionResult } from "@/lib/people/types";

// ============================================================================
// Phase control server actions (PE-001/002/003/015).
//
// The "use server" boundary for soft-gated phase control. Every action:
//   - verifies the session (throws → "Unauthorized"),
//   - enforces the PLANTER role (only the planter controls their plant's phase),
//   - enforces church_id scope via `requireChurchAccess`.
//
// The transition itself is never blocked on readiness (PE-001) — readiness is
// surfaced separately, advisory only, via `getPhaseReadinessAction`.
// ============================================================================

/** Input for a phase transition from the UI. */
export interface TransitionPhaseActionInput {
  /** The plant whose phase is changing. */
  churchId: string;
  /** Target phase (0–6). Forward, backward, or skip — all allowed. */
  toPhase: number;
  /** Required free-text justification for the change (PE-002). */
  reason: string;
}

/**
 * Advance, regress, or correct a plant's phase with a required reason
 * (PE-001/002/003). Soft-gated — never blocks. Writes the immutable audit row,
 * updates the current phase, and emits `phase.changed`.
 *
 * Enforces planter role + church_id scope before any write.
 */
export async function transitionPhaseAction(
  input: TransitionPhaseActionInput
): Promise<ActionResult<TransitionResult>> {
  try {
    const { user } = await verifySession();

    // Only the planter controls their plant's phase.
    requireRole(user, "planter");

    // Tenant scope: the planter must have access to the target church.
    await requireChurchAccess(user, input.churchId);

    const parsed = transitionPhaseSchema.safeParse({
      toPhase: input.toPhase,
      reason: input.reason,
    });

    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    const result = await transitionPhase(input.churchId, user.id, parsed.data);

    // Refresh any phase-aware surfaces.
    revalidatePath("/phase");
    revalidatePath("/dashboard");

    return { success: true, data: result };
  } catch (error) {
    console.error("transitionPhaseAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in to change the phase",
        };
      }
      if (error.message.startsWith("Forbidden")) {
        return {
          success: false,
          error: "You do not have permission to change this plant's phase",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while changing the phase",
    };
  }
}

/**
 * Read the advisory readiness state for a plant's current phase (PE-015).
 * Enforces planter role + church_id scope. Derived from the latest assessment;
 * never an LLM call. Surfaced in the phase-control UI.
 */
export async function getPhaseReadinessAction(
  churchId: string
): Promise<ActionResult<PhaseReadiness>> {
  try {
    const { user } = await verifySession();

    requireRole(user, "planter");
    await requireChurchAccess(user, churchId);

    const readiness = await getPhaseReadiness(churchId);
    return { success: true, data: readiness };
  } catch (error) {
    console.error("getPhaseReadinessAction error:", error);

    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return {
          success: false,
          error: "You must be logged in to view phase readiness",
        };
      }
      if (error.message.startsWith("Forbidden")) {
        return {
          success: false,
          error: "You do not have permission to view this plant's readiness",
        };
      }
    }

    return {
      success: false,
      error: "An unexpected error occurred while reading phase readiness",
    };
  }
}
