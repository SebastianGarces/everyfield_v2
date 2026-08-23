"use client";

// ============================================================================
// Invite somebody onto the plant — the form half of `/settings/team` (AS-010).
//
// Two fields, and both are the whole of what the server accepts: the person's
// EMAIL, and the SEAT they get. There is no expiry field (server-fixed by the
// 2026-08-03 ruling) and no church field — the plant is the actor's own, minted
// from the session, so there is nothing on this screen that names one.
//
// `owner` IS NOT AN OPTION, and it is absent from the schema as well as from
// this select: the Owner seat belongs to whoever created the plant, and
// `users_church_owner_unique_idx` would refuse a second one. Appointing and
// demoting is a different surface (AS-015) and a different verb.
//
// THE NOTICE IS THE SHARED ONE. `invitationCreatedNotice` is pure copy with no
// imports of its own, so the three states it names — sent, not sent, nothing
// attempted — read identically here and on `/oversight/invitations`, and a
// wording change lands on both.
// ============================================================================

import { useActionState, useState } from "react";

import {
  createSeatInvitationAction,
  type CreateSeatInvitationState,
} from "@/app/(dashboard)/settings/team/actions";
import {
  SettingsBlock,
  SettingsHeading,
} from "@/components/settings/settings-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InvitableSeat } from "@/db/schema/user-invitation";
import type { SeatTenancyType } from "@/lib/auth/tenancy";
import { invitationCreatedNotice } from "@/lib/invitations/create-notice";
import { TENANCY_NOUN } from "@/lib/invitations/seat-copy";

const initialState: CreateSeatInvitationState = {};

/**
 * WHAT EACH SEAT IS, IN THE ONE PLACE A SEAT IS CHOSEN (#500).
 *
 * Keyed by the tenancy first, because that is what changes the answer: an Admin
 * in a church plant runs the day-to-day work, and an Admin in a sending church
 * or a network staffs the org and reads a portfolio. A table rather than a
 * ternary in the JSX for the reason `INVITED_AS_COPY` is one — `seat-guard.test.ts`
 * bans a hand-compared seat anywhere outside the permissions module, and the ban
 * is right even where the branch is only copy.
 *
 * The two org kinds share their entries: a sending church's Admin and a
 * network's Admin do the same things over a different portfolio.
 */
const SEAT_CHOICE_COPY = {
  church: {
    member: "Member — takes part in the work",
    admin: "Admin — can run the plant with you",
  },
  sending_church: {
    member: "Member — reads everything, changes nothing",
    admin: "Admin — reads everything and can invite others",
  },
  network: {
    member: "Member — reads everything, changes nothing",
    admin: "Admin — reads everything and can invite others",
  },
} as const satisfies Record<SeatTenancyType, Record<InvitableSeat, string>>;

export function SeatInviteForm({
  expiryDays,
  tenancyType,
}: {
  expiryDays: number;
  /**
   * WHICH KIND OF TEAM IS BEING STAFFED. The form posts no tenancy — the server
   * takes the actor's own — so this decides copy only, and the words it picks
   * are the ones the invitation email will repeat.
   */
  tenancyType: SeatTenancyType;
}) {
  const noun = TENANCY_NOUN[tenancyType];
  const seatCopy = SEAT_CHOICE_COPY[tenancyType];

  const [state, formAction, pending] = useActionState(
    createSeatInvitationAction,
    initialState
  );
  // Controlled so a refused submit — a duplicate, an address that already has
  // an account — keeps what was typed instead of clearing it.
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [seat, setSeat] = useState<InvitableSeat>("member");

  return (
    <section aria-labelledby="team-invite-seat">
      <SettingsBlock>
        <SettingsHeading
          id="team-invite-seat"
          description={`They get an email with a link to create their EveryField account and join this ${noun}. The link only works for the address you type, and only for someone who does not already have an account.`}
        >
          Invite someone to your team
        </SettingsHeading>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <p
              id="inviteeEmail-error"
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
            >
              {state.error}
            </p>
          )}

          {state.created && <InviteCreatedNotice created={state.created} />}

          {/* @md and not sm: the section is a container query root, and this
              grid answers to the PANE it sits in — about 472–592px from `md`
              up — not to the viewport behind it. */}
          <div className="grid gap-4 @md:grid-cols-[1fr_auto] @md:items-end">
            <div className="space-y-2">
              <Label htmlFor="inviteeEmail">Email address</Label>
              <Input
                id="inviteeEmail"
                name="inviteeEmail"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="teammate@example.com"
                required
                value={inviteeEmail}
                onChange={(event) => setInviteeEmail(event.target.value)}
                aria-invalid={Boolean(state.error)}
                aria-describedby={
                  state.error ? "inviteeEmail-error" : undefined
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seat">Seat</Label>
              {/*
                The Select is a client widget, so the value it holds is mirrored
                into a hidden input for the form POST — a plain `name` on the
                trigger would not be submitted.
              */}
              <input type="hidden" name="seat" value={seat} />
              <Select
                value={seat}
                onValueChange={(value) => setSeat(value as InvitableSeat)}
              >
                <SelectTrigger
                  id="seat"
                  className="w-full cursor-pointer @md:w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member" className="cursor-pointer">
                    {seatCopy.member}
                  </SelectItem>
                  <SelectItem value="admin" className="cursor-pointer">
                    {seatCopy.admin}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
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

/**
 * What the inviter reads once the row exists — the shared three states, so this
 * surface and the oversight one cannot drift into two vocabularies for the same
 * outcome. This component decides only EMPHASIS.
 */
function InviteCreatedNotice({
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
        // The attention scale's MEDIUM step, not destructive: the invitation
        // was CREATED. It is the repo's caution treatment — the same tokens and
        // the same alphas the phase engine paints "worth a look" with — and it
        // says "there is something left for you to do", not "this failed".
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
