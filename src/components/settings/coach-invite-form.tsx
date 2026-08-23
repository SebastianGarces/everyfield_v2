"use client";

// ============================================================================
// Invite somebody to COACH the plant — the second form on `/settings/team`
// (AS-008 / AS-009, #496).
//
// ONE FIELD, and that is the whole difference from `./seat-invite-form`: there
// is no seat to choose, because a coach has no seat. `user_invitations` writes
// NULL there and `user_invitations_seat_check` makes any other value a
// constraint violation, so the field is absent from the schema as well as from
// this form.
//
// A SEPARATE FORM AND NOT A THIRD OPTION IN THE SEAT SELECT, deliberately. A
// select reading "Member / Admin / Coach" would say that coaching is a kind of
// seat, which is the one thing the model insists it is not — a coach joins no
// tenancy, holds no seat, and can write nothing. Two forms, two sentences, two
// verbs.
//
// IT TELLS THE TRUTH ABOUT EXISTING ACCOUNTS, which the seat form cannot. A seat
// invitation is refused for any address that already has an account; a coach
// invitation is not, and saying so up front is what stops an Owner assuming the
// same restriction and not bothering.
//
// THE NOTICE IS THE SHARED ONE. `invitationCreatedNotice` says the same neutral
// sentence for both kinds, which is also what keeps the success from becoming an
// account-existence oracle.
// ============================================================================

import { useActionState, useState } from "react";

import {
  createCoachInvitationAction,
  type CreateSeatInvitationState,
} from "@/app/(dashboard)/settings/team/actions";
import {
  SettingsBlock,
  SettingsHeading,
} from "@/components/settings/settings-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invitationCreatedNotice } from "@/lib/invitations/create-notice";

const initialState: CreateSeatInvitationState = {};

export function CoachInviteForm({ expiryDays }: { expiryDays: number }) {
  const [state, formAction, pending] = useActionState(
    createCoachInvitationAction,
    initialState
  );
  // Controlled so a refused submit — a duplicate, somebody who already coaches
  // this plant — keeps what was typed instead of clearing it.
  const [inviteeEmail, setInviteeEmail] = useState("");

  return (
    <section aria-labelledby="team-invite-coach">
      <SettingsBlock>
        <SettingsHeading
          id="team-invite-coach"
          description={
            <>
              A coach reads your plant&apos;s work — its people, meetings, teams
              and tasks — and cannot change any of it. They do not join your
              team and they take no seat. Anyone can be invited to coach,
              whether or not they already have an EveryField account.
            </>
          }
        >
          Invite a coach
        </SettingsHeading>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <p
              id="coachInviteeEmail-error"
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
            >
              {state.error}
            </p>
          )}

          {state.created && (
            <CoachInviteCreatedNotice created={state.created} />
          )}

          <div className="space-y-2">
            <Label htmlFor="coachInviteeEmail">Email address</Label>
            <Input
              id="coachInviteeEmail"
              name="inviteeEmail"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="coach@example.com"
              required
              value={inviteeEmail}
              onChange={(event) => setInviteeEmail(event.target.value)}
              aria-invalid={Boolean(state.error)}
              aria-describedby={
                state.error ? "coachInviteeEmail-error" : undefined
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="cursor-pointer" disabled={pending}>
              {pending ? "Sending invitation…" : "Send invitation"}
            </Button>
            <p className="text-muted-foreground text-xs">
              Invitations expire after {expiryDays} days.
            </p>
          </div>
        </form>
      </SettingsBlock>
    </section>
  );
}

/** The shared three states, so both invite forms speak one vocabulary. */
function CoachInviteCreatedNotice({
  created,
}: {
  created: NonNullable<CreateSeatInvitationState["created"]>;
}) {
  const notice = invitationCreatedNotice({
    inviteeEmail: created.inviteeEmail,
    emailSent: created.emailSent,
  });
  const failed = notice.state === "not_sent";

  return (
    <div
      role="status"
      className={
        // The attention scale's MEDIUM step — the repo's caution treatment, the
        // same one `SeatInviteForm` paints. The invitation exists; only the
        // email did not go.
        failed
          ? "border-attention-medium/45 bg-attention-medium/18 space-y-1 rounded-md border p-3 text-sm"
          : "border-primary/30 bg-primary/5 space-y-1 rounded-md border p-3 text-sm"
      }
    >
      <p
        className={
          failed ? "text-attention-medium-ink font-medium" : "font-medium"
        }
      >
        {notice.headline}
      </p>
      <p className="text-muted-foreground">{notice.detail}</p>
    </div>
  );
}
