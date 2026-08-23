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
// AND IT CARRIES NO `kindLabel` EITHER — the same ruling, extended a second
// time (2026-08-10, on the verdict that rejected the attempt above). Removing
// `isOpen` left the oracle standing ONE FIELD OVER: the row's caption read
// `invitation.type === "sending_church_to_network" ? "Sending church" :
// "Church plant"`, and `type` is target-derived too (core.ts picks the kind
// from the RESOLVED target and falls back to the admin's `inviteAs` only when
// there is no target). So the caption matched the admin's own selection for an
// accountless address and flipped for an address holding an account of the
// other kind — the identical probe, in a caption instead of a button.
//
// The row shape now lives in `@/lib/invitations/list-row`, as one exported pure
// function, so §9b can CALL it for both target shapes and compare the results
// rather than grep this file for field names. Every regex that guarded the
// previous two attempts passed while the property was false.
//
// WHY NOT "show the link on every pending row" (the variant that keeps
// delivery): it did not close the oracle, it relocated it — `/register` used to
// render an invitation banner only when `describeInvitationForRegistration`
// said `redeemable`, itself target-derived, so an admin who copied the link and
// opened it read the same fact one click later. That relocation is now closed
// AT `/register` ITSELF (round 10, ruled 2026-08-11): the function answers null
// for any targeted row and `redeemable` is deleted, so a targeted token and a
// guessed uuid render the identical page. The link still does not belong here —
// a targeted invitee would be handed a URL that redeems nothing, and item 5
// stands — but the reason is no longer "it leaks". See
// memory/invariants/multi-tenancy.md.
//
// ----------------------------------------------------------------------------
// WHAT A PENDING ROW CARRIES INSTEAD: "Resend email" (OV-003b / #293, ruled
// 2026-08-10, reconciled with the above 2026-08-12)
// ----------------------------------------------------------------------------
//
// The Copy-link button item 5 deleted was the admin's only way to get an
// invitation in front of somebody, and the ruling said as much — it called that
// link "a stopgap for the email delivery that has not shipped". #293 shipped the
// delivery, so the row's control is now the one that USES it: press Resend and
// the server sends, which needs no URL on screen and answers nothing about the
// address. It is shown on EVERY pending row, never a subset, so its presence
// derives from `status` alone and reintroduces no oracle — `isOpen` is exactly
// the field that is gone.
//
// The countdown after a send is round 2 of the same ruling, and its per-session
// limit is an accepted residual ruled 2026-08-12 (option (a) on PR #392). See
// `useResendCooldown` for what it cannot reach and why nothing here closes it.
//
// ----------------------------------------------------------------------------
// THE CONTAINER IS THE CALLER'S, THE CONTENTS ARE NOT (2026-08-23 review)
// ----------------------------------------------------------------------------
//
// This list renders on two surfaces with different container norms: a full page
// at `/oversight/invitations`, where `Card` IS the surrounding density, and the
// settings modal's Team pane, where every other block is a `SettingsBlock` at a
// tighter density inside a `rounded-lg` dialog. Hard-coding either one leaves
// the other with a container that reads as a different rank of thing than its
// neighbours, which is the defect the review found in the Team pane.
//
// So `container` is ONE prop and the ONE place the choice is made — the two
// shapes live side by side in `InvitationPanel` rather than as two JSX trees
// through this file. Everything else is identical on both surfaces, which is
// the point: the rows, the countdown, the accessible names and the four states
// this component spent three rulings getting right do not fork.
// ============================================================================

import { useActionState, useEffect, useId, useRef, useState } from "react";

