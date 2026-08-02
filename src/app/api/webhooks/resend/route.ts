import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import { communicationRecipients } from "@/db/schema/communication";
import type { RecipientStatus } from "@/db/schema/communication";
import { notificationDeliveries } from "@/db/schema/notifications";
import {
  notificationDeliveryOutcome,
  WEBHOOK_OVERWRITABLE_DELIVERY_STATUSES,
} from "@/lib/notifications/channels/delivery-events";

// Initialize Resend client for webhook verification
const resend = new Resend(process.env.RESEND_API_KEY);

// Status progression order (we only advance forward, never backward)
const statusOrder: RecipientStatus[] = [
  "pending",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "failed",
];

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
      // Only advance status forward (prevent regression from async events)
      const currentIdx = statusOrder.indexOf(
        recipient.status as RecipientStatus
      );
      const newIdx = statusOrder.indexOf(newStatus);

      // Special handling: bounced/failed always take effect
      const isBounceOrFail = newStatus === "bounced" || newStatus === "failed";

      if (isBounceOrFail || newIdx > currentIdx) {
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
