import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import { communicationRecipients } from "@/db/schema/communication";
import type { RecipientStatus } from "@/db/schema/communication";

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
  };
}

/**
 * Resend webhook handler for email delivery tracking.
 * Updates communication_recipients status based on email events.
 * Verifies webhook signatures to prevent spoofed events.
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
          "svix-id": req.headers.get("svix-id"),
          "svix-timestamp": req.headers.get("svix-timestamp"),
          "svix-signature": req.headers.get("svix-signature"),
        },
        secret: process.env.RESEND_WEBHOOK_SECRET,
      }) as WebhookEvent;
    } catch {
      console.error("[WEBHOOK] Signature verification failed");
      return new NextResponse("Invalid signature", { status: 400 });
    }

    const emailId = event.data.email_id;
    if (!emailId) {
      return new NextResponse("OK", { status: 200 });
    }

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
      const currentIdx = statusOrder.indexOf(recipient.status as RecipientStatus);
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
