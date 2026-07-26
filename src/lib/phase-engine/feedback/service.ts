import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  insightFeedback,
  insightFeedbackRatings,
  plantAssessments,
  plantInsights,
  type InsightFeedback,
  type InsightFeedbackRating,
} from "@/db/schema";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

/**
 * Validates an insight feedback submission. Kept here (not in the "use server"
 * action) so it is unit-testable.
 */
export const submitInsightFeedbackSchema = z.object({
  insightId: z.string().uuid("Invalid insight id"),
  rating: z.enum(insightFeedbackRatings),
  comment: z.string().trim().max(2000, "Comment is too long").optional(),
});

export type SubmitInsightFeedbackInput = z.infer<
  typeof submitInsightFeedbackSchema
>;

// ============================================================================
// Insight feedback service (PE-014 / AC-PE-10).
//
// Per-insight "useful / not_useful" rating + optional comment. Retained from
// day one as the rubric-tuning signal. We denormalize `assessment_id`,
// `church_id`, and `rubric_version` onto each row so feedback is queryable by
// assessment and rubric version without a join. One current rating per
// (insight, user); upserted (unique index insight_feedback_insight_user_idx).
//
// Every operation is church_id-scoped (NFR-PE-6): the target insight must
// belong to the supplied church, otherwise the write is rejected.
// ============================================================================

/** Raised when an insight does not exist within the caller's church scope. */
export class InsightNotFoundError extends Error {
  constructor() {
    super("Insight not found");
    this.name = "InsightNotFoundError";
  }
}

/** Input for recording feedback on a single insight. */
export interface UpsertInsightFeedbackInput {
  insightId: string;
  rating: InsightFeedbackRating;
  /** Optional free-text comment. Trimmed; empty becomes null. */
  comment?: string | null;
}

/**
 * Upsert a user's feedback for an insight, scoped to a church.
 *
 * Resolves the insight (within `churchId`) and its parent assessment to
 * denormalize `assessment_id`, `church_id`, and `rubric_version` onto the
 * feedback row, so it is queryable as the rubric-tuning signal without a join.
 *
 * Feedback is unique per (insight, user): a second call from the same user
 * updates the existing rating/comment rather than inserting a duplicate.
 *
 * @param churchId  Tenant scope. The caller must have verified access.
 * @param userId  User recording the feedback.
 * @param input  Insight id + rating + optional comment.
 * @throws InsightNotFoundError if the insight is not in the church's scope.
 * @returns The persisted (inserted or updated) feedback row.
 */
export async function upsertInsightFeedback(
  churchId: string,
  userId: string,
  input: UpsertInsightFeedbackInput
): Promise<InsightFeedback> {
  // Resolve the insight + its assessment's rubric version, enforcing church
  // scope in the same query (the insight must belong to this church).
  const [target] = await db
    .select({
      insightId: plantInsights.id,
      churchId: plantInsights.churchId,
      assessmentId: plantInsights.assessmentId,
      rubricVersion: plantAssessments.rubricVersion,
    })
    .from(plantInsights)
    .innerJoin(
      plantAssessments,
      eq(plantInsights.assessmentId, plantAssessments.id)
    )
    .where(
      and(
        eq(plantInsights.id, input.insightId),
        eq(plantInsights.churchId, churchId)
      )
    )
    .limit(1);

  if (!target) {
    throw new InsightNotFoundError();
  }

  const comment = input.comment?.trim() ? input.comment.trim() : null;
  const now = new Date();

  const [feedback] = await db
    .insert(insightFeedback)
    .values({
      insightId: target.insightId,
      assessmentId: target.assessmentId,
      churchId: target.churchId,
      userId,
      rubricVersion: target.rubricVersion,
      rating: input.rating,
      comment,
    })
    .onConflictDoUpdate({
      target: [insightFeedback.insightId, insightFeedback.userId],
      set: {
        // Re-denormalize in case the insight was regenerated under a new
        // assessment/rubric version since the prior feedback.
        assessmentId: target.assessmentId,
        rubricVersion: target.rubricVersion,
        rating: input.rating,
        comment,
        updatedAt: now,
      },
    })
    .returning();

  return feedback;
}

/**
 * Read the current user's feedback for an insight, church_id-scoped.
 * Returns null when the user has not rated the insight.
 */
export async function getInsightFeedbackForUser(
  churchId: string,
  userId: string,
  insightId: string
): Promise<InsightFeedback | null> {
  const [feedback] = await db
    .select()
    .from(insightFeedback)
    .where(
      and(
        eq(insightFeedback.churchId, churchId),
        eq(insightFeedback.userId, userId),
        eq(insightFeedback.insightId, insightId)
      )
    )
    .limit(1);

  return feedback ?? null;
}
