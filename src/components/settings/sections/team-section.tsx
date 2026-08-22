import { redirect } from "next/navigation";

import { InvitationsList } from "@/components/oversight/invitations-list";
import { CoachInviteForm } from "@/components/settings/coach-invite-form";
import { PlantCoachList } from "@/components/settings/plant-coach-list";
import { SeatInviteForm } from "@/components/settings/seat-invite-form";
import { SeatRoster } from "@/components/settings/seat-roster";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { tenancyOf } from "@/lib/auth/tenancy";
import { formatDate } from "@/lib/datetime";
import { INVITATION_EXPIRY_DAYS } from "@/lib/invitations/core";
import { invitationActorFromSession } from "@/lib/invitations/core";
import { toSeatInvitationListRow } from "@/lib/invitations/list-row";
import { TENANCY_NOUN } from "@/lib/invitations/seat-copy";
import {
  expireLapsedUserInvitations,
  listUserInvitationsFor,
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
} from "@/app/(dashboard)/settings/team/actions";

// ============================================================================
// `/settings/team` — a TENANCY's own staffing surface (AS-014, #495, #497, #500).
//
// A SECTION OF THE SETTINGS MODAL SINCE #615, at its unchanged URL. The page
// that used to serve it is gone; what moved is the chrome (breadcrumbs, the
// `<h1>`, the page's own gate) and nothing else — the reads, the guards and
// every control below are the ones that screen has always drawn.
//
// ONE SCREEN FOR ALL THREE TENANCIES, not a second one for orgs (#500). A
// sending church and a network staff themselves with the same two seats over
// the same table through the same three actions; what differs is the NOUN and
// the two plant-only sections. A parallel `/oversight/team` would have been this
// file with `church` swapped for `sending_church` and would have drifted from it
// on the first change to either.
//
// THE COACH SECTIONS ARE THE PLANT'S ALONE, and they are ABSENT rather than
// empty for an org. Coaching is a relationship with a church plant —
// `coach.assignment.manage` is `tenancy: "plant"`, so an org actor cannot create
// one, and `listPlantCoaches` refuses one outright. Rendering an empty "Coaches"
// card to a network would offer a section that can never fill.
//
// TWO CAPABILITIES ARE ASKED, NOT ONE, and neither is the section's own gate.
// The gate is `seat.invitation.manage` — which the registry now asks
// (`@/lib/settings/sections`), so the nav cannot list a section the reader is
// then redirected out of. What the two extra questions decide is which CONTROLS
// render: `seat.manage` is Owner-only (AS-015), `coach.assignment.manage` is an
// Admin's (AS-018). Asking `holdsSeatFor` here rather than comparing a seat is
// what keeps the surface and its actions reading one table — a control can never
// appear beside an action that would refuse it.
//
// THE JOIN AND ASSIGNED DATES ARE FORMATTED HERE, on the server, against
// `APP_TIME_ZONE`: a `Date` formatted in the visitor's zone and again on the
// server is a hydration mismatch (`memory/invariants.md` → Date & Time
// Rendering), which is why both view rows carry a string.
//
// SCOPING IS THE LEAK GUARD, exactly as on `/oversight/invitations`:
// `listUserInvitationsFor` puts the actor's OWN `church_id` in the WHERE, so
// there is no route param, query string or form field anywhere on this surface
// that names a plant.
//
// THE LIST COMPONENT IS THE ORG SURFACE'S, given this section's own two actions.
// Both tables answer the same two questions on a pending row — resend it, close
// it — so the countdown, the wrapping control cluster and the accessible names
// are written once (`@/components/oversight/invitations-list`).
// ============================================================================

