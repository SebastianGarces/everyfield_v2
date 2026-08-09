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
//     (`/settings/association`). Which of the two kinds was created is the one
//     thing the success notice branches on; the refusal, whatever its reason,
//     is always the same sentence (`ACCOUNT_NOT_INVITABLE_MESSAGE`).
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
          decide whether to accept — nothing is associated until they do. An
          address that has not signed up yet gets a link that creates their
          account; a planter who is already here answers it in their own
          settings.
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
 * What to do next, shown once the row exists — and there are TWO next things,
 * because since #304 there are two kinds of invitation.
 *
 * Email delivery is not part of this surface yet, so an OPEN invitation's link
 * is handed to the admin rather than implied: telling somebody an invitation
 * was "sent" when nothing left the building is the kind of copy that costs a
 * user a week.
 *
 * A TARGETED invitation gets NO LINK AT ALL (#304, HR4 2026-08-09). The
 * addressee already has an EveryField account, `/register` is the one place
 * that link goes, and somebody who has registered cannot register again — so
 * the Copy button used to hand an admin a dead end to forward, and the invitee
 * a page that would refuse them. The action reports the difference as a null
 * `inviteePath` (see `CreateInvitationState`), which is the whole of the branch
 * below: the admin is told where the answer will happen instead of being given
 * something useless to send.
 */
function InviteCreatedNotice({
  created,
}: {
  created: NonNullable<CreateInvitationState["created"]>;
}) {
  return (
    <div
      role="status"
      className="border-primary/30 bg-primary/5 space-y-2 rounded-md border p-3 text-sm"
    >
      <p className="font-medium">
        Invitation created for {created.inviteeEmail}
      </p>
      {created.inviteePath === null ? (
        <p className="text-muted-foreground">
          They already have an EveryField account, so there is no link to send:
          the invitation is waiting for them in their own settings and on their
          dashboard. You will hear as soon as they answer, and until then it
          sits in the list below, where you can revoke it.
        </p>
      ) : (
        <InviteLink path={created.inviteePath} />
      )}
    </div>
  );
}

/** The register link for an OPEN invitation, with a copy control. */
function InviteLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  // `window` is absent on the server render, where the origin is unknown and a
  // relative path is the honest thing to show.
  const url =
    typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  return (
    <>
      <p className="text-muted-foreground">
        Send them this link. It carries the invitation, so the plant they create
        arrives already associated with you — and it only works for the address
        above, so if that is wrong, revoke this invitation and send a new one.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </>
  );
}