import {
  resendInvitationEmailAction,
  revokeInvitationAction,
  type ResendInvitationEmailState,
  type RevokeInvitationState,
} from "@/app/(dashboard)/oversight/invitations/actions";
// The org surface's own actions are the DEFAULT below and nothing more. A
// second caller — `/settings/team`, whose rows are seat invitations over
// `user_invitations` (#495) — passes its own pair, so the countdown, the
// wrapping cluster, the accessible names and the four states this component
// spent three rulings getting right are written ONCE. Both tables answer the
// same two questions on a pending row ("email it again", "close it"), so the
// component's contract is those two verbs and not either table.
import {
  SettingsBlock,
  SettingsHeading,
} from "@/components/settings/settings-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { InvitationListRow } from "@/lib/invitations/list-row";
// An import-free leaf, and imported for that reason: the cooldown arithmetic is
// shared with the provider dedupe key, and the module that builds that key
// reaches the Resend SDK. `@/lib/invitations/resend-window` imports nothing at
// all, so the browser gets these functions and no client.
import {
  resendCooldownLabel,
  resendCooldownRemainingMs,
  resendCooldownSecondsLeft,
} from "@/lib/invitations/resend-window";

export type { InvitationListRow };

type InvitationStatus = InvitationListRow["status"];

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

/**
 * The two writes a pending row offers. Passed in rather than imported so this
 * component serves both invitation surfaces; each caller's own action module
 * carries the `requireSeat` guard for its own capability, and neither is
 * decided here.
 */
export type InvitationRowActions = {
  resend: (
    prevState: ResendInvitationEmailState,
    formData: FormData
  ) => Promise<ResendInvitationEmailState>;
  revoke: (
    prevState: RevokeInvitationState,
    formData: FormData
  ) => Promise<RevokeInvitationState>;
};

const ORG_INVITATION_ACTIONS: InvitationRowActions = {
  resend: resendInvitationEmailAction,
  revoke: revokeInvitationAction,
};

/** Which surface's density the two panels take — see the header. */
export type InvitationsListContainer = "card" | "block";

export function InvitationsList({
  rows,
  container = "card",
  canAct = true,
  actions = ORG_INVITATION_ACTIONS,
  pendingDescription = "Waiting on an answer. Anyone who can invite for your organization can resend the email or revoke the invitation — revoking closes it immediately, and the invitation stops working.",
  answeredDescription = "Every invitation your organization has sent that is no longer open.",
}: {
  rows: InvitationListRow[];
  /**
   * `card` is the full page's density and the default, so `/oversight/invitations`
   * names nothing. `block` is the settings modal's, where these two panels are
   * the last of the pane's blocks and must match the four above them.
   */
  container?: InvitationsListContainer;
  /**
   * WHETHER THIS READER MAY RESEND OR REVOKE (#500).
   *
   * An org MEMBER reads the same invitation list its Owner does and may change
   * none of it (ruling 185 (3)), so the two controls are ABSENT for them rather
   * than present-and-refused. It is copy and layout only — `requireSeat` in each
   * action module is the refusal that holds for a POST that never saw this page
   * — but a control beside an action guaranteed to refuse it is the visible half
   * of a permission drift, and this list is the one place both surfaces render
   * it.
   */
  canAct?: boolean;
  actions?: InvitationRowActions;
  pendingDescription?: string;
  answeredDescription?: string;
}) {
  const pending = rows.filter((row) => row.status === "pending");
  const answered = rows.filter((row) => row.status !== "pending");

  // MINTED, NEVER WRITTEN DOWN. The Team pane renders this component TWICE —
  // seat invitations and coach invitations — so a pair of literal heading ids
  // would collide with each other on that one screen, and a prefix prop would
  // put the uniqueness back in the caller's hands. `useId` is stable across the
  // server render and the hydration that follows it, which is what an
  // `aria-labelledby` needs.
  const headingId = useId();

  return (
    <div className={container === "block" ? "space-y-8" : "space-y-6"}>
      <InvitationPanel
        container={container}
        id={`${headingId}-pending`}
        title="Pending invitations"
        description={pendingDescription}
      >
        {pending.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No invitations are waiting for an answer.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {pending.map((row) => (
              <InvitationRow
                key={row.id}
                row={row}
                canAct={canAct}
                actions={actions}
              />
            ))}
          </ul>
        )}
      </InvitationPanel>

      <InvitationPanel
        container={container}
        id={`${headingId}-answered`}
        title="Answered and closed"
        description={answeredDescription}
      >
        {answered.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Nothing here yet.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {answered.map((row) => (
              <InvitationRow
                key={row.id}
                row={row}
                canAct={canAct}
                actions={actions}
              />
            ))}
          </ul>
        )}
      </InvitationPanel>
    </div>
  );
}

