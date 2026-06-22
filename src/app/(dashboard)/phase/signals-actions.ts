"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAccess } from "@/lib/auth/access";
import { verifySession } from "@/lib/auth/session";
import {
  setManualSignalSchema,
  upsertManualSignal,
  type SetManualSignalInput,
} from "@/lib/phase-engine/signals/attestation-service";
import type { PlantSignal } from "@/db/schema";

// ============================================================================
// Manual self-attestation server actions (PE-005 / AC-PE-3).
//
// church_id-scoped. Toggling/saving a manual signal upserts plant_signals and
// marks the plant dirty so the attestation feeds the next assessment.
// ============================================================================

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Upsert a manual signal attestation for the current user's church.
 *
 * Enforces church_id scope via the session + requireChurchAccess. Persists the
 * attestation (who/when) and marks the plant dirty so it is reflected in the
 * next assessment's reasoning (AC-PE-3).
 */
export async function setManualSignalAction(
  input: SetManualSignalInput
): Promise<ActionResult<{ signal: PlantSignal }>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to attest signals",
      };
    }

    const parsed = setManualSignalSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid signal",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    // Tenant isolation (NFR-PE-6): confirm the user may write to this church.
    await requireChurchAccess(user, user.churchId);

    const signal = await upsertManualSignal(
      user.churchId,
      user.id,
      parsed.data
    );

    revalidatePath("/phase");

    return { success: true, data: { signal } };
  } catch (error) {
    console.error("setManualSignalAction error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to attest signals",
      };
    }

    return {
      success: false,
      error: "An unexpected error occurred while saving the signal",
    };
  }
}
