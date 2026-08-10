"use client";

// ============================================================================
// The sent/pending invitations list — /oversight/invitations (OV-003).
//
// Presentational and fully serializable: every row arrives pre-shaped by the
// page, including its dates as STRINGS formatted against `APP_TIME_ZONE`
// (memory/invariants.md → Date & Time Rendering — a Date formatted in the
// browser's zone and again on the server produces two different strings and a
// hydration mismatch).
//
// What a row deliberately does NOT carry: the inviter's user id — the same
// narrowing `invitationView` applies to what the actions return. It used to
// come through as a per-row `canRevoke`; RULED 2026-08-04 that revoke is scoped
// to the inviting ORG, exactly like the list this page reads, so any admin who
// can see a pending row may close it and there is nothing left for the client
// to compare. The authority check itself is in the UPDATE, never here.
//
// ----------------------------------------------------------------------------
// AND IT CARRIES NO `isOpen` — #304 ruling 4 item 5, extended to THIS LIST
// (2026-08-09, on the integration verdict that rejected the first attempt)
// ----------------------------------------------------------------------------
//
// A row used to arrive with `isOpen` — `targetChurchId === null &&
// targetSendingChurchId === null` — and rendered a "Copy link"
// (`/register?invitation=<id>`) button if and only if it was true. Those two
// columns ARE the server's answer to "does this address already have an
// EveryField account", so the button's presence answered it in the UI.
//
// That was dead code until this track: `resolveInvitationTarget` used to refuse
// every address that already had an account, so every creatable invitation was
// open and every pending row showed the button. #304 revives the targeted path,
// which makes the conditional live — and puts the probe one section BELOW the
// create form on the same page. Type an address, read the deliberately neutral
// success notice, then look at the row that just appeared: Copy link means no
// account, no Copy link means there is one. No error, no second request.
//
// So the flag does not cross the wire and the control is gone. Item 5 collapsed
// the notice for exactly this reason and the same sentence applies here: two
// shapes crossing the wire is an oracle whether or not a component renders the
// difference, and this component did render it.
//
// WHY NOT "show the link on every pending row" (the variant that keeps
// delivery): it does not close the oracle, it relocates it. `/register` renders
// an invitation-specific banner only when `describeInvitationForRegistration`
// says `redeemable` — itself target-derived — so an admin who copies the link
// and opens it reads the same fact one click later, and a targeted invitee is
// handed a URL that redeems nothing. See memory/invariants/multi-tenancy.md.
// ============================================================================

import { useActionState } from "react";

import {
  revokeInvitationAction,
  type RevokeInvitationState,
} from "@/app/(dashboard)/oversight/invitations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked";

export type InvitationListRow = {
  id: string;
  inviteeEmail: string;
  kindLabel: string;
  status: InvitationStatus;
  sentLabel: string;
  expiresLabel: string | null;
};

const STATUS_STYLE: Record<
  InvitationStatus,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
  }
> = {
  pending: { label: "Pending", variant: "default" },
  accepted: { label: "Accepted", variant: "secondary" },
  // Declined is a real answer, not a failure — OV-006 requires it to stay
  // visible on this list rather than vanishing.
  declined: { label: "Declined", variant: "outline" },
  expired: { label: "Expired", variant: "outline" },
  revoked: { label: "Revoked", variant: "outline" },
};

export function InvitationsList({ rows }: { rows: InvitationListRow[] }) {
  const pending = rows.filter((row) => row.status === "pending");
  const answered = rows.filter((row) => row.status !== "pending");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>
            Waiting on an answer. Anyone who can invite for your organization
            can revoke one, which closes it immediately — the invitation stops
            working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No invitations are waiting for an answer.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {pending.map((row) => (
                <InvitationRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Answered and closed</CardTitle>
          <CardDescription>
            Every invitation your organization has sent that is no longer open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {answered.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nothing here yet.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {answered.map((row) => (
                <InvitationRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InvitationRow({ row }: { row: InvitationListRow }) {
  const status = STATUS_STYLE[row.status];

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium">{row.inviteeEmail}</p>
        <p className="text-muted-foreground text-xs">
          {row.kindLabel} · Sent {row.sentLabel}
          {row.expiresLabel ? ` · Expires ${row.expiresLabel}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        {row.status === "pending" && (
          <RevokeButton invitationId={row.id} email={row.inviteeEmail} />
        )}
      </div>
    </li>
  );
}

const initialRevokeState: RevokeInvitationState = {};

function RevokeButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(
    revokeInvitationAction,
    initialRevokeState
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      {state.error && (
        <span role="alert" className="text-destructive text-xs">
          {state.error}
        </span>
      )}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive cursor-pointer"
        disabled={pending}
      >
        {pending ? "Revoking…" : "Revoke"}
        <span className="sr-only"> the invitation to {email}</span>
      </Button>
    </form>
  );
}
