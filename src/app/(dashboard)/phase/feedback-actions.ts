"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAccess } from "@/lib/auth/access";
import { verifySession } from "@/lib/auth/session";
import {
  InsightNotFoundError,
  submitInsightFeedbackSchema,
  upsertInsightFeedback,
  type SubmitInsightFeedbackInput,
} from "@/lib/phase-engine/feedback/service";
import type { InsightFeedback } from "@/db/schema";

// ============================================================================
// Insight feedback server actions (PE-014 / AC-PE-10).
//
// church_id-scoped. Upserts insight_feedback (useful/not_useful + optional
// comment), unique per (insight, user). The service denormalizes assessment id,
// church id, and rubric version so feedback is queryable as the rubric-tuning
// signal from day one.
// ============================================================================

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Upsert the current user's feedback for an insight, scoped to their church.
 *
 * Enforces church_id scope via the session + requireChurchAccess, and again in
 * the service (the insight must belong to the church). Feedback is unique per
 * (insight, user) — repeated submissions update the existing rating/comment.
 */
export async function submitInsightFeedbackAction(
  input: SubmitInsightFeedbackInput
): Promise<ActionResult<{ feedback: InsightFeedback }>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return {
        success: false,
        error: "You must be associated with a church to rate insights",
      };
    }

    const parsed = submitInsightFeedbackSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid feedback",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    // Tenant isolation (NFR-PE-6): confirm the user may write to this church.
    await requireChurchAccess(user, user.churchId);

    const feedback = await upsertInsightFeedback(user.churchId, user.id, {
      insightId: parsed.data.insightId,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
    });

    revalidatePath("/phase");

    return { success: true, data: { feedback } };
  } catch (error) {
    console.error("submitInsightFeedbackAction error:", error);

    if (error instanceof InsightNotFoundError) {
      return {
        success: false,
        error: "Insight not found",
      };
    }

    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        success: false,
        error: "You must be logged in to rate insights",
      };
    }

    return {
      success: false,
      error: "An unexpected error occurred while saving your feedback",
    };
  }
}
