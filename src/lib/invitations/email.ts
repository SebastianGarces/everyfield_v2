// ============================================================================
// Sending the invitation — OV-003b (#293).
//
// `createInvitationAs` used to write the row and stop, leaving the admin to
// copy a link out of the screen and paste it into their own mail client. This
// module is the missing half: it turns a freshly created invitation into one
// transactional email carrying the token-bound register URL.
//
// FOUR RULES, all of which have a test in `./email.test.ts`.
//
// 1. IT NEVER THROWS AND IT NEVER FAILS THE CREATE. The invitation row is the
//    durable thing; the email is best-effort delivery of a link the admin can
//    also copy. So every failure — a refused provider, a thrown transport, a
//    row whose FKs make no sense — comes back as `{ sent: false }` and the
//    caller reports "created, but not emailed" with the link as the fallback.
//    An email failure that rolled back an invitation would be strictly worse:
//    the admin would retry and hit the duplicate-pending refusal.
//
// 2. ONLY A PENDING INVITATION IS EMAILED. The status guard is HERE, not at the
//    call site, so "a revoked invitation sends nothing further" holds for every
//    caller that ever appears — including a retry written later. Re-inviting
//    after a revoke goes through `createInvitationAs` again, which inserts a NEW
//    row with a NEW id, so the fresh email necessarily carries the fresh token:
//    there is no code path that can re-send a dead one, because the URL is a
//    function of the id it is handed.
//
// 3. IT IS NOT A NOTIFICATION. The invitee has no account, so there is no
//    preference row to consult, no category, and nothing to unsubscribe from —
//    `enqueue`, `NOTIFICATION_CATEGORIES` and the dispatcher are all off this
//    path, and the message carries no `List-Unsubscribe` header (CAN-SPAM asks
//    for one on commercial mail, not on a message the recipient's counterparty
//    addressed to them personally). `appBaseUrl` is imported from the
//    notification channel because it is the repo's ONE definition of "the
//    absolute base a link in an inbox needs"; nothing else crosses over.
//
// 4. THE TOKEN IS NEVER LOGGED. The invitation id IS the credential — it is the
//    register bearer token and the beta-gate bypass — so it does not go to
//    `console`, and neither does the URL built from it. The failure logs below
//    carry the invitation TYPE and a reason code, which is enough to debug a
//    misconfigured sender and useless to anyone reading a log drain.
// ============================================================================

import type {
  OrganizationInvitationStatus,
  OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import { EMAIL_REPLY_TO, sendEmail } from "@/lib/email/client";
import { redactForLog } from "@/lib/email/redact";
import {
  organizationInvitationEmail,
  type InviteeOrgKind,
  type InvitingOrgKind,
} from "@/lib/email/templates/organization-invitation";
import { formatDate } from "@/lib/datetime";
// The base URL an emailed link needs, and the only definition of it that this
// repo has agreed on. Importing it is not "going through the notifications
// machinery" — nothing about categories, preferences, enqueueing or dispatch is
// reachable from here (see rule 3 above).
import { appBaseUrl } from "@/lib/notifications/channels/email";

// ----------------------------------------------------------------------------
// The link
// ----------------------------------------------------------------------------

/**
 * The register route an invitation link points at. One spelling, shared by the
 * email and by anything else that has to build the same URL, so the query key
 * cannot drift from the one `register/page.tsx` reads.
 */
export const INVITATION_REGISTER_PATH = "/register";

/** `/register?invitation=<id>` — the path half, for a surface that already knows its own origin. */
export function invitationRegisterPath(invitationId: string): string {
  return `${INVITATION_REGISTER_PATH}?invitation=${encodeURIComponent(invitationId)}`;
}

/**
 * The absolute, token-bound register URL — what the email actually links to.
 *
 * Absolute because a relative href is meaningless in an inbox, and the token is
 * in the query rather than the path because that is the shape
 * `describeInvitationForRegistration` and `hasValidInvitationBypass` already
 * read.
 */
export function invitationRegisterUrl(
  invitationId: string,
  baseUrl?: string
): string {
  return `${baseUrl ?? appBaseUrl()}${invitationRegisterPath(invitationId)}`;
}

// ----------------------------------------------------------------------------
// What has to be true before an invitation can be emailed
// ----------------------------------------------------------------------------

/**
 * Everything the email needs, already read from the database by the caller.
 *
 * Deliberately a plain record and not a row: this module performs no queries,
 * which is what lets the whole send path — copy, guards, payload — be exercised
 * without one. `core.ts` owns the lookups because it owns the connection.
 */
export interface InvitationEmailFacts {
  invitationId: string;
  inviteeEmail: string | null;
  status: OrganizationInvitationStatus;
  type: OrganizationInvitationType;
  /** The inviting organization's display name, resolved from `type`, never from a stray FK. */
  invitingOrgName: string | null;
  expiresAt: Date | null;
}

/** Why nothing was sent. A reason code, never a token, ever. */
export type InvitationEmailRefusal =
  | "not_pending"
  | "no_address"
  | "no_inviting_org"
  | "unknown_type"
  | "provider_refused"
  | "transport_threw";

export type InvitationEmailOutcome =
  | { sent: true }
  | { sent: false; reason: InvitationEmailRefusal };

/** The payload handed to the transport. Shaped like `sendEmail`'s argument on purpose. */
export interface InvitationEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string;
  /**
   * Provider-side dedupe, keyed on the INVITATION and not on the address.
   *
   * A retried create cannot put two copies of one invitation in an inbox, and —
   * the half that matters for the revoke rule — a re-invitation after a revoke
   * is a different row with a different id, so it presents a different key and
   * is delivered rather than swallowed as a duplicate. Keying on
   * `to + subject` would have deduped exactly the case the AC names, since the
   * subject is the same org name both times.
   */
  idempotencyKey: string;
}

