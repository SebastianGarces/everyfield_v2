// ============================================================================
// Sending a SEAT invitation — AS-010 (#495).
//
// The sibling of `./email.ts`, and it keeps that module's four rules verbatim
// because they are the rules of this channel and not of that table:
//
// 1. IT NEVER THROWS AND IT NEVER FAILS THE CREATE. The row is the durable
//    thing; the email is best-effort. Every failure comes back as
//    `{ sent: false, reason }` and the surface reports it with the SAME words
//    the org path uses (`resendRefusalMessage`, `./resend`).
// 2. ONLY A PENDING INVITATION IS EMAILED, and the guard is HERE rather than at
//    the call site, so it holds for the resend as well as the create.
// 3. IT IS NOT A NOTIFICATION. The invitee has no account, so there is no
//    preference row, no category and nothing to unsubscribe from.
// 4. THE TOKEN IS NEVER LOGGED, and here that is stronger than on the org path:
//    the org token is the row's id, so a log that named the id named the
//    credential. This token is a random string that exists only in transit — the
//    database stores its sha256 — so the failure logs below can safely carry the
//    invitation ID and still carry nothing anybody can spend.
//
// WHY IT IS A SECOND MODULE AND NOT A BRANCH IN `./email.ts`. That module's
// whole vocabulary is org-shaped: `InvitationEmailFacts` carries an
// `OrganizationInvitationType`, and every refusal it can produce
// (`unknown_type`, `no_inviting_org`) is about resolving WHICH ORG invited. A
// seat invitation has no type to resolve and no org to name — it names a plant
// — so a shared function would have been two disjoint bodies behind one
// signature. What IS shared is everything that would otherwise drift: the
// refusal codes, the words for them, the register-path spelling and the dedupe
// bucket, all imported rather than restated.
// ============================================================================

import type { UserInvitationStatus } from "@/db/schema/user-invitation";
import { formatDate } from "@/lib/datetime";
import { EMAIL_REPLY_TO, sendEmail } from "@/lib/email/client";
import { redactForLog } from "@/lib/email/redact";
import { seatInvitationEmail } from "@/lib/email/templates/seat-invitation";
import { appBaseUrl } from "@/lib/notifications/channels/email";
import type { InvitedAs } from "./seat-copy";

import type {
  InvitationEmailMessage,
  InvitationEmailOutcome,
  InvitationEmailRefusal,
} from "./email";
// The `?invitation=` contract, from the import-free leaf that owns it — never
// hand-built, and never re-exported from here (see `./register-path`).
import { coachInvitationPath, invitationRegisterPath } from "./register-path";

/**
 * WHICH SEND THIS IS — and a seat RESEND is identified by its ROTATION, never
 * by a clock bucket (#495, review round 1).
 *
 * THE ORG PATH'S SUFFIX IS THE WINDOW INDEX, AND COPYING IT HERE BRICKED THE
 * INVITATION. That key is safe next door because the credential is the row's
 * own uuid and never changes, so two resends inside one 60-second bucket are
 * genuinely the same message and collapsing them loses nothing. Here every
 * resend MINTS A NEW TOKEN. Two resends in one bucket — a reload, a second
 * Admin, the cooldown being per client session by ruling — presented one key
 * twice: the provider returned the cached response for the first, `sent: true`
 * came back, no second message left, and the database was left holding the
 * digest of a link that had never been delivered. The invitee's only live link
 * was dead, `/register` says nothing about an unknown token by Ruling C, and
 * they would have registered as a cold planter with no plant — an address that
 * AS-010 then refuses to re-invite.
 *
 * So the suffix is the rotation, which makes the key unique exactly when the
 * message is. `resendDedupeWindowAt` still owns the CLIENT cooldown; it is no
 * longer load-bearing for delivery, and this module no longer imports it.
 *
 * ACCEPTED RESIDUAL: two Admins pressing Resend seconds apart now send two
 * emails rather than one. That is the honest outcome — two credentials were
 * minted and only the newest works — and the message already tells the reader
 * to use the most recent email.
 */
export type SeatInvitationSendOccasion =
  | { kind: "create" }
  | { kind: "resend"; rotationId: string };

/**
 * Everything the message needs, already read by the caller. A plain record and
 * not a row, so the whole send path is exercisable without a database.
 *
 * `token` is the ONLY place the plaintext token appears outside the create that
 * minted it: the database holds its hash, so nothing else can reconstruct this
 * link.
 */
export interface SeatInvitationEmailFacts {
  invitationId: string;
  token: string;
  inviteeEmail: string;
  status: UserInvitationStatus;
  churchName: string | null;
  inviterName: string | null;
  /**
   * What the invitation makes them — the union, not a seat, so a coach cannot
   * be described with a seat's words (#496). It also decides where the link
   * points; see `invitationLandingUrl`.
   */
  invitedAs: InvitedAs;
  expiresAt: Date | null;
}

