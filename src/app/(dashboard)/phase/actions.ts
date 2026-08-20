"use server";

import { revalidatePath } from "next/cache";

import { requireChurchAccess, requirePlantOwner } from "@/lib/auth/access";
import { verifySession } from "@/lib/auth/session";
import {
  transitionPhase,
  transitionPhaseSchema,
  type TransitionResult,
} from "@/lib/phase-engine/transitions";
import type { ActionResult } from "@/lib/people/types";

// ============================================================================
// Phase control server actions (PE-001/002/003).
//
// THIS MODULE'S EXPORT LIST IS ITS AUTH SURFACE — every export is a public POST
// endpoint reachable with no session and no UI (memory/invariants.md →
// Authentication). It therefore holds exactly ONE export, the write the UI
// makes. Readiness (PE-015) is a READ with no caller here: `/phase` calls
// `getPhaseReadiness` directly from the server component, so it needs no
// endpoint of its own and no longer has one.
//
// The one action:
//   - verifies the session (throws → "Unauthorized"),
//   - enforces the PLANTER role (only the planter controls their plant's phase),
//   - takes the PLANT FROM THE SESSION, never from the caller,
//   - enforces church_id scope via `requireChurchAccess`.
//
// The transition itself is never blocked on readiness (PE-001) — readiness is
// surfaced separately, advisory only, on `/phase`.
// ============================================================================

/**
 * Input for a phase transition from the UI.
 *
 * NO `churchId`. A planter's plant is implied by the actor, and an entity
 * implied by the actor is not an argument (memory/invariants.md →
 * Authentication). It used to be one, defended by `requireChurchAccess`, which
 * made "can this caller move another plant?" a question about a downstream
 * check rather than a shape the endpoint cannot express.
 */
export interface TransitionPhaseActionInput {
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
 * Enforces the plant Owner seat + church_id scope before any write.
 */
export async function transitionPhaseAction(
  input: TransitionPhaseActionInput
): Promise<ActionResult<TransitionResult>> {
  try {
    const { user } = await verifySession();

    // Only the plant's Owner controls its phase.
    requirePlantOwner(user);

    // The plant is the session's, not the caller's. An Owner with no church
    // has nothing to move.
    const churchId = user.churchId;
    if (!churchId) {
      return {
        success: false,
        error: "You must be associated with a church plant to change the phase",
      };
    }

    // Kept even though the id is now session-minted: `requireChurchAccess` is
    // the one place the role→church rule lives, and asking it here means this
    // endpoint does not carry a second, private copy of it.
    await requireChurchAccess(user, churchId);

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

    const result = await transitionPhase(churchId, user.id, parsed.data);

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
