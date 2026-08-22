// ============================================================================
// THE TWO MESSAGES AN ADDRESS CHANGE SENDS — CS-002 (#616).
//
// The sibling of `@/lib/invitations/seat-email.ts`, and it keeps that module's
// rules verbatim, because they are the rules of this channel:
//
// 1. NEITHER SEND EVER THROWS AND NEITHER FAILS THE WRITE. The row and the
//    column swap are the durable things; the mail is best-effort. A provider
//    outage must not roll back a change that has already committed, nor leave a
//    request row behind that the reader was never told about.
// 2. THEY ARE NOT NOTIFICATIONS. Neither has a category, a preference row or an
//    unsubscribe: one is a credential, the other is a security notice about the
//    account itself, and a recipient who opted out of both would be a recipient
//    who cannot change their address and is never told when somebody else does.
// 3. THE TOKEN IS NEVER LOGGED. It exists only in transit — the database holds
//    its sha256 — so the failure logs below carry the OCCASION and no address
//    and no link, and `redactForLog` strips a thrown error before it is printed.
// 4. THE PROVIDER KEY IS THE ROTATION, NOT A CLOCK BUCKET. Every request mints
//    a fresh token, so two requests are genuinely two messages; keying on a
//    time window would let the provider swallow the second and leave the
//    database holding the digest of a link nobody received — the exact failure
//    `seat-email.ts` documents. The verification key is therefore the token's
//    own digest, and the notice's is the changed-at instant.
//
// WHY THE SEND IS A PARAMETER. `deps.send` is what makes "the old address is
// told, and the message names the change" assertable without a provider: the
// tests drive the real builders and capture the message at this seam.
// ============================================================================

import { formatDateTime } from "@/lib/datetime";
import { EMAIL_REPLY_TO, sendEmail } from "@/lib/email/client";
import { redactForLog } from "@/lib/email/redact";
import { emailChangeNoticeEmail } from "@/lib/email/templates/email-change-notice";
import { emailChangeVerificationEmail } from "@/lib/email/templates/email-change-verification";
import { appBaseUrl } from "@/lib/notifications/channels/email";

import {
  emailChangeVerifyPath,
  hashEmailChangeToken,
} from "./email-change-token";

/** What a transport is handed. The same shape `sendEmail` takes. */
export interface EmailChangeMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string;
  idempotencyKey: string;
}

export interface EmailChangeMailDeps {
  /** The transport. Defaults to the shared Resend client; tests replace it. */
  send?: (
    message: EmailChangeMessage
  ) => Promise<{ success: boolean; error?: string }>;
  /** Absolute base override. Tests pass one; production reads the env. */
  baseUrl?: string;
}

export interface EmailChangeVerificationFacts {
  /** The NEW address — the mailbox being proven. */
  to: string;
  /** The address the account signs in with today. */
  currentEmail: string;
  recipientName: string | null;
  /**
   * The plaintext token. The ONLY place it appears outside the request that
   * minted it: the database holds its hash, so nothing else can rebuild this
   * link.
   */
  token: string;
  expiresAt: Date;
}

export interface EmailChangeNoticeFacts {
  /** The PREVIOUS address — the mailbox losing the account. */
  to: string;
  newEmail: string;
  recipientName: string | null;
  changedAt: Date;
}

/** The absolute, token-bound URL the verification email links to. */
export function emailChangeConfirmUrl(token: string, baseUrl?: string): string {
  return `${baseUrl ?? appBaseUrl()}${emailChangeVerifyPath(token)}`;
}

/**
 * Build the message that goes to the NEW address.
 *
 * Exported so a test can assert the words and the link without a transport.
 */
export async function buildEmailChangeVerification(
  facts: EmailChangeVerificationFacts,
  baseUrl?: string
): Promise<EmailChangeMessage> {
  const { subject, html, text } = await emailChangeVerificationEmail({
    newEmail: facts.to,
    currentEmail: facts.currentEmail,
    recipientName: facts.recipientName?.trim() || null,
    confirmUrl: emailChangeConfirmUrl(facts.token, baseUrl),
    // Formatted HERE, through `@/lib/datetime`, so the instant the reader sees
    // is pinned to `APP_TIME_ZONE` like every other surface with no church
    // behind it (`memory/invariants.md` → Date & Time Rendering). WITH THE
    // TIME, not just the day: a 24-hour window ending "on Friday" is a sentence
    // that is wrong for most of Friday.
    expiresLabel: formatDateTime(facts.expiresAt),
  });

  return {
    to: facts.to,
    subject,
    html,
    text,
    replyTo: EMAIL_REPLY_TO,
    // THE DIGEST, NOT THE TOKEN. An idempotency key travels to a third party
    // and a credential must not — and the digest is already unique per request,
    // which is exactly when the message is.
    idempotencyKey: `email-change-verify-${hashEmailChangeToken(facts.token)}`,
  };
}

/** Build the message that goes to the PREVIOUS address. */
export async function buildEmailChangeNotice(
  facts: EmailChangeNoticeFacts
): Promise<EmailChangeMessage> {
  const { subject, html, text } = await emailChangeNoticeEmail({
    previousEmail: facts.to,
    newEmail: facts.newEmail,
    recipientName: facts.recipientName?.trim() || null,
    changedAtLabel: formatDateTime(facts.changedAt),
  });

  return {
    to: facts.to,
    subject,
    html,
    text,
    replyTo: EMAIL_REPLY_TO,
    idempotencyKey: `email-change-notice-${facts.to}-${facts.changedAt.getTime()}`,
  };
}

/** Send the confirmation link. Never throws — see rule 1 at the top of the file. */
export async function sendEmailChangeVerification(
  facts: EmailChangeVerificationFacts,
  deps: EmailChangeMailDeps = {}
): Promise<boolean> {
  return dispatch(
    "verification",
    () => buildEmailChangeVerification(facts, deps.baseUrl),
    deps
  );
}

/** Send the notice to the old address. Never throws. */
export async function sendEmailChangeNotice(
  facts: EmailChangeNoticeFacts,
  deps: EmailChangeMailDeps = {}
): Promise<boolean> {
  return dispatch("notice", () => buildEmailChangeNotice(facts), deps);
}

/**
 * ONE build-and-send path for both messages, so no branch can start logging an
 * address or a link by accident: the only thing that reaches a log line is
 * which of the two occasions failed.
 */
async function dispatch(
  occasion: "verification" | "notice",
  build: () => Promise<EmailChangeMessage>,
  deps: EmailChangeMailDeps
): Promise<boolean> {
  const send = deps.send ?? sendEmail;

  try {
    const result = await send(await build());
    if (!result.success) {
      console.error("email change mail refused", { occasion });
      return false;
    }
    return true;
  } catch (error) {
    console.error("email change mail transport threw", {
      occasion,
      message: redactForLog(error),
    });
    return false;
  }
}
