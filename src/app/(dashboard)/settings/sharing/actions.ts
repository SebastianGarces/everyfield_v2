"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { verifySession } from "@/lib/auth/session";
import { setSharingActivityWithOversight } from "@/lib/notifications/oversight-sharing";

// ============================================================================
// The sharing screen's one write (N-026).
//
// Whose plant this is is NOT an argument. The action takes a boolean and
// nothing else; the church comes from the session, so there is no form field,
// query string or route param anywhere on this screen that names a church. A
// planter can only ever change their own plant's setting, and that is a
// property of the signature rather than a check someone could delete.
//
// Planter-only. A team member is inside the plant but this is not their
// decision to make, and a coach or an oversight admin deciding what a plant
// shares with oversight would be the setting authorising itself.
//
// `refresh()` rather than `revalidatePath`, per
// memory/contracts/data-patterns.md: the switch holds an optimistic value and
// the server reconciles behind it.
// ============================================================================

export type SharingActionResult =
  | { success: true; enabled: boolean }
  | { success: false; error: string };

const inputSchema = z.boolean();

export async function setOversightSharingAction(
  enabled: boolean
): Promise<SharingActionResult> {
  const parsed = inputSchema.safeParse(enabled);
  if (!parsed.success) {
    return { success: false, error: "That is not a setting we can save" };
  }

  const { user } = await verifySession();

  if (user.role !== "planter") {
    return {
      success: false,
      error: "Only the church planter can change what this plant shares",
    };
  }

  if (!user.churchId) {
    return { success: false, error: "Create your church plant first" };
  }

  const stored = await setSharingActivityWithOversight({
    churchId: user.churchId,
    enabled: parsed.data,
    updatedBy: user.id,
  });

  refresh();

  return { success: true, enabled: stored };
}
