// ============================================================================
// ANSWERING A COACH INVITATION FROM AN ACCOUNT YOU ALREADY HAVE (AS-009, #496).
//
// NO `"use server"` DIRECTIVE, on the same footing as `./core` and `./seat`:
// every export of a `"use server"` module is a POSTable endpoint reachable with
// no session and no UI (`memory/invariants.md` → Authentication), so the logic
// lives here and `src/app/(auth)/coach-invitation/actions.ts` — which mints its
// session from `requireSeat` — is the only way in from a browser.
//
// ----------------------------------------------------------------------------
// WHY THIS SURFACE EXISTS AND THE SEAT ONE DOES NOT
// ----------------------------------------------------------------------------
//
// A seat invitation is refused for any address that already holds an account
// (AS-010), so there was never anybody who needed a screen to answer one from —
// and by the invariant "no invitation that cannot be answered", one that could
// not be answered is not created.
//
// A coach invitation is the ruled exception (2026-08-20, 185 (5)). It adds a
// `coach_assignments` row and moves nothing: no tenancy is vacated, no seat is
// touched, and the account's existing reach is untouched — access becomes the
// UNION. So any account can hold one, which means some invitees WILL already
// have an account, which means the invariant demands this screen.
//
// THE PLANTER'S INVITATION IS THE CONSENT. No second confirmation is asked of
// the invitee's own tenancy — an Owner elsewhere does not have to approve their
// Admin coaching somebody else's plant, because coaching is read-only and
// carries nothing out of the coach's own tenancy.
//
// ----------------------------------------------------------------------------
// ONE REFUSAL, FOR EVERYTHING THAT IS NOT A CLEAN ACCEPT
// ----------------------------------------------------------------------------
//
// Unknown token, expired, revoked, already answered, or issued to a DIFFERENT
// address — all one sentence. The address binding is the reason: a link travels
// by email, so a forwarded one reaches somebody it does not name, and telling
// them "this is for a different address" confirms both that the token is live
// and that the address they hold is not the one on it. The seat path settled the
// same question the same way (Ruling C, 2026-08-12).
// ============================================================================

import { db } from "@/db";
import { assignCoachOnAcceptStatement } from "@/lib/coaching/assignments";

import { InvitationError } from "./core";
import {
  claimUserInvitationStatement,
  describeUserInvitationForRegistration,
} from "./seat";

/**
 * The one thing this surface ever says when it will not accept.
 *
 * It names the three ordinary reasons without saying which, so a holder of a
 * forwarded link learns exactly what a holder of a guessed one does.
 */
export const COACH_INVITATION_NOT_ANSWERABLE_MESSAGE =
  "That invitation cannot be answered — it may have expired, been withdrawn, or been sent to a different address";

/** What the page renders. The plant's public name and the reader's own address. */
export type CoachInvitationForViewer = {
  inviteeEmail: string;
  churchName: string;
};

/**
 * Look a coach token up for the invitation page.
 *
 * `null` for anything a visitor must not be told about, and for a token that
 * turns out to name a SEAT invitation — this page cannot answer one, and saying
 * so would tell a stranger which kind a live token is.
 *
 * NO SESSION IS READ HERE, deliberately. What the page shows is the same for
 * everybody who holds the token; what changes with the session is only whether
 * the page offers Accept or offers sign-up, and that branch is on the VIEWER,
 * never on the invitee. See `./register-path` → `COACH_INVITATION_PATH`.
 */
export async function describeCoachInvitationForViewer(
  token: string | null | undefined,
  now: Date = new Date()
): Promise<CoachInvitationForViewer | null> {
  const described = await describeUserInvitationForRegistration(token, now);
  if (!described || described.role.kind !== "coach") return null;

  return {
    inviteeEmail: described.inviteeEmail,
    churchName: described.churchName,
  };
}

/**
 * Accept it, as the account already signed in.
 *
 * TWO STATEMENTS, ONE BATCH, AND THE ORDER IS THE GUARD
 * (`memory/invariants.md` → Transactions):
 *
 *   1. the CLAIM — a compare-and-set on `pending` that also stamps
 *      `responded_by` with this account;
 *   2. the ASSIGNMENT — an `INSERT … SELECT` whose `WHERE` re-asserts
 *      `status = 'accepted'` and whose columns are READ OUT OF the invitation
 *      row, so it can name neither another person nor another plant.
 *
 * A claim that matched nothing leaves the second statement selecting nothing:
 * it writes nothing and rolls nothing back, and the empty `returning()` is what
 * this function reads to refuse. The reverse order would let an assignment be
 * written for an invitation that was revoked in the same instant.
 *
 * THE ADDRESS BINDING RUNS FIRST. The token is bound to the address it was
 * issued to, so an account signed in as somebody else cannot spend a forwarded
 * link — the same rule the seat path applies at registration, applied here to
 * the session instead of to the submitted form.
 */
export async function acceptCoachInvitationAs(
  user: { id: string; email: string },
  token: string | null | undefined,
  now: Date = new Date()
): Promise<{ churchName: string }> {
  const described = await describeUserInvitationForRegistration(token, now);

  if (!described || described.role.kind !== "coach") {
    throw new InvitationError(COACH_INVITATION_NOT_ANSWERABLE_MESSAGE);
  }

  const invited = described.inviteeEmail.trim().toLowerCase();
  const answering = (user.email ?? "").trim().toLowerCase();

  if (invited.length === 0 || invited !== answering) {
    throw new InvitationError(COACH_INVITATION_NOT_ANSWERABLE_MESSAGE);
  }

  const [claimed] = await db.batch([
    claimUserInvitationStatement(described.id, user.id, now),
    assignCoachOnAcceptStatement(described.id),
  ]);

  if (claimed.length === 0) {
    throw new InvitationError(COACH_INVITATION_NOT_ANSWERABLE_MESSAGE);
  }

  return { churchName: described.churchName };
}
