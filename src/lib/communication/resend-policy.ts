// ============================================================================
// Resend Policy (COM-018)
// ============================================================================
//
// When a message may be resent to the people who never opened it.
//
// Ruled 2026-08-09 on PR #371. Without a gate, a resend's own detail page
// re-offers a resend to the very people it just contacted: the new recipient
// rows are all `pending`, none records an open, so seconds later the button
// invites the same send again. Two conditions now have to hold together:
//
//  1. at least 24 hours have passed since the message was sent — an open takes
//     time, and a resend inside that window is measuring nothing;
//  2. at least one recipient row is confirmed as delivered — until the
//     provider has confirmed anything, "nobody opened it" is not evidence that
//     anybody was reached.
//
// Kept pure and free of the db client so the same decision drives the server
// action (which enforces it) and the button (which explains it), and so the
// clock can be injected in tests instead of slept through.
// ============================================================================

/** Hours that must pass after a send before a resend is offered. */
export const RESEND_COOLDOWN_HOURS = 24;

const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_HOURS * 60 * 60 * 1000;

/**
 * Why a resend is not on offer. `null` means it is.
 *
 * The order matters: `notSent` outranks everything (a draft has no send to
 * measure from), then the cooldown, then delivery confirmation, and only then
 * "there is nobody left" — which is the one that is good news rather than a
 * blocked action, and the one the UI states as a sentence rather than a
 * disabled button.
 */
export type ResendBlockReason =
  | "notSent"
  | "tooSoon"
  | "noDeliveryYet"
  | "noNonOpeners";

export interface ResendEligibilityInput {
  /** The communication's send status. */
  status: string;
  /** When it was sent, if it ever was. */
  sentAt: Date | null;
  /** Recipient rows the provider has confirmed as delivered. */
  deliveredCount: number;
  /** People a resend would actually reach. */
  nonOpenerCount: number;
  /** Injected clock — the caller decides "now" so tests can pin it. */
  now?: Date;
}

export interface ResendEligibility {
  allowed: boolean;
  reason: ResendBlockReason | null;
}

/**
 * Short line shown under a disabled resend button. Says when the control
 * becomes available, not merely that it is unavailable.
 */
export function resendBlockedHint(reason: ResendBlockReason): string {
  switch (reason) {
    case "tooSoon":
      return `Available ${RESEND_COOLDOWN_HOURS} hours after send`;
    case "noDeliveryYet":
      return "Waiting for delivery confirmation";
    case "noNonOpeners":
      return "Everyone has opened this message";
    case "notSent":
      return "Available once this message is sent";
  }
}

/**
 * The same refusal in the server action's voice — a full sentence, because it
 * arrives as a toast with no button beside it to give it context.
 */
export function resendBlockedMessage(reason: ResendBlockReason): string {
  switch (reason) {
    case "tooSoon":
      return `You can resend ${RESEND_COOLDOWN_HOURS} hours after the message was sent.`;
    case "noDeliveryYet":
      return "No recipient is confirmed as delivered yet, so there is nothing to resend.";
    case "noNonOpeners":
      return "Everyone who received this message has already opened it.";
    case "notSent":
      return "Only a sent message can be resent.";
  }
}

/**
 * Decide whether this message may be resent right now.
 *
 * A `sent` message with no `sentAt` is treated as too soon rather than as
 * eligible: the cooldown cannot be proven to have elapsed, and the safe answer
 * to "when was this sent?" being unknown is to wait.
 */
export function evaluateResendEligibility({
  status,
  sentAt,
  deliveredCount,
  nonOpenerCount,
  now = new Date(),
}: ResendEligibilityInput): ResendEligibility {
  if (status !== "sent") return { allowed: false, reason: "notSent" };

  if (!sentAt || now.getTime() - sentAt.getTime() < RESEND_COOLDOWN_MS) {
    return { allowed: false, reason: "tooSoon" };
  }

  if (deliveredCount <= 0) {
    return { allowed: false, reason: "noDeliveryYet" };
  }

  if (nonOpenerCount <= 0) {
    return { allowed: false, reason: "noNonOpeners" };
  }

  return { allowed: true, reason: null };
}
