import { db } from "@/db";
import { feedback, type NewFeedback } from "@/db/schema";
import type { FeedbackCreateInput } from "@/lib/validations/feedback";

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new feedback entry.
 */
export async function createFeedback(
  userId: string,
  churchId: string | null,
  input: FeedbackCreateInput
) {
  const values: NewFeedback = {
    userId,
    churchId,
    category: input.category,
    description: input.description,
    pageUrl: input.pageUrl,
  };

  const [row] = await db.insert(feedback).values(values).returning();
  return row;
}
