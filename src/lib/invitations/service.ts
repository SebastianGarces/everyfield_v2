"use server";

// ============================================================================
// Organization invitations — the action layer (issue #265).
//
// EVERY export of a `"use server"` module is a POSTable endpoint, whether or
// not any UI calls it. This module used to export all eleven invitation
// functions, so an unauthenticated request could accept an invitation as
// somebody else — `respondingUser` was an argument — or detach any church from
// its sending church by guessing a uuid. Both are closed here:
//
//   1. The actor is NEVER an argument. Every action below mints it with
//      `invitationActorFromSession(await verifySession())`, which throws
//      "Unauthorized" when there is no session, so a forged POST carrying a
//      foreign user changes nothing: there is no parameter for it to land in
//      and no code path that reads one. Same rule as
//      `src/app/(dashboard)/settings/{,sharing/}actions.ts`.
//   2. Everything that is not an endpoint — the reads, the association
//      primitives, the row builders — lives in `./core`, which has no
//      `"use server"` directive and is therefore unreachable from a browser.
//      `hasValidInvitationBypass` (register) and the G3 harness import it
//      directly; the client cannot.
//
// The exports here are exactly the four invitation-lifecycle mutations a user
// performs on their own behalf. Disassociation is NOT one of them and does not
// belong here: #274 ruled that both sides may sever, and each side's
// authenticated wrapper ships with the surface that owns it (#277 planter,
// #278 org admin) — see `./core` → Disassociation.
//
// What comes BACK is narrowed too: `InvitationView`, not the row. The raw row
// carries `inviter_user_id` and `responded_by`, so returning it told the invitee
// the inviting admin's user id (and the inviter the responder's). No surface
// needs either — see `./core` → What a client is told.
//
// Errors: an `InvitationError` is a message the user is meant to read (not
// yours, not pending, already associated with another org, expired); anything
// else is logged server-side and reported generically, so an internal failure
// never reaches the client.
// `service.test.ts` pins the shape of this file — its export surface is read off
// the imported module, so `export default` and re-exports are caught too.
// ============================================================================

import type { OrganizationInvitation } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";

import {
  InvitationError,
  acceptInvitationAs,
  createInvitationAs,
  declineInvitationAs,
  invitationActorFromSession,
  invitationView,
  revokeInvitationAs,
  type InvitationRequest,
  type InvitationView,
} from "./core";

export type InvitationActionResult =
  | { success: true; invitation: InvitationView }
  | { success: false; error: string };

const GENERIC_ERROR = "Something went wrong — try that again";

/**
 * One place where a mutation becomes a result: the row is narrowed to
 * `InvitationView` (`./core`), which drops the two internal user ids the raw row
 * carries, and an unexpected failure becomes a generic message with the detail
 * left in the server log.
 */
async function run(
  label: string,
  mutate: () => Promise<OrganizationInvitation>
): Promise<InvitationActionResult> {
  try {
    return { success: true, invitation: invitationView(await mutate()) };
  } catch (error) {
    if (error instanceof InvitationError) {
      return { success: false, error: error.message };
    }
    console.error(`${label} failed`, error);
    return { success: false, error: GENERIC_ERROR };
  }
}

/**
 * Issue an invitation. The inviting org and the invitation `type` are derived
 * from the session — a client says only who is being invited — so an oversight
 * admin can never enrol a plant into an org that is not theirs.
 */
export async function createInvitation(
  request: InvitationRequest
): Promise<InvitationActionResult> {
  const actor = invitationActorFromSession(await verifySession());
  return run("createInvitation", () => createInvitationAs(actor, request));
}

/**
 * Accept an invitation addressed to the actor's own church or sending church.
 *
 * An accept BINDS a free association or re-binds its own; it never replaces one
 * that already points at a different org — that is a sever, and a sever is
 * audited and notified (#274/OV-007, shipping in #277/#278). Refused with
 * `ALREADY_ASSOCIATED_MESSAGE` and nothing written; see `./core` →
 * `acceptInvitationAs`.
 */
export async function acceptInvitation(
  invitationId: string
): Promise<InvitationActionResult> {
  const actor = invitationActorFromSession(await verifySession());
  return run("acceptInvitation", () => acceptInvitationAs(actor, invitationId));
}

/**
 * Decline an invitation addressed to the actor's own church or sending church.
 */
export async function declineInvitation(
  invitationId: string
): Promise<InvitationActionResult> {
  const actor = invitationActorFromSession(await verifySession());
  return run("declineInvitation", () =>
    declineInvitationAs(actor, invitationId)
  );
}

/**
 * Revoke an invitation the actor sent. The inviter is the session's user and
 * the check lives in the UPDATE, so anyone else matches no row.
 */
export async function revokeInvitation(
  invitationId: string
): Promise<InvitationActionResult> {
  const actor = invitationActorFromSession(await verifySession());
  return run("revokeInvitation", () => revokeInvitationAs(actor, invitationId));
}