export interface InvitationEmailDeps {
  /** The transport. Defaults to the shared Resend client; tests replace it. */
  send?: (
    message: InvitationEmailMessage
  ) => Promise<{ success: boolean; error?: string }>;
  /** Absolute base override. Tests pass one; production reads the env. */
  baseUrl?: string;
}

/**
 * Who is inviting, and what the invitee ends up with — derived from `type` and
 * from nothing else.
 *
 * Same rule as `announceInvitationAcceptedForChurch` and
 * `lookupInvitingOrgName`, for the same reason: `insertInvitation` performs no
 * type↔id consistency check and the column is a bare `varchar(40)`, so reading
 * "who invited you" off whichever FK happens to be set can name an organization
 * that never invited anybody. An unrecognised type resolves to `null` and
 * nothing is sent — an email that misnames the sender is worse than no email,
 * because the invitee's only defence against a phishing lookalike is that the
 * name matches the person who told them to expect it.
 */
export function invitationOrgKinds(
  type: OrganizationInvitationType
): { inviting: InvitingOrgKind; invitee: InviteeOrgKind } | null {
  switch (type) {
    case "church_to_sending_church":
      return { inviting: "sending church", invitee: "church plant" };
    case "church_to_network":
      return { inviting: "network", invitee: "church plant" };
    case "sending_church_to_network":
      return { inviting: "network", invitee: "sending church" };
    default:
      return null;
  }
}

/**
 * Render the message, or say why it cannot be rendered. Pure apart from the
 * template render, so the copy and the link are assertable without a provider.
 */
export async function buildInvitationEmail(
  facts: InvitationEmailFacts,
  baseUrl?: string
): Promise<
  | { ok: true; message: InvitationEmailMessage }
  | { ok: false; reason: InvitationEmailRefusal }
> {
  if (facts.status !== "pending") return { ok: false, reason: "not_pending" };

  const to = (facts.inviteeEmail ?? "").trim();
  if (to.length === 0) return { ok: false, reason: "no_address" };

  const invitingOrgName = (facts.invitingOrgName ?? "").trim();
  if (invitingOrgName.length === 0) {
    return { ok: false, reason: "no_inviting_org" };
  }

  const kinds = invitationOrgKinds(facts.type);
  if (!kinds) return { ok: false, reason: "unknown_type" };

  const { subject, html, text } = await organizationInvitationEmail({
    invitingOrgName,
    invitingOrgKind: kinds.inviting,
    inviteeOrgKind: kinds.invitee,
    inviteeEmail: to,
    inviteUrl: invitationRegisterUrl(facts.invitationId, baseUrl),
    // Formatted HERE, through `@/lib/datetime`, so the date the invitee reads is
    // the one every surface shows (memory/invariants.md → Date & Time
    // Rendering — an unpinned formatter states the sending process's calendar
    // day, which for a late-UTC expiry is the wrong one).
    expiresLabel: facts.expiresAt ? formatDate(facts.expiresAt) : null,
  });

  return {
    ok: true,
    message: {
      to,
      subject,
      html,
      text,
      replyTo: EMAIL_REPLY_TO,
      idempotencyKey: `org-invitation-${facts.invitationId}`,
    },
  };
}

/**
 * Send it. Never throws, whatever happens — see rule 1 at the top of the file.
 */
export async function sendInvitationEmail(
  facts: InvitationEmailFacts,
  deps: InvitationEmailDeps = {}
): Promise<InvitationEmailOutcome> {
  const send = deps.send ?? defaultTransport;

  try {
    const built = await buildInvitationEmail(facts, deps.baseUrl);
    if (!built.ok) return refused(facts, built.reason);

    const result = await send(built.message);
    if (!result.success) return refused(facts, "provider_refused");

    return { sent: true };
  } catch (error) {
    // The error object itself may quote the payload, and the payload holds the
    // URL — so only its message is logged, and only after `redactForLog` has
    // stripped URLs and ids out of it. The message is provider-authored text
    // and can embed the request just as the object can (`@/lib/email/redact`).
    // Never the facts.
    console.error("invitation email transport threw", {
      type: facts.type,
      message: redactForLog(error),
    });
    return { sent: false, reason: "transport_threw" };
  }
}

/** One refusal path, so no branch can start logging the id by accident. */
function refused(
  facts: InvitationEmailFacts,
  reason: InvitationEmailRefusal
): InvitationEmailOutcome {
  // `not_pending` is not a failure — it is the revoke rule doing its job — so it
  // is not noise in the log either.
  if (reason !== "not_pending") {
    console.error("invitation email not sent", { type: facts.type, reason });
  }
  return { sent: false, reason };
}

/** The real transport. Separated so `sendInvitationEmail`'s default is one name. */
async function defaultTransport(
  message: InvitationEmailMessage
): Promise<{ success: boolean; error?: string }> {
  return sendEmail({
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    replyTo: message.replyTo,
    idempotencyKey: message.idempotencyKey,
  });
}
