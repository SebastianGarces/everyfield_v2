"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { planterCheckinLevels } from "@/db/schema";
import { requireChurchAccess } from "@/lib/auth/access";
import { requireSeat } from "@/lib/auth/seats";
import { rethrowUnauthorized } from "@/lib/auth/unauthorized";
import {
  CHECKIN_NOTE_MAX,
  weekStartOf,
} from "@/lib/phase-engine/planter-checkin";
import { saveCheckin } from "@/lib/phase-engine/planter-checkin-db";

// ============================================================================
// The planter's weekly sustainability check-in (#484, C19).
//
// PRIVATE BY CONSTRUCTION. This action writes `planter_checkins` and nothing
// else — no signal, no dirty marker, no assessment trigger. Answering must not
// nudge the engine in any way, or the answers would be observable through their
// side effects even though nothing reads them.
//
// THE WEEK IS SERVER-DERIVED, never posted. A client-supplied `weekStart` would
// let a caller write any week they liked, and the week is the unique key that
// makes answering idempotent.
//
// EVERY EXPORT MINTS ITS ACTOR ABOVE ITS `try` (`tasks/actions.ts` header,
// #411).
// ============================================================================

const checkinSchema = z.object({
  spiritually: z.enum(planterCheckinLevels),
  marriageFamily: z.enum(planterCheckinLevels),
  financially: z.enum(planterCheckinLevels),
  pace: z.enum(planterCheckinLevels),
  note: z.string().max(CHECKIN_NOTE_MAX).nullish(),
});

export type SaveCheckinInput = z.infer<typeof checkinSchema>;

type ActionResult = { success: true } | { success: false; error: string };

export async function saveCheckinAction(
  input: SaveCheckinInput
): Promise<ActionResult> {
  // `phase.signal` — the same capability the attestation toggles carry. This is
  // the planter answering about their own plant, not an admin action.
  const { user } = await requireSeat("phase.signal");

  try {
    if (!user.churchId) {
      return { success: false, error: "You must be associated with a church" };
    }

    const parsed = checkinSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "That answer was not one of the three." };
    }

    await requireChurchAccess(user, user.churchId);

    await saveCheckin(
      user.churchId,
      user.id,
      weekStartOf(new Date()),
      parsed.data
    );

    // `refresh()`, not `revalidatePath("/phase")`: the check-in changes nothing
    // off this page, and the card now DERIVES its answered state from the props
    // this re-render carries (#634). The contract names the shape —
    // memory/contracts/data-patterns.md.
    refresh();

    return { success: true };
  } catch (error) {
    rethrowUnauthorized(error);
    console.error("saveCheckinAction error:", error);
    return {
      success: false,
      error: "Could not save your check-in. Please try again.",
    };
  }
}
