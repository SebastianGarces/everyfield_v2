"use client";

import { InvitationsList } from "@/components/oversight/invitations-list";
import { CoachInviteForm } from "@/components/settings/coach-invite-form";
import { PlantCoachList } from "@/components/settings/plant-coach-list";
import { SeatInviteForm } from "@/components/settings/seat-invite-form";
import { SeatRoster } from "@/components/settings/seat-roster";
import type { TeamSectionView } from "@/lib/settings/section-view";

import {
  appointAdminAction,
  demoteToMemberAction,
  endCoachAssignmentAction,
  removeSeatAction,
  resendSeatInvitationEmailAction,
  revokeSeatInvitationAction,
} from "@/app/(dashboard)/settings/team/actions";

// ============================================================================
// The Team section — a TENANCY's own staffing surface (AS-014, #495, #497, #500).
//
// A SECTION OF THE SETTINGS MODAL SINCE #615. What moved then was the chrome
// (breadcrumbs, the `<h1>`, the page's own gate); what moved in #657 is the
// READS, into `readTeam` in `@/lib/settings/section-data`. Every control below
// is the one this screen has always drawn, and every guard behind them is
// unchanged.
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
// THE CAPABILITY ANSWERS ARRIVE RESOLVED, and neither is the section's own gate.
// The gate is `seat.invitation.manage`, asked by the registry and again by the
// loader. `canManageSeats` (`seat.manage`, Owner-only, AS-015) and
// `canEndAssignments` (`coach.assignment.manage`, an Admin's, AS-018) decide
// which CONTROLS render — and both were read from the same capability table the
// actions guard on, so a control can never appear beside an action that would
// refuse it.
//
// THE JOIN AND ASSIGNED DATES ARRIVE AS STRINGS, formatted on the server against
// `APP_TIME_ZONE`. This file is `"use client"`, so a `Date` on the wire would be
// formatted in the visitor's zone (`memory/invariants.md` → Date & Time
// Rendering).
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

export function TeamSection({ view }: { view: TeamSectionView }) {
  return (
    <div className="space-y-6">
      <SeatInviteForm
        expiryDays={view.expiryDays}
        tenancyType={view.tenancyType}
      />

      {/*
        THE PLANT'S ALONE (#500). It was unconditional while this surface was a
        plant's only: `coach.assignment.manage` carried the same seat set on the
        same tenancy as the gate, so a guard could never read false. Widening
        the gate to an org broke that equality — the coach verb is still
        `tenancy: "plant"` — so the section is now keyed on the tenancy that can
        actually hold a coach.
      */}
      {view.isPlant && <CoachInviteForm expiryDays={view.expiryDays} />}

      <SeatRoster
        rows={view.roster}
        canManageSeats={view.canManageSeats}
        tenancyType={view.tenancyType}
        actions={{
          appoint: appointAdminAction,
          demote: demoteToMemberAction,
          remove: removeSeatAction,
        }}
      />

      {view.isPlant && (
        <PlantCoachList
          rows={view.coaches}
          canEndAssignments={view.canEndAssignments}
          endAssignment={endCoachAssignmentAction}
        />
      )}

      <InvitationsList
        rows={view.seatInvitations}
        actions={{
          resend: resendSeatInvitationEmailAction,
          revoke: revokeSeatInvitationAction,
        }}
        pendingDescription={`Waiting for them to sign up. Anyone who can invite for this ${view.noun} can resend the email or revoke the invitation — revoking closes it immediately, and the link stops working.`}
        answeredDescription={`Every invitation this ${view.noun} has sent that is no longer open.`}
      />

      {view.isPlant && view.coachInvitations.length > 0 && (
        <InvitationsList
          rows={view.coachInvitations}
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
