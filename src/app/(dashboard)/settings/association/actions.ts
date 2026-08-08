"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { verifySession } from "@/lib/auth/session";
import {
  InvitationError,
  acceptInvitationAs,
  declineInvitationAs,
  invitationActorFromSession,
  isUuid,
  leaveOversightOrgAs,
  oversightOrgTypes,
} from "@/lib/invitations/core";

// ============================================================================
// The planter's association area — its three writes (#304, OV-004/006/007a).
//
// ----------------------------------------------------------------------------
// Why this module reaches `@/lib/invitations/core` at all
// ----------------------------------------------------------------------------
//
// `service.test.ts` → "no 'use server' module republishes the invitation logic
// layer" bans every action module from reaching the logic layer unless it is
// named, with its reason, in that test's `CORE_REACHING_ACTION_MODULES`. This
// module is on that list because of the LEAVE action: severing is not one of
// `service.ts`'s four lifecycle mutations and deliberately never will be
// (#265's finding — an action layer is an endpoint list, and a severing
// endpoint that took a church id was one of the eleven it removed). The ruling
// (#274 / OV-007) is that each side's authenticated wrapper ships with the
// surface that owns its authority rule, deriving the entity from the session
// rather than from an argument. This is that wrapper for the plant's side.
//
// Accept and decline could have gone through `service.ts` — and its two actions
// are exactly these, minus the `refresh()`. They are re-wrapped here for one
// reason: this screen and the dashboard reminder both have to re-render the
// moment an invitation is answered, and `refresh()` belongs to the surface, not
// to a shared lifecycle action that `/oversight` also calls.
//
// ----------------------------------------------------------------------------
// Nothing here takes an actor, a church, or an org id
// ----------------------------------------------------------------------------
//
// Every action mints its actor with
// `invitationActorFromSession(await verifySession())`, which throws with no
// session, and the plant is the actor's own. LEAVE takes a two-valued enum —
// WHICH of the plant's two oversight associations to end — and not an id, so
// there is no parameter a forged POST could aim at somebody else's church.
//
// OV-010, ruled #274: accept, decline and leave are the PLANTER'S. A
// `team_member` or `coach` of the same plant is refused server-side —
// `verifyInvitationAuthority` for the two answers, `leaveOversightOrgAs` for the
// sever — so hiding the buttons is a courtesy, never the control.
//
// `refresh()` rather than `revalidatePath('/settings/association')`
// (`memory/contracts/data-patterns.md`): answering an invitation changes the
// dashboard reminder, which lives on another route, and the pending list on
// this one. `refresh()` re-renders the current tree including its layouts,
// which is what makes the reminder go away in the same round trip.
// ============================================================================

export type AssociationActionResult =
  | { success: true }
  | { success: false; error: string };

const GENERIC_ERROR = "Something went wrong — try that again";

const invitationIdSchema = z.string().refine(isUuid, "Unknown invitation");
const orgTypeSchema = z.enum(oversightOrgTypes);

/**
 * One place where a mutation becomes a result. An `InvitationError` is a message
 * the user is meant to read (not yours, not pending, expired, not associated);
 * anything else is logged server-side and reported generically, so an internal
 * failure never reaches the client.
 *
 * Nothing is returned but success — not the invitation row, not an org id. This
 * screen re-renders from the server after `refresh()`, so there is no view model
 * for a client to hold and no id for it to be handed.
 */
async function run(
  label: string,
  mutate: () => Promise<unknown>
): Promise<AssociationActionResult> {
  try {
    await mutate();
    refresh();
    return { success: true };
  } catch (error) {
    if (error instanceof InvitationError) {
      return { success: false, error: error.message };
    }
    console.error(`${label} failed`, error);
    return { success: false, error: GENERIC_ERROR };
  }
}

/**
 * Accept an invitation addressed to the planter's own plant (OV-004).
 *
 * The association, the audit row and the milestone to the inviting org are all
 * `acceptInvitationAs`'s — including the rule that an accept BINDS a free slot
 * or re-binds its own and never REPLACES another org's association. A plant
 * already in a sending church has to leave it first, which is now a thing this
 * very screen can do.
 */
export async function acceptAssociationInvitation(
  invitationId: string
): Promise<AssociationActionResult> {
  const parsed = invitationIdSchema.safeParse(invitationId);
  if (!parsed.success) {
    return { success: false, error: "Unknown invitation" };
  }

  const actor = invitationActorFromSession(await verifySession());
  return run("acceptAssociationInvitation", () =>
    acceptInvitationAs(actor, parsed.data)
  );
}

/**
 * Decline an invitation addressed to the planter's own plant (OV-006).
 *
 * Sets the status, which is what removes the dashboard reminder and what the
 * inviting org's invitations list renders as "Declined"; the notification to
 * that org rides the consent-exempt own-relationship rail and is
 * `declineInvitationAs`'s to send.
 */
export async function declineAssociationInvitation(
  invitationId: string
): Promise<AssociationActionResult> {
  const parsed = invitationIdSchema.safeParse(invitationId);
  if (!parsed.success) {
    return { success: false, error: "Unknown invitation" };
  }

  const actor = invitationActorFromSession(await verifySession());
  return run("declineAssociationInvitation", () =>
    declineInvitationAs(actor, parsed.data)
  );
}

/**
 * Leave a sending church or a network (OV-007a).
 *
 * The argument is WHICH of the plant's own two associations to end — never a
 * church id and never an org id. The type-to-confirm dialog in front of this is
 * a deliberateness control, not an authorization one: it lives in the browser,
 * so the authority rule, the tenancy assertion and the audit row all sit in
 * `leaveOversightOrgAs` where a forged call meets them too.
 */
export async function leaveOversightOrg(
  orgType: string
): Promise<AssociationActionResult> {
  const parsed = orgTypeSchema.safeParse(orgType);
  if (!parsed.success) {
    return {
      success: false,
      error: "That is not an organization you can leave",
    };
  }

  const actor = invitationActorFromSession(await verifySession());
  return run("leaveOversightOrg", () =>
    leaveOversightOrgAs(actor, parsed.data)
  );
}
