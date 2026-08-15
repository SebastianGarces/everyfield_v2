import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import { communicationRecipients } from "@/db/schema/communication";
import type { RecipientStatus } from "@/db/schema/communication";
import { notificationDeliveries } from "@/db/schema/notifications";
import {
  addressSuppressionForEvent,
  notificationDeliveryOutcome,
  WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES,
} from "@/lib/notifications/channels/delivery-events";
import { recordAddressSuppression } from "@/lib/notifications/channels/suppression";
import { RECIPIENT_STATUS_RANK } from "@/lib/communication/queries";

// Initialize Resend client for webhook verification
const resend = new Resend(process.env.RESEND_API_KEY);

interface WebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject?: string;
    /** Present on `email.bounced`. `Permanent` / `Transient`. */
    bounce?: { type?: string | null } | null;
  };
}

/**
 * Update a notification's delivery row from a provider event (F11 / N-016).
 *
 * The provider message id is the only thing correlating a delivery row to a
 * webhook, and it is unique across both consumers — a given id belongs either
 * to a communication recipient or to a notification delivery, never both — so
 * this runs unconditionally and simply matches nothing when the id is not ours.
 *
 * WHY THIS EXISTS: without it a hard bounce is invisible. The dispatcher only
 * learns whether the provider ACCEPTED the message, so a delivery to a dead
 * address stays `sent` forever, "why did this never arrive?" has no answer, and
 * the next dispatch mails the same dead address again. What an event MEANS is
 * decided by `notificationDeliveryOutcome`, which is pure and tested; this
 * function owns only the write.
 *
 * The `status IN (queued, sent)` guard is load-bearing — see
 * `WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES` for why `failed`, `cancelled` and
 * `suppressed_by_preference` are excluded.
 */
async function applyNotificationDeliveryEvent(
  event: WebhookEvent,
  emailId: string
): Promise<void> {
  const outcome = notificationDeliveryOutcome({
    type: event.type,
    bounceType: event.data.bounce?.type ?? null,
  });
  if (outcome.kind === "ignored") return;

  await db
    .update(notificationDeliveries)
    .set({
      status: "failed",
      // Already carries `PERMANENT_FAILURE_PREFIX` when permanent, which is
      // what stops `channelEligibility` retrying a hard bounce (N-015).
      error: outcome.error,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationDeliveries.providerMessageId, emailId),
        inArray(notificationDeliveries.status, [
          ...WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES,
        ])
      )
    );
}

/**
 * Suppress the ADDRESS a permanent failure names (#324, from #262).
 *
 * SEPARATE FROM THE DELIVERY UPDATE ABOVE, and deliberately not conditional on
 * it. The update stops one attempt being retried; this stops every future send
 * to the mailbox, whether the bounced message was a notification, a
 * communication or an invitation. Running it only when a notification delivery
 * matched would leave the address mailable for the other three.
 *
 * WHAT SUPPRESSES IS DECIDED BY `addressSuppressionForEvent`, which is pure,
 * tested and derived from the same mapping as the delivery outcome — so a soft
 * bounce cannot suppress here while staying retryable there.
 *
 * ONE ROW PER RECIPIENT. `data.to` is an array because a provider message can
 * carry several; every one of them bounced, so every one is suppressed. Failures
 * are logged and swallowed: a suppression write must never turn into a non-200
 * that makes Resend redeliver the whole event.
 */
async function applyAddressSuppression(event: WebhookEvent): Promise<void> {
  const decision = addressSuppressionForEvent({
    type: event.type,
    bounceType: event.data.bounce?.type ?? null,
  });
  if (!decision.suppress) return;

  const recipients = Array.isArray(event.data.to) ? event.data.to : [];

  for (const address of recipients) {
    if (typeof address !== "string" || !address.trim()) continue;
    try {
      await recordAddressSuppression({
        email: address,
        reason: decision.reason,
        source: event.type,
        detail: event.data.bounce?.type
          ? `provider bounce type: ${event.data.bounce.type}`
          : null,
      });
    } catch (err) {
      console.error(
        `[WEBHOOK] could not record suppression for a ${decision.reason}:`,
        err
      );
    }
  }
}

/**
 * Resend webhook handler for email delivery tracking.
 * Updates communication_recipients and notification_deliveries status based on
 * email events. Verifies webhook signatures to prevent spoofed events.
 */
export async function POST(req: NextRequest) {
  try {
    // Use raw body for signature verification
    const payload = await req.text();

    // Verify webhook signature (CRITICAL: prevents fake events)
    let event: WebhookEvent;
    try {
      event = resend.webhooks.verify({
        payload,
        headers: {
          id: req.headers.get("svix-id") ?? "",
          timestamp: req.headers.get("svix-timestamp") ?? "",
          signature: req.headers.get("svix-signature") ?? "",
        },
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
      }) as WebhookEvent;
    } catch {
      console.error("[WEBHOOK] Signature verification failed");
      return new NextResponse("Invalid signature", { status: 400 });
    }

    const emailId = event.data.email_id;
    if (!emailId) {
      return new NextResponse("OK", { status: 200 });
    }

    // F11 notification deliveries. Runs first and independently of the
    // communication path below, which returns early on an unknown id.
    await applyNotificationDeliveryEvent(event, emailId);

    // #324. Address-level, so it runs for EVERY permanent failure — not only
    // the ones whose message id matched a notification delivery above.
    await applyAddressSuppression(event);

    // Find the recipient record by external ID (Resend email ID)
    const [recipient] = await db
      .select()
      .from(communicationRecipients)
      .where(eq(communicationRecipients.externalId, emailId))
      .limit(1);

    if (!recipient) {
      // Unknown email ID — could be a non-communication email sent via Resend
      return new NextResponse("OK", { status: 200 });
    }

    // Map Resend event types to our recipient status
    let newStatus: RecipientStatus | null = null;
    const updates: Partial<typeof communicationRecipients.$inferInsert> = {};

    switch (event.type) {
      case "email.sent":
        newStatus = "sent";
        break;
      case "email.delivered":
        newStatus = "delivered";
        updates.deliveredAt = new Date();
        break;
      case "email.opened":
        newStatus = "opened";
        updates.openedAt = new Date();
        break;
      case "email.clicked":
        newStatus = "clicked";
        updates.clickedAt = new Date();
        break;
      case "email.bounced":
        newStatus = "bounced";
        updates.errorMessage = "Email bounced (hard bounce)";
        break;
      case "email.complained":
        newStatus = "bounced";
        updates.errorMessage = "Recipient marked email as spam";
        break;
      case "email.failed":
        newStatus = "failed";
        updates.errorMessage = "Email delivery failed";
        break;
      default:
        // Ignore other event types (delivery_delayed, domain events, etc.)
        return new NextResponse("OK", { status: 200 });
    }

    if (newStatus) {
      // Only advance status forward (prevent regression from async events).
      // Bounced/failed always take effect — the short-circuit, not the rank,
      // is what decides between the two terminal statuses.
      const isBounceOrFail = newStatus === "bounced" || newStatus === "failed";

      if (
        isBounceOrFail ||
        RECIPIENT_STATUS_RANK[newStatus] >
          RECIPIENT_STATUS_RANK[recipient.status]
      ) {
        await db
          .update(communicationRecipients)
          .set({ status: newStatus, ...updates })
          .where(eq(communicationRecipients.id, recipient.id));
      }
    }

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("[WEBHOOK] Error processing Resend webhook:", err);
    // Return 200 to prevent Resend from retrying (we log the error)
    return new NextResponse("OK", { status: 200 });
  }
}