export async function TeamSection() {
  const session = await verifySession();

  // THE SAME QUESTION THE REGISTRY ASKED, re-asked. It is unreachable — the
  // section does not render for an account the registry gated out — and it
  // stays because the refusal that matters is the actions', and this keeps the
  // surface stating its own gate rather than trusting a caller to have asked.
  if (!holdsSeatFor(session.user, "seat.invitation.manage")) {
    redirect("/settings");
  }

  // WHICH TEAM THIS IS. The gate above is `seat.invitation.manage`, which is
  // `tenancy: "tenancy"` — so every account past it names exactly one tenancy
  // and this cannot be null. It is read rather than asserted because the same
  // resolution is what every query below is scoped by.
  const tenancy = tenancyOf(session.user);
  if (!tenancy) {
    redirect("/settings");
  }

  const noun = TENANCY_NOUN[tenancy.type];
  const isPlant = tenancy.type === "church";

  const actor = invitationActorFromSession(session);

  // LAZY EXPIRY, and it is idempotent: it only moves `pending` rows whose window
  // has closed, so a second look changes nothing the first did. Without it a
  // lapsed invitation keeps its Resend and Revoke controls — offering an action
  // whose own guard is guaranteed to refuse it.
  await expireLapsedUserInvitations(actor);

  // PARTITIONED BY KIND, NOT MIXED (#496). `listUserInvitationsFor` returns both
  // kinds because the plant owns both, but an Admin reading one list of pending
  // addresses could not tell which of them was being offered a seat and which a
  // coaching assignment — and `InvitationListRow` deliberately carries no `kind`
  // to tell them with. Two lists under two headings answers it without widening
  // the row.
  const invitations = await listUserInvitationsFor(actor);
  const seatRows = invitations
    .filter((row) => row.kind === "seat")
    .map(toSeatInvitationListRow);
  const coachRows = invitations
    .filter((row) => row.kind === "coach")
    .map(toSeatInvitationListRow);

  // Safe to mint: `seat.invitation.manage` is `tenancy: "tenancy"`, so the
  // redirect above already refused every account that names no tenancy.
  const seatActor = seatActorFromSession(session);
  const canManageSeats = holdsSeatFor(session.user, "seat.manage");
  // `coach.assignment.manage` is `tenancy: "plant"`, so this reads false for an
  // org account — which is why the coach sections below can key off `isPlant`
  // and never off this flag alone.
  const canEndAssignments = holdsSeatFor(
    session.user,
    "coach.assignment.manage"
  );

  const [roster, coaches] = await Promise.all([
    listSeatRoster(seatActor),
    // NOT CALLED FOR AN ORG. `listPlantCoaches` throws for a tenancy that is not
    // a plant, deliberately — a coach list scoped by a network's id against
    // `coach_assignments.church_id` would read as an answer and be none.
    isPlant ? listPlantCoaches(seatActor) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <SeatInviteForm
        expiryDays={INVITATION_EXPIRY_DAYS}
        tenancyType={tenancy.type}
      />

      {/*
        THE PLANT'S ALONE (#500). It was unconditional while this surface was a
        plant's only: `coach.assignment.manage` carried the same seat set on the
        same tenancy as the gate, so a guard could never read false. Widening
        the gate to an org broke that equality — the coach verb is still
        `tenancy: "plant"` — so the section is now keyed on the tenancy that can
        actually hold a coach.
      */}
      {isPlant && <CoachInviteForm expiryDays={INVITATION_EXPIRY_DAYS} />}

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
        tenancyType={tenancy.type}
        actions={{
          appoint: appointAdminAction,
          demote: demoteToMemberAction,
          remove: removeSeatAction,
        }}
      />

      {isPlant && (
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
      )}

      <InvitationsList
        rows={seatRows}
        actions={{
          resend: resendSeatInvitationEmailAction,
          revoke: revokeSeatInvitationAction,
        }}
        pendingDescription={`Waiting for them to sign up. Anyone who can invite for this ${noun} can resend the email or revoke the invitation — revoking closes it immediately, and the link stops working.`}
        answeredDescription={`Every invitation this ${noun} has sent that is no longer open.`}
      />

      {isPlant && coachRows.length > 0 && (
        <InvitationsList
          rows={coachRows}
          actions={{
            resend: resendSeatInvitationEmailAction,
            revoke: revokeSeatInvitationAction,
          }}
          pendingDescription="Coaching invitations waiting for an answer. Resending mints a new link and the earlier one stops working; revoking closes the invitation immediately."
          answeredDescription="Every coaching invitation this plant has sent that is no longer open."
        />
      )}
    </div>
  );
}
