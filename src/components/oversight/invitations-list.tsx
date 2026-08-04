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
// What a row deliberately does NOT carry: the inviter's user id. Only the
// original inviter may revoke, so the page decides `canRevoke` server-side
// from the session rather than shipping an id for the client to compare — the
// same narrowing `invitationView` applies to what the actions return.
// ============================================================================

import { useActionState, useState } from "react";

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
  /** No target row yet — the invitee redeems this one by registering. */
  isOpen: boolean;
  sentLabel: string;
  expiresLabel: string | null;
  canRevoke: boolean;
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
            Waiting on an answer. Revoking one closes it immediately — the link
            stops working.
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
        {row.status === "pending" && row.isOpen && (
          <CopyInviteLinkButton invitationId={row.id} />
        )}
        {row.status === "pending" && row.canRevoke && (
          <RevokeButton invitationId={row.id} email={row.inviteeEmail} />
        )}
      </div>
    </li>
  );
}

function CopyInviteLinkButton({ invitationId }: { invitationId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="cursor-pointer"
      onClick={async () => {
        await navigator.clipboard.writeText(
          `${window.location.origin}/register?invitation=${invitationId}`
        );
        setCopied(true);
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
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
