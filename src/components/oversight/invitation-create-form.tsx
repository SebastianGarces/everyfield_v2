"use client";

// ============================================================================
// Create an invitation — the form half of /oversight/invitations (OV-003).
//
// Two fields, and the second only for a network admin:
//
//   * the invitee's EMAIL. There is no picker of existing church plants, on
//     purpose: an oversight admin sees only the plants their org is associated
//     with, so a dropdown of invitable plants would list every plant in the
//     product to every org. The server resolves the address privately, and
//     since #304 an address that already has an account is a legitimate target
//     — there is now somewhere in the product for that person to answer from
//     (`/settings/association`). NEITHER OUTCOME IS REPORTED: the refusal is
//     always the same sentence (`ACCOUNT_NOT_INVITABLE_MESSAGE`) and, since
//     ruling 4 item 5, so is the success notice. See `InviteCreatedNotice`.
//   * what kind of organization they are. A sending church can only invite
//     church plants, so it has no choice to make and the field is not rendered.
//
// There is NO expiry field. RULED 2026-08-03 (#265 r2, restated on #23): the
// window is server-fixed. Do not add one back without a ruling.
// ============================================================================

import { useActionState, useState } from "react";

import {
  createInvitationAction,
  type CreateInvitationState,
} from "@/app/(dashboard)/oversight/invitations/actions";
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

const initialState: CreateInvitationState = {};

type InviteAs = "church" | "sending_church";

export function InvitationCreateForm({
  canInviteSendingChurches,
  expiryDays,
}: {
  canInviteSendingChurches: boolean;
  expiryDays: number;
}) {
  const [state, formAction, pending] = useActionState(
    createInvitationAction,
    initialState
  );
  // Controlled so a refused submit — an occupied slot, a duplicate — keeps what
  // the admin already typed instead of clearing it.
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [inviteAs, setInviteAs] = useState<InviteAs>("church");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite an organization</CardTitle>
        <CardDescription>
          Send an invitation to a church planter&rsquo;s email address. They
          decide whether to accept — nothing is associated until they do.
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
                placeholder="planter@example.com"
                required
                value={inviteeEmail}
                onChange={(event) => setInviteeEmail(event.target.value)}
                aria-invalid={Boolean(state.error)}
              />
            </div>

            {canInviteSendingChurches && (
              <div className="space-y-2">
                <Label htmlFor="inviteAs">Inviting</Label>
                {/*
                  The Select is a client widget, so the value it holds is
                  mirrored into a hidden input for the form POST — a plain
                  `name` on the trigger would not be submitted.
                */}
                <input type="hidden" name="inviteAs" value={inviteAs} />
                <Select
                  value={inviteAs}
                  onValueChange={(value) => setInviteAs(value as InviteAs)}
                >
                  <SelectTrigger
                    id="inviteAs"
                    className="w-full cursor-pointer sm:w-56"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="church" className="cursor-pointer">
                      A church plant
                    </SelectItem>
                    <SelectItem
                      value="sending_church"
                      className="cursor-pointer"
                    >
                      A sending church
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
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
 * What the admin reads once the row exists — ONE message, whatever was created.
 *
 * ----------------------------------------------------------------------------
 * RULED 2026-08-09 (#304 ruling 4, item 5): reword, never assert existence
 * ----------------------------------------------------------------------------
 *
 * There used to be two notices. One said "they already have an EveryField
 * account, so there is no link to send"; the other handed over a
 * `/register?invitation=…` URL with a Copy button. Between them they answered,
 * for any address an admin cared to type, the single question ruling 2 spent
 * the whole refusal vocabulary hiding: does this person have an account? A
 * collapsed refusal and a branching success are not a closed oracle — they are
 * a closed one and an open one, and the open one is the easier probe, because
 * it needs no error at all.
 *
 * So both cases render this, and it is true of both: an invitation is answered
 * inside the product. It names no account, no organization and no link.
 *
 * WHAT THE ADMIN LOSES, and why it is acceptable. An open invitation's token
 * still works — `/register?invitation=<id>` is untouched, and it is what the
 * invitation EMAIL will carry when delivery ships. What is gone is the admin
 * hand-forwarding that URL out of band, which was a stopgap for the missing
 * email and cost an account-existence disclosure on every successful invite.
 * Do not reintroduce a link here without a ruling that supersedes item 5.
 */
function InviteCreatedNotice({
  created,
}: {
  created: NonNullable<CreateInvitationState["created"]>;
}) {
  return (
    <div
      role="status"
      className="border-primary/30 bg-primary/5 space-y-1 rounded-md border p-3 text-sm"
    >
      <p className="font-medium">
        Invitation created for {created.inviteeEmail}
      </p>
      <p className="text-muted-foreground">
        This invitation is answered inside EveryField. You will hear as soon as
        they answer; until then it sits in the list below, where you can revoke
        it.
      </p>
    </div>
  );
}
