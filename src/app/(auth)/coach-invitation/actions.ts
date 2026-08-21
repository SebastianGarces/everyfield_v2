"use server";

import { requireSeat } from "@/lib/auth/seats";
import { InvitationError } from "@/lib/invitations/core";
import {
  acceptCoachInvitationAs,
  COACH_INVITATION_NOT_ANSWERABLE_MESSAGE,
} from "@/lib/invitations/coach";
import { redirect } from "next/navigation";

/**
 * What the accept form renders back. A refusal only — a success redirects, so
 * there is no success state for a stale form to sit in.
 */
export type AcceptCoachInvitationState = {
  error?: string;
};

/**
 * Accept a coach invitation as the account already signed in (AS-009, #496).
 *
 * SESSION FIRST, AND THE CAPABILITY WITH IT. `coach.invitation.answer` carries
 * no seat set and no tenancy requirement, deliberately — see its row in
 * `@/lib/auth/seat-rules` — so what this guard buys is the SESSION, which is the
 * thing the accept actually needs: the token is bound to an address, and the
 * address it is checked against has to be one the caller proved, never one they
 * typed.
 *
 * The token is read from the form rather than from the URL for the same reason
 * every other action re-reads its input: this is a POST endpoint that never saw
 * the page.
 */
export async function acceptCoachInvitationAction(
  _prevState: AcceptCoachInvitationState,
  formData: FormData
): Promise<AcceptCoachInvitationState> {
  const { user } = await requireSeat("coach.invitation.answer");

  const token = formData.get("invitation");

  try {
    await acceptCoachInvitationAs(
      { id: user.id, email: user.email },
      typeof token === "string" ? token : null
    );
  } catch (error) {
    if (error instanceof InvitationError) {
      return { error: error.message };
    }
    console.error("accepting a coach invitation failed", error);
    return { error: COACH_INVITATION_NOT_ANSWERABLE_MESSAGE };
  }

  // The assignment now exists, so the sidebar has an Assigned plants section to
  // render. `/dashboard` is where every signed-in account starts and where that
  // section is first visible.
  redirect("/dashboard");
}
