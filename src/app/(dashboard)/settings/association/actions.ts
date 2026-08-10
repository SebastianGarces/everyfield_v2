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
  leaveNetworkAsSendingChurchAdmin,
  leaveOversightOrgAs,
  oversightOrgTypes,
} from "@/lib/invitations/core";

// ============================================================================
// The association area — its four writes (#304, OV-004/006/007a/013; WS3).
//
// ----------------------------------------------------------------------------
// ACCEPT and DECLINE serve BOTH answering roles; LEAVE is the planter's alone
// ----------------------------------------------------------------------------
//
// The two answers take an invitation id and nothing else, and WHO may answer it
// is `verifyInvitationAuthority`'s question, asked per invitation TYPE: the
// planter of the target plant for `church_to_sending_church` /
// `church_to_network`, the admin of the target sending church for
// `sending_church_to_network`. So the sending-church view added by #304 WS3
// (ruled 2026-08-09) reuses these two verbatim — there is no second pair of
// endpoints, no role branch here, and therefore no way for the two surfaces to
// disagree about who may answer what. A non-admin member of the target sending
// church is refused by that same rule, server-side, exactly as a team member of
// a plant is.
//
// LEAVE IS PER ROLE, and there are two of them — one endpoint each, never one
// endpoint with a role branch. `leaveOversightOrg` is planter-only (OV-010) and
// takes WHICH of the plant's two associations to end; `leaveNetwork` is
// sending-church-admin-only (OV-013) and takes nothing at all, because a sending
// church has exactly one association and it is always with a network. Each
// derives its entity from the session, so neither has a parameter the other's
// role could aim.
//
// OV-013 shipped with WS3 and could not have shipped before it: a sever has to
// be audited (#274/OV-007) and until migration 0035 `association_events` made a
// CHURCH its mandatory subject, so a sending church leaving a network had
// nowhere to be recorded. Ruling #351 gave the table a subject discriminator;
// `leaveNetworkAsSendingChurchAdmin` writes the row in the same statement as the
// FK null.
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
// SESSION FIRST, THEN THE PARSE (ruled 2026-08-10, round 5 of #304). The mint is
// the FIRST statement of every export here — ahead of `safeParse`, not after it
// — so an anonymous POST is refused before its argument is examined at all.
// Parsing first was not exploitable (these schemas touch no database and the
// authority checks all sit downstream), but it published a shape-oracle for
// free: a sessionless caller got `{ success: false, error: "Unknown
// invitation" }` for a malformed id and a throw for a well-formed one, which
// distinguishes the two without a session. It also meant the order differed
// from one entry point to the next, and "does this endpoint check the session
// before it does anything" stopped being answerable by looking at line one.
// `service.test.ts` §1b′ now enumerates the exports of this module and calls
// every one of them with no session at all — a well-formed argument AND a
// malformed one, both of which must throw — so the order is pinned rather than
// remembered.
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
 * Accept an invitation addressed to the actor's own organization — their plant
 * (OV-004) or, since #304 WS3, their sending church.
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
  const actor = invitationActorFromSession(await verifySession());

  const parsed = invitationIdSchema.safeParse(invitationId);
  if (!parsed.success) {
    return { success: false, error: "Unknown invitation" };
  }

  return run("acceptAssociationInvitation", () =>
    acceptInvitationAs(actor, parsed.data)
  );
}

/**
 * Decline an invitation addressed to the actor's own organization (OV-006) —
 * their plant, or their sending church (#304 WS3).
 *
 * Sets the status, which is what removes the dashboard reminder and what the
 * inviting org's invitations list renders as "Declined"; the notification to
 * that org rides the consent-exempt own-relationship rail and is
 * `declineInvitationAs`'s to send. Both answers reach their org since migration
 * 0035: a plant's decline is filed under the plant, a sending church's under the
 * NETWORK that asked (ruling #351). Either way it names the ADDRESS THE ORG
 * TYPED and nothing else — the refused org never associated, so neither the
 * plant's name nor the sending church's is theirs to learn.
 */
export async function declineAssociationInvitation(
  invitationId: string
): Promise<AssociationActionResult> {
  const actor = invitationActorFromSession(await verifySession());

  const parsed = invitationIdSchema.safeParse(invitationId);
  if (!parsed.success) {
    return { success: false, error: "Unknown invitation" };
  }

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
  const actor = invitationActorFromSession(await verifySession());

  const parsed = orgTypeSchema.safeParse(orgType);
  if (!parsed.success) {
    return {
      success: false,
      error: "That is not an organization you can leave",
    };
  }

  return run("leaveOversightOrg", () =>
    leaveOversightOrgAs(actor, parsed.data)
  );
}

/**
 * Leave the network your sending church belongs to (OV-013).
 *
 * NO ARGUMENT AT ALL, and that is the shape of the authority rule rather than a
 * convenience: the sending church is the actor's own (`actor.sendingChurchId`),
 * the network is whatever that sending church currently points at, and the org
 * kind is fixed — a sending church associates with networks and nothing else. So
 * there is no parameter a forged POST could aim at another organization.
 *
 * The type-to-confirm dialog in front of this is a deliberateness control, not
 * an authorization one. The admin-only check, the tenancy assertion (the FK is
 * nulled only while it still points at the network being left) and the
 * `association_events` row all sit in `leaveNetworkAsSendingChurchAdmin`, where
 * a request that never opened the dialog meets them too. A non-admin member of
 * the sending church is refused there, server-side.
 */
export async function leaveNetwork(): Promise<AssociationActionResult> {
  const actor = invitationActorFromSession(await verifySession());
  return run("leaveNetwork", () => leaveNetworkAsSendingChurchAdmin(actor));
}
