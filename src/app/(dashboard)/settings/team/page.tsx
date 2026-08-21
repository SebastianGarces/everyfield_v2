import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { InvitationsList } from "@/components/oversight/invitations-list";
import { PlantCoachList } from "@/components/settings/plant-coach-list";
import { SeatInviteForm } from "@/components/settings/seat-invite-form";
import { SeatRoster } from "@/components/settings/seat-roster";
import { verifySession } from "@/lib/auth/session";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { formatDate } from "@/lib/datetime";
import { INVITATION_EXPIRY_DAYS } from "@/lib/invitations/core";
import { toSeatInvitationListRow } from "@/lib/invitations/list-row";
import { invitationActorFromSession } from "@/lib/invitations/core";
import {
  expireLapsedSeatInvitations,
  listSeatInvitationsFor,
} from "@/lib/invitations/seat";
import {
  listPlantCoaches,
  listSeatRoster,
  seatActorFromSession,
} from "@/lib/seats/roster";

import {
  appointAdminAction,
  demoteToMemberAction,
  endCoachAssignmentAction,
  removeSeatAction,
  resendSeatInvitationEmailAction,
  revokeSeatInvitationAction,
} from "./actions";

// ============================================================================
// `/settings/team` — the plant's own staffing surface (AS-014, #495 then #497).
//
// ALL THREE SECTIONS NOW, plus the coach list: the invite form and the pending
// invitations (#495), the seat roster with appoint / demote / remove (#497,
// AS-015 – AS-017 and AS-023), and the plant's active coach assignments
// (AS-018, AS-024).
//
// TWO CAPABILITIES ARE ASKED, NOT ONE, and neither is the page's own gate. The
// gate is `seat.invitation.manage` below — reaching the screen is an Admin's
// (AS-014). What the two extra questions decide is which CONTROLS render:
// `seat.manage` is Owner-only (AS-015), `coach.assignment.manage` is an Admin's
// (AS-018). Asking `holdsSeatFor` here rather than comparing a seat is what
// keeps the page and its actions reading one table — a control can never appear
// beside an action that would refuse it.
//
// THE JOIN AND ASSIGNED DATES ARE FORMATTED HERE, on the server, against
// `APP_TIME_ZONE`: a `Date` formatted in the visitor's zone and again on the
// server is a hydration mismatch (`memory/invariants.md` → Date & Time
// Rendering), which is why both view rows carry a string.
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

  // Safe to mint: `seat.invitation.manage` is `tenancy: "plant"`, so the
  // redirect above already refused every account whose `church_id` is null.
  const seatActor = seatActorFromSession(session);
  const canManageSeats = holdsSeatFor(session.user, "seat.manage");
  const canEndAssignments = holdsSeatFor(
    session.user,
    "coach.assignment.manage"
  );

  const [roster, coaches] = await Promise.all([
    listSeatRoster(seatActor),
    listPlantCoaches(seatActor),
  ]);

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

        <SeatRoster
          rows={roster.map((row) => ({
            userId: row.userId,
            name: row.name,
            email: row.email,
            seat: row.seat,
            joinedLabel: formatDate(row.joinedAt, "short"),
            isSelf: row.userId === session.user.id,
          }))}
          canManageSeats={canManageSeats}
          actions={{
            appoint: appointAdminAction,
            demote: demoteToMemberAction,
            remove: removeSeatAction,
          }}
        />

        <PlantCoachList
          rows={coaches.map((row) => ({
            assignmentId: row.assignmentId,
            name: row.name,
            email: row.email,
            assignedLabel: formatDate(row.assignedAt, "short"),
          }))}
          canEndAssignments={canEndAssignments}
          endAssignment={endCoachAssignmentAction}
        />

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
