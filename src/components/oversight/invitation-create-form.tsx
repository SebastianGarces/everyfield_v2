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
// Pure copy, no imports of its own — safe to pull into a client bundle, and the
// reason the sentence #293's AC names is executable rather than JSX.
import { invitationCreatedNotice } from "@/lib/invitations/create-notice";
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
 * So both cases render this, and it is true of both. It names no account, no
 * organization and no link.
 *
 * ----------------------------------------------------------------------------
 * DELIVERY-NEUTRAL, TOO (#304 round 10, RULED 2026-08-11)
 * ----------------------------------------------------------------------------
 *
 * The previous wording — "This invitation is answered inside EveryField. You
 * will hear as soon as they answer" — was false for half its audience. An
 * address with no account has nobody inside the product to answer: the only
 * route to that row is `/register?invitation=<id>`, and item 5 removed the one
 * surface that ever showed it. The admin was told to wait for an answer nobody
 * could give.
 *
 * The ruling names exactly two things to say, and both are true whatever is
 * behind the address: the invitation SITS IN THE LIST BELOW and can be revoked
 * there, and the admin should TELL THE PERSON DIRECTLY. Deliberately absent:
 * any statement about delivery mechanics. Saying "email is not live yet" would
 * be true today and false the week PR #392 ships, and the copy must not need
 * re-reading then. Also absent, permanently: anything derived from the row's
 * two target columns (item 5 stands).
 *
 * WHAT THE ADMIN LOSES, and why it is acceptable. An open invitation's token
 * still works — `/register?invitation=<id>` is untouched, and it is what the
 * invitation EMAIL will carry when delivery ships. What is gone is the admin
 * hand-forwarding that URL out of band, which was a stopgap for the missing
 * email and cost an account-existence disclosure on every successful invite.
 * Do not reintroduce a link here without a ruling that supersedes item 5.
 *
 * ----------------------------------------------------------------------------
 * DELIVERY IS LIVE NOW, AND THE LINK STILL DOES NOT COME BACK (OV-003b / #293,
 * reconciled 2026-08-12)
 * ----------------------------------------------------------------------------
 *
 * The paragraph above named this week: the copy was written delivery-neutral so
 * it would not need re-reading when #392 shipped, and the link it removed was
 * "a stopgap for the missing email". #392 is that email, so the stopgap is
 * simply not needed — a create whose send was refused is recovered with
 * **Resend email** on the row itself, one section below, which needs no URL on
 * screen and no account-existence disclosure to work.
 *
 * WHAT DOES BRANCH is whether the email went out, and only that. A single
 * unbranched message would be wrong in both directions: on a successful send it
 * would leave the admin doing a delivery that already happened, and on a failed
 * send it would say nothing at all, so the two cases read identically. That is
 * NOT the item-5 oracle — `emailSent` reports what the mail provider said,
 * which is the same question for an address with an account and one without,
 * and it is derived from neither target column.
 *
 * The three states and their words come from `invitationCreatedNotice`
 * (`@/lib/invitations/create-notice`) rather than from JSX, so the sentence
 * #293's acceptance criterion names is executable and asserted. This component
 * decides only EMPHASIS.
 */
function InviteCreatedNotice({
  created,
}: {
  created: NonNullable<CreateInvitationState["created"]>;
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
        // Amber, not destructive: the invitation was CREATED. This is the
        // repo's caution treatment (`status-confirmation-modal.tsx`) — "there
        // is something left for you to do", not "this failed".
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
