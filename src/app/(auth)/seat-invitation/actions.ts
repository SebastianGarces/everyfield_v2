"use server";

import { requireSeat } from "@/lib/auth/seats";
import {
  acceptSeatInvitationAs,
  SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE,
} from "@/lib/invitations/accept-seat";
import { redirect } from "next/navigation";

export async function acceptSeatInvitationAction(
  _previous: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const { user } = await requireSeat("seat.invitation.answer");
  const token = formData.get("invitation");
  try {
    await acceptSeatInvitationAs(
      user,
      typeof token === "string" ? token : null
    );
  } catch {
    return { error: SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE };
  }
  redirect("/dashboard");
}
