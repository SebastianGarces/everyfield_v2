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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { invitationCreatedNotice } from "@/lib/invitations/create-notice";

const initialState: CreateSeatInvitationState = {};

export function SeatInviteForm({ expiryDays }: { expiryDays: number }) {
  const [state, formAction, pending] = useActionState(
    createSeatInvitationAction,
    initialState
  );
  // Controlled so a refused submit — a duplicate, an address that already has
  // an account — keeps what was typed instead of clearing it.
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [seat, setSeat] = useState<InvitableSeat>("member");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone to your team</CardTitle>
        <CardDescription>
          They get an email with a link to create their EveryField account and
          join this plant. The link only works for the address you type, and
          only for someone who does not already have an account.
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          {state.error && (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
            >
              {state.error}
            </p>
          )}

          {state.created && <InviteCreatedNotice created={state.created} />}

          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
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
                  className="w-full cursor-pointer sm:w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member" className="cursor-pointer">
                    Member — takes part in the work
                  </SelectItem>
                  <SelectItem value="admin" className="cursor-pointer">
                    Admin — can run the plant with you
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
        </CardContent>
      </form>
    </Card>
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
        // Amber, not destructive: the invitation was CREATED. The repo's
        // caution treatment — "there is something left for you to do", not
        // "this failed".
        failed
          ? "space-y-1 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/20"
          : "border-primary/30 bg-primary/5 space-y-1 rounded-md border p-3 text-sm"
      }
    >
      <p className="font-medium">{notice.headline}</p>
      <p className="text-muted-foreground">{notice.detail}</p>
    </div>
  );
}
