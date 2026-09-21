"use server";

import { getDiscoveryAssociations } from "@/lib/discovery/associations";
import { invitationActorFromSession } from "@/lib/invitations/core";
import { requireSeat } from "@/lib/auth/seats";
import {
  acceptSeatInvitationAs,
  SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE,
} from "@/lib/invitations/accept-seat";
import { redirect } from "next/navigation";

export async function acceptSeatInvitationAction(
  _previous: { error?: string; leaveAssociations?: boolean },
  formData: FormData
): Promise<{ error?: string; leaveAssociations?: boolean }> {
  const { user } = await requireSeat("seat.invitation.answer");
  const token = formData.get("invitation");
  try {
    await acceptSeatInvitationAs(
      user,
      typeof token === "string" ? token : null
    );
  } catch {
    const discovery = await getDiscoveryAssociations(
      invitationActorFromSession({ user })
    );
    if (discovery?.sendingChurch || discovery?.network)
      return {
        error:
          "Leave your discovery associations before joining this team. Your associations cannot move into someone else's plant or organization.",
        leaveAssociations: true,
      };
    return { error: SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE };
  }
  redirect("/dashboard");
}
