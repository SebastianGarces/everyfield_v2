import { feedbackCategories } from "@/db/schema";
import { z } from "zod";

// ============================================================================
// Feedback Schemas
// ============================================================================

export const feedbackCategorySchema = z.enum(feedbackCategories);

export const feedbackCreateSchema = z.object({
  category: feedbackCategorySchema.optional().default("suggestion"),
  description: z
    .string()
    .min(1, "Please describe your feedback")
    .max(5000, "Feedback must be under 5000 characters")
    .transform((v) => v.trim()),
  pageUrl: z.string().max(500).optional(),
});

export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;
