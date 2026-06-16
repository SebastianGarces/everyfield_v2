"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { feedbackStatuses } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { updateFeedbackStatus } from "@/lib/feedback/service";

// ============================================================================
// Types
// ============================================================================

type ActionResult = { success: true } | { success: false; error: string };

// ============================================================================
// Validation
// ============================================================================

const updateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(feedbackStatuses),
});

// ============================================================================
// Actions
// ============================================================================

/**
 * Update the triage status of a feedback submission.
 * Guarded with requirePlatformAdmin() so non-admins cannot invoke it directly.
 */
export async function updateFeedbackStatusAction(
  formData: FormData
): Promise<ActionResult> {
  // Authorize the action itself, not just the page. Non-admins hit notFound().
  await requirePlatformAdmin();

  const parsed = updateStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { success: false, error: "Invalid feedback status update." };
  }

  await updateFeedbackStatus(parsed.data.id, parsed.data.status);

  revalidatePath("/admin/feedback");

  return { success: true };
}
