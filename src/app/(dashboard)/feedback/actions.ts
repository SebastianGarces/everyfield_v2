"use server";

import { requireSeat } from "@/lib/auth/seats";
import { rethrowUnauthorized } from "@/lib/auth/unauthorized";
import { db } from "@/db";
import { churches } from "@/db/schema";
import { sendEmail } from "@/lib/email/client";
import { feedbackNotificationEmail } from "@/lib/email/templates/feedback-notification";
import { createFeedback } from "@/lib/feedback/service";
import { feedbackCreateSchema } from "@/lib/validations/feedback";
import { eq } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

type ActionResult =
  | { success: true }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// ============================================================================
// Actions
// ============================================================================

/**
 * Submit feedback from the in-app feedback form.
 * Saves to database and sends email notification.
 */
export async function submitFeedbackAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    const { user } = await requireSeat("self.write");

    // Parse and validate input
    const rawData = {
      category: formData.get("category") || undefined,
      description: formData.get("description") || undefined,
      pageUrl: formData.get("pageUrl") || undefined,
    };

    const parsed = feedbackCreateSchema.safeParse(rawData);

    if (!parsed.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      };
    }

    // Save feedback to database
    await createFeedback(user.id, user.churchId ?? null, parsed.data);

    // Send email notification (fire-and-forget)
    const feedbackEmailTo = process.env.FEEDBACK_EMAIL_TO;
    if (feedbackEmailTo) {
      sendFeedbackEmail({
        to: feedbackEmailTo,
        category: parsed.data.category ?? "suggestion",
        description: parsed.data.description,
        pageUrl: parsed.data.pageUrl ?? null,
        userName: user.name ?? "Unknown",
        userEmail: user.email,
        churchId: user.churchId ?? null,
      }).catch((err) => {
        console.error("[FEEDBACK] Email notification failed:", err);
      });
    }

    return { success: true };
  } catch (error) {
    rethrowUnauthorized(error);

    console.error("[submitFeedbackAction] error:", error);

    return {
      success: false,
      error: "Failed to submit feedback. Please try again.",
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function sendFeedbackEmail({
  to,
  category,
  description,
  pageUrl,
  userName,
  userEmail,
  churchId,
}: {
  to: string;
  category: string;
  description: string;
  pageUrl: string | null;
  userName: string;
  userEmail: string;
  churchId: string | null;
}) {
  // Resolve church name if available
  let churchName: string | null = null;
  if (churchId) {
    const [church] = await db
      .select({ name: churches.name })
      .from(churches)
      .where(eq(churches.id, churchId))
      .limit(1);
    churchName = church?.name ?? null;
  }

  const { subject, html, text } = await feedbackNotificationEmail({
    category,
    description,
    pageUrl,
    userName,
    userEmail,
    churchName,
    submittedAt: new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    }),
  });

  await sendEmail({ to, subject, html, text });
}
