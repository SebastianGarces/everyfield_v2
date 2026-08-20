import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { InvitationsList } from "@/components/oversight/invitations-list";
import { SeatInviteForm } from "@/components/settings/seat-invite-form";
import { verifySession } from "@/lib/auth/session";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { INVITATION_EXPIRY_DAYS } from "@/lib/invitations/core";
import { toSeatInvitationListRow } from "@/lib/invitations/list-row";
import { invitationActorFromSession } from "@/lib/invitations/core";
import {
  expireLapsedSeatInvitations,
  listSeatInvitationsFor,
} from "@/lib/invitations/seat";

import {
  resendSeatInvitationEmailAction,
  revokeSeatInvitationAction,
} from "./actions";

// ============================================================================
// `/settings/team` — the plant's own staffing surface (AS-014, #495).
//
// THIS TRACK SHIPS TWO OF ITS THREE SECTIONS: the invite form and the pending
// invitations list. The seat roster, appoint/demote and remove are their own
// issues (AS-015 – AS-017, AS-023) and land here beside these.
//
// THE GUARD IS THE SAME TABLE THE ACTIONS USE. `holdsSeatFor(user,
// "seat.invitation.manage")` is `ADMIN_PLUS` on a plant tenancy — the identical
// question `requireSeat` asks in `./actions.ts` — so the page and its writes can
// never disagree about who this screen is for. It is a redirect and not an
// authorization subtlety: an account with no plant would be shown a form with no
// subject. The refusal that matters is the server-side one on the actions,
// which holds for a POST that never saw this page.
//
// SCOPING IS THE LEAK GUARD, exactly as on `/oversight/invitations`:
// `listSeatInvitationsFor` puts the actor's OWN `church_id` in the WHERE, so
// there is no route param, query string or form field anywhere on this screen
// that names a plant.
//
// THE LIST COMPONENT IS THE ORG SURFACE'S, given this page's own two actions.
// Both tables answer the same two questions on a pending row — resend it, close
// it — so the countdown, the wrapping control cluster and the accessible names
// are written once (`@/components/oversight/invitations-list`).
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Team",
};

export default async function TeamSettingsPage() {
  const session = await verifySession();

  if (!holdsSeatFor(session.user, "seat.invitation.manage")) {
    redirect("/settings");
  }

  const actor = invitationActorFromSession(session);

  // LAZY EXPIRY, and it is idempotent: it only moves `pending` rows whose window
  // has closed, so a second look changes nothing the first did. Without it a
  // lapsed invitation keeps its Resend and Revoke controls — offering an action
  // whose own guard is guaranteed to refuse it.
  await expireLapsedSeatInvitations(actor);

  const rows = (await listSeatInvitationsFor(actor)).map(
    toSeatInvitationListRow
  );

  return (
    <>
      <HeaderBreadcrumbs
        items={[{ label: "Settings", href: "/settings" }, { label: "Team" }]}
      />

      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-muted-foreground text-sm">
            Invite people onto this church plant and see who is still to answer.
          </p>
        </div>

        <SeatInviteForm expiryDays={INVITATION_EXPIRY_DAYS} />

        <InvitationsList
          rows={rows}
          actions={{
            resend: resendSeatInvitationEmailAction,
            revoke: revokeSeatInvitationAction,
          }}
          pendingDescription="Waiting for them to sign up. Anyone who can invite for this plant can resend the email or revoke the invitation — revoking closes it immediately, and the link stops working."
          answeredDescription="Every invitation this plant has sent that is no longer open."
        />
      </div>
    </>
  );
}
