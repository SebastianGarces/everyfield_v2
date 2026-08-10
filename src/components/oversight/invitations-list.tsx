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
// ============================================================================

import { useActionState, useEffect, useState } from "react";

import {
  resendInvitationEmailAction,
  revokeInvitationAction,
  type ResendInvitationEmailState,
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
// Import-free by construction, so a client component may hold the same
// `?invitation=` contract the email does without dragging the Resend SDK into
// this chunk (`@/lib/invitations/register-path` explains why it is its own
// file). Never re-spell the query string here.
import { invitationRegisterPath } from "@/lib/invitations/register-path";
// The other import-free leaf on this path, and imported for the same reason:
// the cooldown arithmetic is shared with the provider dedupe key, and the module
// that builds that key reaches the Resend SDK. `@/lib/invitations/resend-window`
// imports nothing at all, so the browser gets the two functions and no client.
import {
  resendCooldownLabel,
  resendCooldownSecondsLeft,
} from "@/lib/invitations/resend-window";

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
            can resend the email or revoke the invitation — revoking closes it
            immediately, and the link stops working.
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
      {/* WRAPS, and that is load-bearing rather than cosmetic. The cluster holds
          up to four controls plus an inline refusal, and the row is 292px wide
          on a 390px phone: without `flex-wrap` the overflow is CLIPPED, not
          scrolled (the page's own scrollWidth stays 390), so a control pushed
          past the edge is not merely awkward — it is unreachable. Measured
          before this class existed: Revoke sat at right=411, and with the
          longest refusal rendered Resend went with it at right=406, which took
          away both buttons the failure message tells the admin to press. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        {row.status === "pending" && row.isOpen && (
          <CopyInviteLinkButton invitationId={row.id} />
        )}
        {/* Pending only, and the same rule as Revoke: a resend of an answered
            invitation is refused by the guard inside `sendInvitationEmail`
            anyway, but offering it would be a lie. */}
        {row.status === "pending" && (
          <ResendEmailButton invitationId={row.id} email={row.inviteeEmail} />
        )}
        {row.status === "pending" && (
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
          `${window.location.origin}${invitationRegisterPath(invitationId)}`
        );
        setCopied(true);
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

const initialResendState: ResendInvitationEmailState = {};

type ResendCooldown = NonNullable<ResendInvitationEmailState["cooldown"]>;

/**
 * Seconds left before the Resend button means anything again — RULED 2026-08-10
 * round 2 (#392 / #293).
 *
 * DURATIONS, NEVER INSTANTS. The action reports how much of the provider's
 * dedupe bucket was left when it answered; this hook subtracts how long it has
 * been counting since. No epoch instant crosses to the browser and none is
 * compared here, so a workstation clock minutes out of step is not a factor —
 * the wait is the right LENGTH whatever the machine believes the time is.
 *
 * THE FIRST RENDER ALREADY REFUSES. `elapsed` belongs to the window it was
 * measured against, so a window it has not started counting yet is used at full
 * length, straight from the server's number — the button is disabled in the same
 * commit that reports the send, with no frame in between where a second press
 * would land. That is why the reset is a comparison during render rather than an
 * effect that sets state after paint.
 *
 * `windowIndex` is IDENTITY, not arithmetic: two successes inside one bucket
 * report one index, so a second admin's send lands on the countdown already
 * running rather than restarting it, and a genuinely later send is a different
 * index and a fresh one. Keying on "did the action state change" would restart
 * it on every submit, including the refusals.
 *
 * The `useEffect` here is a TIMER, not data synchronization
 * (memory/contracts/data-patterns.md): it subscribes to the clock, an external
 * system, and touches nothing the server owns. Nothing about the invitation is
 * in local state — the row is still props, and the outcome is still the
 * transient action result.
 */
function useResendCooldown(cooldown: ResendCooldown | undefined): number {
  const windowIndex = cooldown?.window;
  const remainingMs = cooldown?.remainingMs ?? 0;

  const [elapsed, setElapsed] = useState<{
    window: number | undefined;
    ms: number;
  }>({ window: undefined, ms: 0 });

  useEffect(() => {
    if (remainingMs <= 0) return;

    // The one reading of the clock, and it starts here rather than at render:
    // an effect may be impure, a render may not
    // (react.dev → components-and-hooks-must-be-pure).
    const startedAtMs = Date.now();

    // Nothing is reset here, and nothing needs to be: `elapsed` carries the
    // window it was measured against, so until the first tick lands the render
    // below already reads a new window as "none of it spent".
    //
    // Twice a second, so the label is never more than half a second stale, and
    // the timer stops itself the moment the window is spent rather than ticking
    // for the life of the page.
    const timer = setInterval(() => {
      const ms = Date.now() - startedAtMs;
      setElapsed({ window: windowIndex, ms });
      if (ms >= remainingMs) clearInterval(timer);
    }, 500);

    return () => clearInterval(timer);
  }, [windowIndex, remainingMs]);

  const countedMs = elapsed.window === windowIndex ? elapsed.ms : 0;
  return resendCooldownSecondsLeft(remainingMs - countedMs);
}

/**
 * "Resend email" — RULED 2026-08-10 (#392 / #293), amended the same day.
 *
 * The invitation email is best-effort at create time, and until this button
 * existed a failed send was recoverable only for the seconds the create notice
 * was on screen. Nothing is persisted by the ruling, so this row still cannot
 * TELL you a send failed; it lets you fix it once you know, and it is equally
 * the answer to "they say it never arrived".
 *
 * The outcome is transient by design — the send either happened or it did not,
 * and the next render of this page starts from no claim at all rather than from
 * a remembered one the product cannot actually stand behind.
 *
 * ROUND 2: AFTER A SEND THE BUTTON REFUSES FOR THE REST OF THE DEDUPE WINDOW,
 * and says how long that is. The window is kept — it is the double-click guard,
 * and the two-admins-on-one-page guard — but round 1 left the button live inside
 * it, so a second press returned "Email sent" while the provider collapsed the
 * message onto the one it had already accepted. The product must never claim a
 * send the provider will drop, so the control is unavailable for exactly as long
 * as that claim would be false, and the label counts the wait down instead of
 * leaving the admin to guess.
 *
 * NATIVE `disabled`, not `aria-disabled`: the send genuinely cannot happen, so
 * the platform behaviour — out of the tab order, unclickable, dimmed, no
 * submission — is the honest one, and it is the only guard that no submission
 * path (click, Enter, implicit) can get around. The countdown lives in the
 * button's own label rather than in the `role="status"` region next to it: that
 * region says "Email sent" ONCE, and a live region re-announcing a number every
 * second would make this row unusable with a screen reader.
 */
function ResendEmailButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(
    resendInvitationEmailAction,
    initialResendState
  );
  const secondsLeft = useResendCooldown(state.cooldown);
  const cooling = secondsLeft > 0;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      {state.error && (
        <span role="alert" className="text-destructive text-xs">
          {state.error}
        </span>
      )}
      {state.sent && !pending && (
        <span role="status" className="text-muted-foreground text-xs">
          Email sent
        </span>
      )}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        // `cursor-pointer` per the repo rule; `disabled:pointer-events-none` on
        // the Button itself is what keeps it off a control that cannot be
        // pressed. `tabular-nums` so a shrinking countdown does not jog the
        // row's other controls sideways every second.
        className="cursor-pointer tabular-nums"
        disabled={pending || cooling}
      >
        {pending
          ? "Sending…"
          : cooling
            ? resendCooldownLabel(secondsLeft)
            : "Resend email"}
        <span className="sr-only"> to {email}</span>
      </Button>
    </form>
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
