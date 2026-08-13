// ============================================================================
// "Resend email" on a pending invitation — RULED 2026-08-10 (Sebastian, on
// PR #392 / #293), amended the same day, reconciled 2026-08-12 with #304.
//
// A pending invitation carries a "Resend email" action, so a send that failed —
// or that the invitee deleted, or that their provider ate — is recoverable AT
// ANY TIME. Nothing is persisted: no `email_sent` column, no migration, no
// delivery badge. The alternative that was rejected (persist the outcome and
// badge the row) records "the provider accepted it", which is not a delivery
// receipt, so the badge would assert something the product never actually
// knows.
//
// What this path adds over `emailInvitee` is authority and words. It adds no
// status rule of its own — see `./email` rule 2.
//
// ITS OWN MODULE, extracted from `./core` on 2026-08-12 (PR #392 warning (c)).
// `core.ts` had grown past 3300 lines while this path — one authority read, one
// auto-expire, one send, one sentence per refusal — already had its own
// 1100-line test file. The module boundary now matches the test boundary that
// was already there.
//
// WHAT DELIBERATELY STAYED IN `./core`: `orgInvitationQuery` and the
// `invitingOrgOf(actor)` predicate underneath it. They are SHARED with the list
// and the revoke, and splitting the one definition of "invitations this org
// issued" across two files is precisely the duplicated-decision failure the
// rest of this track spent its effort deleting. The dependency runs one way —
// `core` never imports this module — so there is no cycle to manage.
// ============================================================================

import type { OrganizationInvitation } from "@/db/schema";

import {
  InvitationError,
  emailInviteeOutcome,
  expireInvitationQuery,
  isUuid,
  orgInvitationQuery,
  type EmailInviteeDeps,
  type InvitationActor,
} from "./core";
import type { InvitationEmailRefusal } from "./email";
import { resendDedupeWindowAt, type ResendDedupeWindow } from "./resend-window";

/**
 * One message for "there is no such invitation" and "that one is not yours".
 *
 * The same reason `NOT_AUTHORIZED_MESSAGE` covers both on the respond path:
 * telling the two apart turns any authenticated user into a reader of which
 * uuids exist, and an invitation id is also an unauthenticated beta-gate bearer
 * token (`hasValidInvitationBypass`).
 */
export const INVITATION_NOT_OURS_MESSAGE =
  "Invitation not found, or not sent by your organization";

export const INVITATION_EXPIRED_MESSAGE =
  "That invitation has expired — invite them again to send a new link";

/**
 * The one sentence for every internal reason a send did not happen.
 *
 * Exported as a constant so the words live in ONE place, the same reason
 * `INVITATION_EMAIL_FAILED_HEADLINE` is a constant in `./create-notice`.
 *
 * IT NAMES THE REAL RECOVERY, and the real recovery is this button (reconciled
 * 2026-08-12, #293 × #304). It used to read "copy the link and send it
 * yourself", which was true while `/oversight/invitations` still rendered a
 * Copy link control. #304 ruling 4 item 5 removed that control from the notice
 * AND from every pending row, and #293 is the email delivery the admin's copy
 * of the link was a stopgap for — so the sentence was pointing at a button that
 * no longer exists on any admin surface. Pressing **Resend email** again is
 * what an admin can actually do, and it is the control this message renders
 * beside. Never re-introduce a URL here: the ruling forbids this surface
 * rendering `/register?invitation=` at all.
 */
export const INVITATION_SEND_FAILED_MESSAGE =
  "We could not send that email — nothing reached them, so try again in a moment";

/**
 * What the admin reads when a resend produced nothing. Pure and exhaustive over
 * `InvitationEmailRefusal`, so a new refusal code is a compile error here rather
 * than a silent fall-through to "we could not send that email".
 *
 * `not_pending` is the guard inside `sendInvitationEmail` — the one that makes a
 * revoked invitation unsendable for EVERY caller — surfacing as words. Nothing
 * on this path re-checks the status; if that guard were deleted, this branch
 * would go dead and a revoked row would be emailed, which is what
 * `email.test.ts` and `resend.test.ts` both watch for.
 */
export function resendRefusalMessage(reason: InvitationEmailRefusal): string {
  switch (reason) {
    case "not_pending":
      return "That invitation is no longer pending — nothing was sent";
    case "no_address":
      return "That invitation has no email address on it";
    case "no_inviting_org":
    case "unknown_type":
    case "provider_refused":
    case "transport_threw":
    case "preparation_threw":
      // Deliberately one message for the five. They differ only in which
      // internal thing failed, the admin's move is the same in all of them —
      // press Resend email again, which is the control this sentence renders
      // beside — and "the provider rejected the address" is a fact about the
      // invitee's mail host that the log records and the screen does not need.
      return INVITATION_SEND_FAILED_MESSAGE;
    default: {
      const unknownReason: never = reason;
      console.error("invitation resend has no message for this refusal", {
        reason: unknownReason,
      });
      return INVITATION_SEND_FAILED_MESSAGE;
    }
  }
}