/**
 * One titled panel, in whichever density the caller asked for.
 *
 * The whole of the difference between the two surfaces lives here, so a change
 * to what a panel HOLDS is made once. The settings shape carries the extra
 * `<section aria-labelledby>` and a real `<h2>` because the modal's panes are a
 * stack of blocks under one `DialogTitle` and need a navigable outline;
 * `/oversight/invitations` is a page with its own `<h1>` and keeps the
 * `CardTitle` div it has always had.
 */
function InvitationPanel({
  container,
  id,
  title,
  description,
  children,
}: {
  container: InvitationsListContainer;
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  if (container === "block") {
    return (
      <section aria-labelledby={id}>
        <SettingsBlock>
          <SettingsHeading id={id} description={description}>
            {title}
          </SettingsHeading>
          {children}
        </SettingsBlock>
      </section>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InvitationRow({
  row,
  canAct,
  actions,
}: {
  row: InvitationListRow;
  canAct: boolean;
  actions: InvitationRowActions;
}) {
  const status = STATUS_STYLE[row.status];

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium">{row.inviteeEmail}</p>
        <p className="text-muted-foreground text-xs">
          Sent {row.sentLabel}
          {row.expiresLabel ? ` · Expires ${row.expiresLabel}` : ""}
        </p>
      </div>
      {/* WRAPS, and that is load-bearing rather than cosmetic. The cluster holds
          the badge plus Resend and Revoke and an inline refusal, and the row is
          292px wide on a 390px phone: without `flex-wrap` the overflow is
          CLIPPED, not scrolled (the page's own scrollWidth stays 390), so a
          control pushed past the edge is not merely awkward — it is
          unreachable. Measured before this class existed: Revoke sat at
          right=411, and with the longest refusal rendered Resend went with it
          at right=406, which took away both buttons the failure message tells
          the admin to press. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        {/* Pending only, and the same rule as Revoke: a resend of an answered
            invitation is refused by the guard inside `sendInvitationEmail`
            anyway, but offering it would be a lie. */}
        {canAct && row.status === "pending" && (
          <ResendEmailButton
            invitationId={row.id}
            email={row.inviteeEmail}
            resend={actions.resend}
          />
        )}
        {canAct && row.status === "pending" && (
          <RevokeButton
            invitationId={row.id}
            email={row.inviteeEmail}
            revoke={actions.revoke}
          />
        )}
      </div>
    </li>
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
 * report one index, so a second send by this admin lands on the countdown
 * already running rather than restarting it, and a genuinely later send is a
 * different index and a fresh one. Keying on "did the action state change"
 * would restart it on every submit, including the refusals. The comparison
 * itself is `resendCooldownRemainingMs` in the leaf, where the four boundaries
 * — no cooldown, a window not yet counted, part way through, spent — are pinned
 * by test rather than left as the one untested line the button's honesty rests
 * on.
 *
 * WHAT THIS CANNOT DO, stated because the product must not imply otherwise:
 * the cooldown lives in `useActionState`, which is per client session by
 * design. A page reload, a second tab, or a SECOND ADMIN's browser mounts this
 * row with no cooldown, so the button is live even though the window is open,
 * and a press inside it reports "Email sent" over a message the provider
 * collapses onto the one already accepted. Closing that needs a durable record
 * of the last send keyed by invitation — exactly the persistence round 1 of the
 * ruling refused (no `email_sent` column, no migration, nothing stored about
 * delivery) — and the provider gives no replay signal to derive it from: an
 * idempotent replay returns the ORIGINAL response, so `sendEmail` cannot tell a
 * new message from a collapsed one. `resend.test.ts` §8 executes the case
 * rather than leaving it as prose. The guard therefore holds for the two things
 * one admin actually does — the double-click and the impatient second press —
 * and the window itself still protects the INVITEE's inbox in every case,
 * which is the half that was always about the provider.
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

  return resendCooldownSecondsLeft(
    resendCooldownRemainingMs(cooldown, elapsed)
  );
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
 * message onto the one it had already accepted. The control is now unavailable
 * for exactly as long as that claim would be false, and the label counts the
 * wait down instead of leaving the admin to guess — WITHIN ONE CLIENT SESSION,
 * which is as far as a cooldown with nothing persisted behind it can reach. See
 * `useResendCooldown` for what that leaves open and why nothing here can close
 * it.
 *
 * NATIVE `disabled`, not `aria-disabled`: the send genuinely cannot happen, so
 * the platform behaviour — out of the tab order, unclickable, dimmed, no
 * submission — is the honest one, and it is the only guard that no submission
 * path (click, Enter, implicit) can get around. The countdown lives in the
 * button's own label rather than in the `role="status"` region next to it: that
 * region says "Email sent" ONCE, and a live region re-announcing a number every
 * second would make this row unusable with a screen reader.
 *
 * …AND THE NATIVE `disabled` COSTS THE KEYBOARD ITS PLACE, which is what the
 * effect below buys back (PR #392 warning (b), fixed 2026-08-12). Measured on
 * the preview rather than reasoned about: focus the control, press Enter, and
 * `document.activeElement` afterwards is `<body>` — a disabled element cannot
 * hold focus, so the browser drops it to the document root and a keyboard or
 * switch user is thrown to the top of the page, several dozen Tabs away from
 * Revoke or the next row. Round 1 did not have this problem because the button
 * stayed enabled; it is a regression introduced by round 2's guard, and axe
 * cannot see it (0 violations in both states) because losing focus is not
 * itself a WCAG failure.
 *
 * THE REMEDY KEEPS THE NATIVE `disabled` and moves focus to the sentence that
 * says what happened: the `role="status"` span takes a `tabIndex={-1}` — which
 * makes it programmatically focusable WITHOUT adding it to the tab order — and
 * the effect focuses it on the transition into the sent state. Focus lands
 * inside the row on the outcome, and the next Tab reaches Revoke. The effect is
 * keyed on `state.sent` and `pending`, so it fires once per completed send and
 * not on mount (`state.sent` starts false) and not on every tick of the
 * countdown (neither dependency changes while it runs).
 */
function ResendEmailButton({
  invitationId,
  email,
  resend,
}: {
  invitationId: string;
  email: string;
  resend: InvitationRowActions["resend"];
}) {
  const [state, formAction, pending] = useActionState(
    resend,
    initialResendState
  );
  const secondsLeft = useResendCooldown(state.cooldown);
  const cooling = secondsLeft > 0;
  const sentNotice = useRef<HTMLSpanElement>(null);
  const sent = Boolean(state.sent) && !pending;

  // Not data synchronization — the repo's `useEffect` rule is about server data
  // (memory/contracts/data-patterns.md), and nothing here reads or mirrors any.
  // This is the one thing an effect is for: a DOM command that can only run
  // after the browser has committed the element it commands.
  useEffect(() => {
    if (sent) sentNotice.current?.focus();
  }, [sent]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      {state.error && (
        <span role="alert" className="text-destructive text-sm text-pretty">
          {state.error}
        </span>
      )}
      {sent && (
        <span
          ref={sentNotice}
          // Programmatically focusable, never in the tab order: a pointer user
          // must not collect an extra Tab stop for a sentence they can read.
          tabIndex={-1}
          role="status"
          // The focus ring is NOT suppressed. A sighted keyboard user who just
          // pressed Enter needs to see where focus went, and this element is
          // unreachable by Tab, so the ring can only ever appear right after the
          // send it reports.
          className="text-muted-foreground text-xs"
        >
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
  revoke,
}: {
  invitationId: string;
  email: string;
  revoke: InvitationRowActions["revoke"];
}) {
  const [state, formAction, pending] = useActionState(
    revoke,
    initialRevokeState
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      {state.error && (
        <span role="alert" className="text-destructive text-sm text-pretty">
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
