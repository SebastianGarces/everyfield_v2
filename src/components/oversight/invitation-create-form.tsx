"use client";

// ============================================================================
// Create an invitation — the form half of /oversight/invitations (OV-003).
//
// Two fields, and the second only for a network admin:
//
//   * the invitee's EMAIL. There is no picker of existing church plants, on
//     purpose: an oversight admin sees only the plants their org is associated
//     with, so a dropdown of invitable plants would list every plant in the
//     product to every org. The server resolves the address privately — and
//     since 2026-08-04 an address that already has an account is REFUSED there,
//     because nothing in the product lets that person answer yet (#277). The
//     copy below says so before the admin types, and the refusal says so after.
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
          Invitations go to people who have not signed up yet; an address that
          already has an EveryField account cannot be invited.
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
 * What the admin reads once the row exists — and it BRANCHES on whether the
 * invitation email actually went out (OV-003b / #293).
 *
 * Before #293 nothing left the building, so this notice always handed the link
 * over with "send them this link". Now the create sends, and a single unbranched
 * message would be wrong in both directions: on a successful send it tells the
 * admin to go do the delivery themselves, and on a failed send it says nothing
 * at all, so the two cases read identically. An admin who cannot tell them apart
 * either duplicates a message the invitee already has, or believes an invitation
 * arrived that never did.
 *
 * The three states and their words come from `invitationCreatedNotice`
 * (`@/lib/invitations/create-notice`) rather than from JSX, so the sentence the
 * acceptance criterion names is executable and asserted. This component decides
 * only EMPHASIS: the link block is quiet when the email carries it and prominent
 * when the admin has to send it. It is never hidden — "sent" is a provider
 * acceptance, not a delivery receipt.
 */
function InviteCreatedNotice({
  created,
}: {
  created: NonNullable<CreateInvitationState["created"]>;
}) {
  const [copied, setCopied] = useState(false);
  const notice = invitationCreatedNotice({
    inviteeEmail: created.inviteeEmail,
    emailSent: created.emailSent,
  });
  const failed = notice.state === "not_sent";
  const url =
    typeof window === "undefined"
      ? created.inviteePath
      : `${window.location.origin}${created.inviteePath}`;

  return (
    <div
      role="status"
      className={
        // Amber, not destructive: the invitation was CREATED. This is the
        // repo's caution treatment (`status-confirmation-modal.tsx`) — "there
        // is something left for you to do", not "this failed".
        failed
          ? "space-y-2 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/20"
          : "border-primary/30 bg-primary/5 space-y-2 rounded-md border p-3 text-sm"
      }
    >
      <p className="font-medium">{notice.headline}</p>
      <p className="text-muted-foreground">{notice.detail}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className={
            notice.linkIsBackup
              ? "bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded px-2 py-1 text-xs"
              : "bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs"
          }
        >
          {url}
        </code>
        <Button
          type="button"
          variant={notice.linkIsBackup ? "ghost" : "outline"}
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
    </div>
  );
}
