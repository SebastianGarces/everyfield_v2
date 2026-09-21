"use server";

import { refresh } from "next/cache";
import { requireSeat } from "@/lib/auth/seats";
import {
  InvitationError,
  invitationActorFromSession,
  isUuid,
} from "@/lib/invitations/core";
import { removeDiscoveryFromOrgAs } from "@/lib/discovery/associations";

export async function removeDiscoveryAssociate(
  userId: string,
  confirmation: string
): Promise<{ success: true } | { success: false; error: string }> {
  const actor = invitationActorFromSession(
    await requireSeat("org.invitation.manage")
  );
  if (!isUuid(userId) || typeof confirmation !== "string")
    return { success: false, error: "This association cannot be ended." };
  try {
    await removeDiscoveryFromOrgAs(actor, userId, confirmation);
    refresh();
    return { success: true };
  } catch (error) {
    if (error instanceof InvitationError)
      return { success: false, error: error.message };
    console.error("Removing a discovery association failed", error);
    return {
      success: false,
      error: "The association could not be ended. Try again.",
    };
  }
}