export interface SeatInvitationEmailDeps {
  /** The transport. Defaults to the shared Resend client; tests replace it. */
  send?: (
    message: InvitationEmailMessage
  ) => Promise<{ success: boolean; error?: string }>;
  /** Absolute base override. Tests pass one; production reads the env. */
  baseUrl?: string;
  /** Which send this is. Defaults to the automatic one at create time. */
  occasion?: SeatInvitationSendOccasion;
}

/**
 * The provider-side dedupe key — invitation-scoped, exactly as the org one is,
 * and with the same resend suffix so a deliberate resend is not collapsed onto
 * the create's message.
 *
 * The key is built from the invitation ID and never from the token: an
 * idempotency key travels to a third party, and a credential must not.
 */
export function seatInvitationEmailIdempotencyKey(
  invitationId: string,
  occasion: SeatInvitationSendOccasion = { kind: "create" }
): string {
  const base = `seat-invitation-${invitationId}`;
  if (occasion.kind === "create") return base;
  return `${base}-resend-${occasion.rotationId}`;
}

/**
 * The absolute, token-bound URL the email links to — and THE ONE PLACE the two
 * kinds part company (#496).
 *
 * A seat invitation is register-only, so it goes to the sign-up form. A coach
 * invitation may be answered by an account that already exists, and the sender
 * must not learn whether this one does, so it goes to a page that asks the
 * reader instead of a form that assumes them. See `./register-path` for why the
 * fork is on the KIND and never on the invitee.
 */
export function seatInvitationRegisterUrl(
  invitedAs: InvitedAs,
  token: string,
  baseUrl?: string
): string {
  const path =
    invitedAs.kind === "coach"
      ? coachInvitationPath(token)
      : invitationRegisterPath(token);
  return `${baseUrl ?? appBaseUrl()}${path}`;
}

/** Render the message, or say why it cannot be rendered. */
export async function buildSeatInvitationEmail(
  facts: SeatInvitationEmailFacts,
  baseUrl?: string,
  occasion?: SeatInvitationSendOccasion
): Promise<
  | { ok: true; message: InvitationEmailMessage }
  | { ok: false; reason: InvitationEmailRefusal }
> {
  if (facts.status !== "pending") return { ok: false, reason: "not_pending" };

  const to = facts.inviteeEmail.trim();
  if (to.length === 0) return { ok: false, reason: "no_address" };

  const churchName = (facts.churchName ?? "").trim();
  if (churchName.length === 0) {
    // The same refusal the org path gives a row whose inviting org will not
    // resolve, and for the same reason: an email that misnames who invited you
    // is indistinguishable from a phishing attempt, so nothing is sent.
    return { ok: false, reason: "no_inviting_org" };
  }

  const { subject, html, text } = await seatInvitationEmail({
    churchName,
    inviterName: facts.inviterName?.trim() || null,
    invitedAs: facts.invitedAs,
    inviteeEmail: to,
    inviteUrl: seatInvitationRegisterUrl(facts.invitedAs, facts.token, baseUrl),
    // Formatted HERE, through `@/lib/datetime`, so the date the invitee reads is
    // the one every surface shows (`memory/invariants.md` → Date & Time
    // Rendering).
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
      idempotencyKey: seatInvitationEmailIdempotencyKey(
        facts.invitationId,
        occasion
      ),
    },
  };
}

/** Send it. Never throws, whatever happens — see rule 1 at the top of the file. */
export async function sendSeatInvitationEmail(
  facts: SeatInvitationEmailFacts,
  deps: SeatInvitationEmailDeps = {}
): Promise<InvitationEmailOutcome> {
  const send = deps.send ?? defaultTransport;

  try {
    const built = await buildSeatInvitationEmail(
      facts,
      deps.baseUrl,
      deps.occasion
    );
    if (!built.ok) return refused(facts, built.reason);

    const result = await send(built.message);
    if (!result.success) return refused(facts, "provider_refused");

    return { sent: true };
  } catch (error) {
    // Only the message, and only after `redactForLog` has stripped URLs and ids
    // out of it: the error object may quote the payload, and the payload holds
    // the token-bearing URL.
    console.error("seat invitation email transport threw", {
      invitationId: facts.invitationId,
      message: redactForLog(error),
    });
    return { sent: false, reason: "transport_threw" };
  }
}

/** One refusal path, so no branch can start logging the token by accident. */
function refused(
  facts: SeatInvitationEmailFacts,
  reason: InvitationEmailRefusal
): InvitationEmailOutcome {
  console.error("seat invitation email not sent", {
    invitationId: facts.invitationId,
    reason,
  });
  return { sent: false, reason };
}

async function defaultTransport(
  message: InvitationEmailMessage
): Promise<{ success: boolean; error?: string }> {
  return sendEmail(message);
}
