import type { EmailSuppressionReason } from "@/db/schema/notifications";

import { PERMANENT_FAILURE_PREFIX } from "../dispatch";

// ============================================================================
// Provider delivery webhooks → `notification_deliveries` (N-016).
//
// The dispatcher only ever learns whether the provider ACCEPTED a message. What
// happened afterwards — the receiving server rejected the address, the mailbox
// is full, the reader pressed "spam" — arrives minutes later on the webhook,
// and without this mapping a hard bounce is invisible: the delivery row says
// `sent` forever and the next dispatch cheerfully mails the same dead address
// again.
//
// The mapping is a PURE function so the whole policy is assertable without a
// signed request or a database. The route (`/api/webhooks/resend`) owns
// signature verification and the UPDATE; this owns what an event MEANS.
//
// Two decisions worth stating.
//
// 1. PERMANENCE IS THE PROVIDER'S FACT, not a count we infer. A hard bounce and
//    a spam complaint are permanent — no number of retries produces a valid
//    mailbox or an un-offended reader — and are recorded with
//    `PERMANENT_FAILURE_PREFIX`, which is what `channelEligibility` reads to
//    refuse a retry. A SOFT bounce (Resend calls it `Transient`) and a generic
//    `email.failed` are not permanent: they keep their bounded retries.
//
// 2. SUCCESS EVENTS CHANGE NOTHING. `email.delivered` / `opened` / `clicked`
//    are engagement telemetry, and `notification_deliveries` is a record of
//    ATTEMPTS, not of reading habits. Widening `status` to carry them would put
//    the dispatcher's at-most-once state machine at the mercy of an
//    out-of-order webhook.
// ============================================================================

/** The bits of a provider event this mapping reads. */
export interface ProviderDeliveryEvent {
  /** Provider event name, e.g. `email.bounced`. */
  type: string;
  /** Resend's `data.bounce.type` — `Permanent` / `Transient` / undefined. */
  bounceType?: string | null;
}

export type DeliveryEventOutcome =
  | {
      kind: "failed";
      /** Ready to store: already prefixed when permanent. */
      error: string;
      permanent: boolean;
    }
  /** Nothing about this event changes an attempt's record. */
  | { kind: "ignored" };

/** Resend spells a soft bounce `Transient`; be liberal about what we accept. */
function isSoftBounce(bounceType: string | null | undefined): boolean {
  if (!bounceType) return false;
  const normalised = bounceType.toLowerCase();
  return (
    normalised.includes("transient") ||
    normalised.includes("soft") ||
    normalised.includes("undetermined")
  );
}

/**
 * What one provider event means for a notification's delivery row.
 *
 * An UNRECOGNISED event type is ignored rather than treated as a failure: the
 * provider adds event types over time (`email.delivery_delayed`, domain and
 * contact events), and a mapping that failed closed on anything new would mark
 * healthy deliveries failed on the next provider release.
 */
export function notificationDeliveryOutcome(
  event: ProviderDeliveryEvent
): DeliveryEventOutcome {
  switch (event.type) {
    case "email.bounced": {
      if (isSoftBounce(event.bounceType)) {
        return {
          kind: "failed",
          error: "soft bounce reported by the email provider",
          permanent: false,
        };
      }
      return {
        kind: "failed",
        error: `${PERMANENT_FAILURE_PREFIX}hard bounce reported by the email provider`,
        permanent: true,
      };
    }

    case "email.complained":
      // A spam complaint is a withdrawal of consent as much as a delivery
      // failure. Retrying it is the single fastest way to lose a sending
      // domain, so it is permanent regardless of what the provider says next.
      return {
        kind: "failed",
        error: `${PERMANENT_FAILURE_PREFIX}recipient marked the email as spam`,
        permanent: true,
      };

    case "email.failed":
      // The provider could not hand it off. That is usually transient, and
      // `isPermanentEmailError` already caught the permanent variants at send
      // time, so this keeps its bounded retries.
      return {
        kind: "failed",
        error: "delivery failed at the email provider",
        permanent: false,
      };

    default:
      return { kind: "ignored" };
  }
}

// ============================================================================
// Address-level suppression (#324) — the POLICY half.
//
// `notificationDeliveryOutcome` above says what an event means for ONE attempt.
// This says what it means for the ADDRESS, which is a different lifetime: the
// delivery row stops one retry, the suppression stops every future send. The
// two are DERIVED FROM THE SAME FUNCTION rather than written twice, so a
// bounce type that is permanent for one and transient for the other is
// unrepresentable.
//
// The store that acts on this lives in `./suppression.ts`; this stays pure, so
// the whole policy is assertable without a signed request or a database.
// ============================================================================

export type AddressSuppressionOutcome =
  | { suppress: true; reason: EmailSuppressionReason }
  /** Not permanent, or not a failure at all. The address stays mailable. */
  | { suppress: false };

/**
 * Should this provider event stop us mailing the address altogether?
 *
 * ONLY when the SAME mapping already called the failure permanent. A soft
 * bounce (`Transient`) keeps its bounded retries and suppresses NOTHING: a full
 * mailbox empties and a greylisting expires, and suppressing on one would
 * silently un-reach a live cohort member — the expensive direction of this
 * trade, because nothing tells us we stopped mailing somebody who wanted the
 * mail. A generic `email.failed` is the same: the provider could not hand it
 * off, which is usually about us and never about the mailbox.
 */
export function addressSuppressionForEvent(
  event: ProviderDeliveryEvent
): AddressSuppressionOutcome {
  const outcome = notificationDeliveryOutcome(event);
  if (outcome.kind !== "failed" || !outcome.permanent)
    return { suppress: false };

  // The reason is the EVENT's, not the outcome's: both are permanent, but a
  // dead mailbox and an offended reader are cleared by different people, and a
  // suppression that cannot say which is one an admin cannot rule on.
  return {
    suppress: true,
    reason:
      event.type === "email.complained" ? "spam_complaint" : "hard_bounce",
  };
}

/**
 * Delivery statuses a webhook may overwrite.
 *
 * `sent` is the normal case. `queued` covers a run that crashed between the
 * claim and the settle — the webhook is then the only evidence of what
 * happened, and it is better evidence than the row's silence.
 *
 * `failed`, `cancelled` and `suppressed_by_preference` are NOT here.
 * `cancelled` and `suppressed_by_preference` describe a message that was never
 * sent, so a bounce cannot be about them; and re-writing an already-`failed`
 * row would reset its `updated_at` and, with it, the backoff clock
 * (`channelEligibility`), so a chatty provider could hold a retry off forever.
 */
export const WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES = [
  "queued",
  "sent",
] as const;
