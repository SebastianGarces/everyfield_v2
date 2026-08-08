"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { verifySession } from "@/lib/auth/session";
import {
  InvitationError,
  invitationActorFromSession,
  isUuid,
  removePlantFromOrgAs,
} from "@/lib/invitations/core";

// ============================================================================
// The org's sever — its one write (#304, OV-007b).
//
// ----------------------------------------------------------------------------
// Why this module reaches `@/lib/invitations/core` at all
// ----------------------------------------------------------------------------
//
// `service.test.ts` → "no 'use server' module republishes the invitation logic
// layer" bans every action module from reaching the logic layer unless it is
// named, with its reason, in that test's `CORE_REACHING_ACTION_MODULES`. This
// module is on that list, and the reason is the same one the planter's side has:
// severing is not one of `service.ts`'s four lifecycle mutations and deliberately
// never will be (#265's finding — an action layer is an endpoint list, and a
// severing endpoint that took a church id was one of the eleven it removed). The
// ruling (#274 / OV-007) is that each side's authenticated wrapper ships with the
// surface that owns its authority rule.
//
// ----------------------------------------------------------------------------
// The one argument, and what is NOT one
// ----------------------------------------------------------------------------
//
// `churchId` is an argument because an org has many plants — which one is a real
// choice the admin makes, and it is the only thing this action is told. The ORG,
// its KIND and the actor all come from the session
// (`invitationActorFromSession(await verifySession())`, then `oversightOrgOfUser`
// inside the logic layer), so there is no parameter here that could aim the
// sever at another org's association.
//
// The tenancy assertion is not this module's: `removePlantFromOrgAs` nulls the FK
// only while it still points at the caller's own org, and writes the
// `association_events` row FROM that same UPDATE. A forged POST carrying another
// org's plant id therefore matches nothing and is refused with the same message a
// nonexistent id gets.
//
// `revalidatePath('/oversight/plants')` rather than `refresh()`
// (`memory/contracts/data-patterns.md`): the mutation's visible effect is on
// ANOTHER route — the plant drops out of the directory — and the current route
// ceases to exist for this caller the moment the FK is null, so refreshing it in
// place would re-render a 404. The dialog navigates to the directory on success.
// ============================================================================

export type RemovePlantResult =
  | { success: true }
  | { success: false; error: string };

const GENERIC_ERROR = "Something went wrong — try that again";

const churchIdSchema = z.string().refine(isUuid, "Unknown church plant");

/**
 * Remove a church plant from the caller's own sending church or network
 * (OV-007b).
 *
 * The type-to-confirm dialog in front of this is a deliberateness control, not an
 * authorization one: it lives in the browser, so the authority rule, the tenancy
 * assertion, the audit row and the notification to the plant's planter all sit in
 * `removePlantFromOrgAs`, where a request that never opened the dialog meets them
 * too.
 *
 * Nothing is returned but success. An `InvitationError` is a message the user is
 * meant to read (not an admin, no org, not your plant); anything else is logged
 * server-side and reported generically, so an internal failure never reaches the
 * client.
 */
export async function removePlantFromOrg(
  churchId: string
): Promise<RemovePlantResult> {
  const parsed = churchIdSchema.safeParse(churchId);
  if (!parsed.success) {
    return { success: false, error: "Unknown church plant" };
  }

  const actor = invitationActorFromSession(await verifySession());

  try {
    await removePlantFromOrgAs(actor, parsed.data);
    revalidatePath("/oversight/plants");
    return { success: true };
  } catch (error) {
    if (error instanceof InvitationError) {
      return { success: false, error: error.message };
    }
    console.error("removePlantFromOrg failed", error);
    return { success: false, error: GENERIC_ERROR };
  }
}
