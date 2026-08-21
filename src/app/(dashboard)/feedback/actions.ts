"use server";

import { requireSeat } from "@/lib/auth/seats";
import { rethrowUnauthorized } from "@/lib/auth/unauthorized";
import { notifyNewFeedback } from "@/lib/feedback/notify";
import { createFeedback } from "@/lib/feedback/service";
import { feedbackCreateSchema } from "@/lib/validations/feedback";
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
 *
 * The row IS the submission. Everything downstream of it — the team email, the
 * board issue — is scheduled with `after` and owned by `notifyNewFeedback`: a
 * promise this action merely started would be free to die with the response.
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

    const row = await createFeedback(
      user.id,
      user.churchId ?? null,
      parsed.data
    );

    after(() => notifyNewFeedback(row, user));

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
