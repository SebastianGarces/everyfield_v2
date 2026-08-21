import { feedbackCategories } from "@/db/schema";
import { z } from "zod";

// ============================================================================
// Feedback Schemas
// ============================================================================

export const feedbackCategorySchema = z.enum(feedbackCategories);

export const feedbackCreateSchema = z.object({
  category: feedbackCategorySchema.optional().default("suggestion"),
  // Trim BEFORE the length checks, not after: a description of pure whitespace
  // used to pass `.min(1)` and store as "", which the #190 bridge would then
  // publish as an empty issue with an empty title.
  description: z
    .string()
    .trim()
    .min(1, "Please describe your feedback")
    .max(5000, "Feedback must be under 5000 characters"),
  pageUrl: z.string().max(500).optional(),
});

export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;
