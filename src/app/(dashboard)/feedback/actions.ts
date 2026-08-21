"use server";

import { requireSeat } from "@/lib/auth/seats";
import { rethrowUnauthorized } from "@/lib/auth/unauthorized";
import { db } from "@/db";
import { churches } from "@/db/schema";
import { sendEmail } from "@/lib/email/client";
import { feedbackNotificationEmail } from "@/lib/email/templates/feedback-notification";
import { bridgeFeedbackToGithub } from "@/lib/feedback/github";
import { createFeedback } from "@/lib/feedback/service";
import { feedbackCreateSchema } from "@/lib/validations/feedback";
import { eq } from "drizzle-orm";
import { after } from "next/server";

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
    const row = await createFeedback(
      user.id,
      user.churchId ?? null,
      parsed.data
    );

    // Both notifications are fire-and-forget: the row above is the record, and
    // neither Resend nor GitHub may fail a submission. They run inside `after`
    // so the platform keeps them alive past the response — a floating promise
    // is dropped when the function returns, which silently lost sends.
    after(async () => {
      const feedbackEmailTo = process.env.FEEDBACK_EMAIL_TO;
      if (feedbackEmailTo) {
        await sendFeedbackEmail({
          to: feedbackEmailTo,
          category: row.category,
          description: row.description,
          pageUrl: row.pageUrl,
          userName: user.name ?? "Unknown",
          userEmail: user.email,
          churchId: row.churchId,
        }).catch((err) => {
          console.error("[FEEDBACK] Email notification failed:", err);
        });
      }

      await bridgeFeedbackToGithub({
        feedbackId: row.id,
        category: row.category,
        description: row.description,
        pageUrl: row.pageUrl,
        churchId: row.churchId,
        userId: row.userId,
      }).catch((err) => {
        console.error("[FEEDBACK] GitHub issue creation failed:", err);
      });
    });

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