/** Run it. `undefined` means "no such invitation, or not ours" — one fact. */
async function loadOrgInvitation(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation | undefined> {
  const [invitation] = await orgInvitationQuery(actor, invitationId);
  return invitation;
}

/** Run the auto-expire compare-and-set. */
async function expireInvitation(
  invitationId: string,
  now: Date
): Promise<void> {
  await expireInvitationQuery(invitationId, now);
}

export interface ResendInvitationDeps extends EmailInviteeDeps {
  /**
   * The org-scoped row read. Defaults to `orgInvitationQuery` — THE authority
   * check of this path — and is replaced only by `resend.test.ts`.
   */
  loadInvitation?: (
    actor: InvitationActor,
    invitationId: string
  ) => Promise<OrganizationInvitation | undefined>;
  /** The auto-expire write. Defaults to `expireInvitationQuery`. */
  expire?: (invitationId: string, now: Date) => Promise<void>;
  /** The instant the window is judged against. Defaults to now. */
  now?: Date;
}

/**
 * Send the invitation email again for a pending invitation the actor's ORG
 * issued.
 *
 * AUTHORITY IS THE `WHERE`, and it is the same `invitingOrgOf(actor)` predicate
 * the list and the revoke are built from — so an admin sees, revokes and
 * resends exactly one population and the three can never disagree about what
 * "ours" means. Every role that does not invite matches nothing, as does an
 * oversight admin with no org of their own. This matters more here than on a
 * read: the export in `service.ts` is a POSTable endpoint that makes mail leave
 * the building, so "which invitations may I aim it at" has to be decided from
 * the session and nowhere else.
 *
 * EXPIRY IS REFUSED, and the refusal writes. `sendInvitationEmail` guards the
 * status, not the window, so a pending-but-expired row would otherwise be
 * emailed with a link `bindOpenInvitationTarget` is guaranteed to reject —
 * telling the invitee to click something that cannot work. The auto-expire is
 * the existing compare-and-set (`expireInvitationQuery`), which cannot overwrite
 * an answer a concurrent request recorded.
 *
 * A FAILED RESEND IS A FAILED ACTION — the opposite of the create, on purpose.
 * A create protects a durable row, so its email is best-effort and a failure is
 * reported alongside a success. A resend has no artefact to protect: the send is
 * the entire product of the action, so a refusal throws an `InvitationError`
 * whose message the surface renders verbatim.
 *
 * THE SEAMS default to the real thing, exactly as `emailInvitee`'s do, so
 * production has one code path and `resend.test.ts` can drive the guards without
 * a database. `loadInvitation` in particular is the org scope: a test may hand
 * in a row, and nothing else can — this module has no `"use server"` directive,
 * so no browser reaches it, and `service.ts` calls the two-argument form.
 *
 * IT REPORTS ITS DEDUPE WINDOW (RULED 2026-08-10 round 2). The send that just
 * succeeded presented a key the provider will now collapse every duplicate onto
 * until the next bucket opens, so a second press inside that span produces
 * nothing while the surface says "Email sent" — the product claiming a send the
 * provider dropped. The window travels back with the success so the button can
 * refuse for exactly as long as that is true, and it is `resendDedupeWindowAt`
 * of the SAME instant the key was built from: one bucket, two consumers.
 */
export async function resendInvitationEmailAs(
  actor: InvitationActor,
  invitationId: string,
  deps: ResendInvitationDeps = {}
): Promise<{
  invitation: OrganizationInvitation;
  emailSent: boolean;
  dedupeWindow: ResendDedupeWindow;
}> {
  if (!isUuid(invitationId)) {
    throw new InvitationError(INVITATION_NOT_OURS_MESSAGE);
  }

  const loadInvitation = deps.loadInvitation ?? loadOrgInvitation;
  const expire = deps.expire ?? expireInvitation;

  const invitation = await loadInvitation(actor, invitationId);

  if (!invitation) {
    throw new InvitationError(INVITATION_NOT_OURS_MESSAGE);
  }

  const now = deps.now ?? new Date();

  if (
    invitation.status === "pending" &&
    invitation.expiresAt &&
    invitation.expiresAt < now
  ) {
    await expire(invitationId, now);
    throw new InvitationError(INVITATION_EXPIRED_MESSAGE);
  }

  // KEY BY KEY, NEVER `...deps` (swept 2026-08-13, #411). `ResendInvitationDeps`
  // extends `EmailInviteeDeps` with three seams of its own — `loadInvitation`,
  // `expire`, `now` — and a spread forwarded all six into a function that
  // declares three. Nothing was wrong today, because the send path ignores what
  // it does not declare; the trap is the day `EmailInviteeDeps` gains a key this
  // module already uses under the same name (`now` is the obvious one), at which
  // point a seam meant for the expiry guard silently starts steering the send.
  // Same rule, same reason, as `resolveInvitationForResolvedTarget` in `./core`,
  // which #304 ruling 4 fix 1 rebuilt key by key: a spread is not a filter.
  const outcome = await emailInviteeOutcome(invitation, {
    ...(deps.lookupOrgName ? { lookupOrgName: deps.lookupOrgName } : {}),
    ...(deps.send ? { send: deps.send } : {}),
    // A DELIBERATE resend, which is what keeps the provider from deduping it
    // against the key the create already presented for this same invitation
    // (`./email` → `invitationEmailIdempotencyKey`).
    occasion: { kind: "resend", at: now },
  });

  if (!outcome.sent) {
    throw new InvitationError(resendRefusalMessage(outcome.reason));
  }

  // `now` — the instant the occasion above was keyed with, not a second reading
  // of the clock. A fresh `new Date()` here would report a window one bucket
  // later for a send keyed a millisecond before the boundary, and the button
  // would re-enable while the provider was still deduping.
  return {
    invitation,
    emailSent: true,
    dedupeWindow: resendDedupeWindowAt(now),
  };
}
