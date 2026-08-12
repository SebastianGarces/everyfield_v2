"use server";

// ============================================================================
// The invitations surface's three writes (#23 / OV-003, plus the 2026-08-10
// resend).
//
// All three are thin: they parse a form, hand off to `@/lib/invitations/service`,
// and turn the result into something `useActionState` can render. Every
// authority decision — who may invite, which org they invite on behalf of,
// whether the target's oversight slot is free, who may revoke — lives in the
// service and its logic layer, where #265 put it. Nothing here re-decides any
// of it, and nothing here takes an actor: the service mints one from
// `verifySession()`, so a forged POST at either of these endpoints has no
// parameter to name somebody else in.
//
// This module deliberately imports ONLY `@/lib/invitations/service`, never
// `@/lib/invitations/core`. `service.test.ts` treats a `"use server"` module
// that reaches the logic layer as something a reviewer has to sign off on
// (`CORE_REACHING_ACTION_MODULES`); routing through the action layer's front
// door means there is nothing to sign off on here.
//
// SESSION FIRST, THEN THE PARSE (ruled 2026-08-10, round 6 of #304). Each
// export opens with `await verifySession()`, ahead of its `safeParse`, so an
// anonymous POST is refused before its FormData is examined at all. Parsing
// first was not exploitable here — the service mints its own actor and refuses
// anyway — but it answered a sessionless caller differently for a malformed
// field (`{ error: "Enter a valid email address" }`) than for a well-formed one
// (a throw), which is a free shape-oracle, and it made "does this endpoint
// check anybody?" a question about reading order instead of about line one.
//
// THE DUPLICATE MINT IS DELIBERATE. This module still takes no actor and passes
// nothing down: `createInvitation` / `resendInvitationEmail` /
// `revokeInvitation` mint their own from
// `verifySession()` inside the service, which is where the authority decisions
// live and where a future caller that is not this module meets them too. The
// call here is a GUARD, not a source of authority, and it is free: the session
// read is `React.cache()`d per request (`getCurrentSession`), so the second
// `verifySession()` inside the service costs no second query. Removing either
// one would be a regression — this one lets the parse answer an anonymous
// caller, that one lets a future non-action caller through unchecked.
//
// `refresh()` rather than `revalidatePath`, per
// memory/contracts/data-patterns.md — the list is server-rendered from props
// and the server is what reconciles it.
// ============================================================================

import { refresh } from "next/cache";
import { z } from "zod";

import { verifySession } from "@/lib/auth/session";
import {
  createInvitation,
  resendInvitationEmail,
  revokeInvitation,
} from "@/lib/invitations/service";

/** What the create form asks for. Note what is NOT here. */
const createSchema = z.object({
  // The one field the admin types. There is no picker of existing plants: a
  // dropdown of "plants you could invite" would list every plant in the product
  // to every org (see `resolveInvitationTarget`).
  inviteeEmail: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.email("Enter a valid email address")),
  // Which kind of organization is being invited. Only a network admin has a
  // choice; the service ignores it for a sending church admin, which may only
  // invite church plants.
  inviteAs: z.enum(["church", "sending_church"]).default("church"),
  // …and no expiry. RULED 2026-08-03 (#265 r2 / #23): the window is
  // server-fixed at `INVITATION_EXPIRY_DAYS`, so this form has no field for it
  // and this schema has no key for one to arrive in.
});

const revokeSchema = z.object({
  invitationId: z.uuid("That is not an invitation we can revoke"),
});

const resendSchema = z.object({
  invitationId: z.uuid("That is not an invitation we can email"),
});

export type CreateInvitationState = {
  error?: string;
  /**
   * Set on success, and it carries the ADDRESS THE ADMIN TYPED plus what
   * happened to the email — and nothing else.
   *
   * ----------------------------------------------------------------------
   * WHY THERE IS NO `inviteePath` — #304 ruling 4, item 5 (RULED 2026-08-09)
   * ----------------------------------------------------------------------
   *
   * This used to return `/register?invitation=…` for an OPEN invitation and
   * `null` for a TARGETED one, and the notice branched on it: one branch said
   * "they already have an EveryField account", the other handed over a
   * registration link. Both halves are the same disclosure. Ruling 2 collapsed
   * every REFUSAL on an email-resolved target to one message precisely so an
   * authenticated admin could not probe addresses for account existence — and
   * the SUCCESS path answered the identical question, in plainer words, for
   * every address that was not refused. Two shapes in this payload is an
   * oracle whether or not any component renders the difference, because the
   * payload itself crosses the wire.
   *
   * So there is one shape and no link. `/register?invitation=<id>` still
   * redeems an open invitation — it is what the invitation EMAIL carries — it
   * is simply not something this screen tells an admin, because telling them is
   * the disclosure.
   *
   * OV-003b / #293 RECONCILED WITH THAT (2026-08-12). The ruling above named
   * this exact moment: the admin link was "a stopgap for the email delivery
   * that has not shipped", and the copy was written delivery-neutral so it
   * would not need re-reading "the week PR #392 ships". #392 is this branch, so
   * the stopgap does not come back — a create that could not send is recovered
   * with **Resend email** on the row itself, which is the same branch's work
   * and needs no URL on screen.
   *
   * `emailSent` is carried through verbatim from `createInvitation`, and it is
   * OPTIONAL on purpose. Three values, three different things to say:
   *
   *   * `true`      — the provider accepted the email;
   *   * `false`     — it did not, so the row exists and the invitee has NOT
   *                   been told. The notice says exactly that and points at
   *                   Resend email;
   *   * `undefined` — nothing tried to send. Not the same fact as `false`.
   *
   * Normalising it to a boolean here would destroy the distinction before the
   * surface could read it, which is the whole point of the contract pinned in
   * `src/lib/invitations/service.test.ts`. The words themselves live in
   * `@/lib/invitations/create-notice`, so they are executable.
   *
   * It is NOT target-derived and so is not the oracle item 5 closed: it reports
   * what the mail provider said, which is the same question for an address with
   * an account and one without.
   */
  created?: { inviteeEmail: string; emailSent?: boolean };
};

export type RevokeInvitationState = { error?: string };

/**
 * A resend says one of two things and never both: it went out, or here is why
 * it did not. There is no third "created but…" state to carry — the invitation
 * already exists, so the send is the whole of what this action does.
 *
 * A success carries `cooldown` as well (RULED 2026-08-10 round 2). It is the
 * dedupe bucket the provider was keyed with, and the surface refuses the next
 * press for the rest of it: inside that span a second attempt at this invitation
 * is collapsed onto the message already accepted, so a live button would report
 * "Email sent" over a send the provider dropped.
 *
 * `sent: true` is a claim about THIS REQUEST reaching the provider, and it is
 * unconditional because the server has nothing to condition it on: the ruling
 * persists nothing about delivery, and an idempotent replay returns the original
 * response, so a collapsed second request is indistinguishable here from a first
 * one. The cooldown below is therefore the guard, and it reaches exactly as far
 * as the client session holding it — a reload or another admin's browser starts
 * with none. Named in full at `useResendCooldown` (`invitations-list.tsx`) and
 * executed in `resend.test.ts` §8; closing it needs a durable last-send record,
 * which is a migration and a fresh ruling.
 *
 * SPELLED OUT HERE rather than imported, because this type is the wire: every
 * field crosses to the browser inside `useActionState`, so the shape the client
 * may rely on is declared at the boundary that serializes it. Two numbers, both
 * plain arithmetic on the clock — the invitation id is NOT among them, and the
 * provider key it is part of never leaves the server.
 */
export type ResendInvitationEmailState = {
  error?: string;
  sent?: boolean;
  cooldown?: {
    /**
     * The bucket number. Its only job on the client is IDENTITY: two successes
     * reporting one index are one deadline, so a second admin's send does not
     * restart a countdown that is already running, and a genuinely later send is
     * a different index and a fresh one.
     */
    window: number;
    /**
     * How much of that bucket was left when the server answered. A DURATION, not
     * an instant, and the surface counts it down by measuring its OWN elapsed
     * time: no clock reading crosses this boundary, so a workstation minutes out
     * of step still waits the right length of time.
     */
    remainingMs: number;
  };
};

export async function createInvitationAction(
  _prevState: CreateInvitationState,
  formData: FormData
): Promise<CreateInvitationState> {
  // SESSION FIRST — nothing on this FormData is read until a session exists.
  await verifySession();

  const parsed = createSchema.safeParse({
    inviteeEmail: formData.get("inviteeEmail") ?? "",
    inviteAs: formData.get("inviteAs") ?? "church",
  });

  if (!parsed.success) {
    return {
      error:
        z.flattenError(parsed.error).fieldErrors.inviteeEmail?.[0] ??
        "Check the form and try again",
    };
  }

  const result = await createInvitation(parsed.data);

  // Both create-time refusals — the occupied slot (ruled 2026-08-03) and an
  // address that already has an account (ruled 2026-08-04) — arrive here as
  // ordinary `InvitationError` messages and are rendered verbatim, so the admin
  // learns immediately rather than the invitation sitting pending for 30 days
  // in front of somebody who cannot answer it.
  if (!result.success) {
    return { error: result.error };
  }

  refresh();

  // ONE SHAPE, WHATEVER WAS CREATED (#304 ruling 4, item 5). Nothing derived
  // from `result.invitation.targetChurchId` / `targetSendingChurchId` may reach
  // the client: those two columns are the server's answer to "does this address
  // already have an account", and an admin who can tell the two success
  // responses apart has the enumeration oracle back. The row's own address is
  // echoed — the admin typed it — with the parsed value as the fallback. No
  // `inviteePath`: item 5 stands, and #293 is the email that replaced the need
  // for it.
  //
  // `emailSent` is passed through UNTOUCHED — no `?? false`, no `Boolean(…)`.
  // The send is best-effort by design (`@/lib/invitations/email`), so an
  // invitation whose email was refused still succeeds here; what changes is
  // what the admin is told, and they can only be told the truth if the three
  // values reach the surface intact.
  return {
    created: {
      inviteeEmail: result.invitation.inviteeEmail ?? parsed.data.inviteeEmail,
      emailSent: result.emailSent,
    },
  };
}

/**
 * Send a pending invitation's email again — RULED 2026-08-10 (#392 / #293).
 *
 * Recovery, not bookkeeping: nothing is persisted by this path, so what it
 * fixes is the invitee's empty inbox rather than the product's memory of it.
 * Every rule it depends on is one layer down — the org scope, the pending guard
 * inside `sendInvitationEmail`, and the resend-specific idempotency key that
 * stops the provider deduping this against the message the create already sent
 * for the same invitation.
 */
export async function resendInvitationEmailAction(
  _prevState: ResendInvitationEmailState,
  formData: FormData
): Promise<ResendInvitationEmailState> {
  // SESSION FIRST — see the module header; the service mints its own actor, and
  // this guard is what answers an anonymous POST before the parse can tell it
  // what shape the endpoint wants (ruled 2026-08-10, round 6 of #304).
  await verifySession();

  const parsed = resendSchema.safeParse({
    invitationId: formData.get("invitationId") ?? "",
  });

  if (!parsed.success) {
    return { error: "That is not an invitation we can email" };
  }

  const result = await resendInvitationEmail(parsed.data.invitationId);

  // ONLY on success — and the failure path's silence is the point.
  //
  // This used to refresh before the branch, so that an invitation auto-expired
  // by the refusal stopped showing "Pending". It cost the admin the message.
  // Every refusal this action can return is a refusal that MOVES the row out of
  // the pending list (revoked out of band → `not_pending`; window closed →
  // auto-expired first), the two lists are different parents, so the refreshed
  // tree unmounts the row — and the refusal lives in that row's
  // `useActionState`. Measured on the preview: a stale Resend press correctly
  // sent nothing, correctly refused, and the admin saw NOTHING AT ALL. That
  // made `resendRefusalMessage("not_pending")` and `INVITATION_EXPIRED_MESSAGE`
  // dead on screen — the two refusals this feature exists to explain.
  //
  // So the row stays mounted and says why. The badge next to it can be one
  // render stale, which the refusal itself corrects in words ("no longer
  // pending", "has expired"); the next navigation or any other action
  // reconciles it. A stale badge under a true sentence beats a correct badge
  // under no sentence.
  if (!result.success) {
    return { error: result.error };
  }

  refresh();

  // The window the send was keyed with, carried through verbatim. It is only
  // absent if the service ever stopped reporting one, and the surface treats
  // that as "no cooldown" rather than inventing a duration — a made-up wait is
  // a claim about the provider too.
  return {
    sent: true,
    ...(result.resendWindow
      ? {
          cooldown: {
            window: result.resendWindow.index,
            remainingMs: result.resendWindow.remainingMs,
          },
        }
      : {}),
  };
}

export async function revokeInvitationAction(
  _prevState: RevokeInvitationState,
  formData: FormData
): Promise<RevokeInvitationState> {
  // SESSION FIRST — see the module header; the service mints its own actor.
  await verifySession();

  const parsed = revokeSchema.safeParse({
    invitationId: formData.get("invitationId") ?? "",
  });

  if (!parsed.success) {
    return { error: "That is not an invitation we can revoke" };
  }

  // Any admin of the inviting org may revoke (RULED 2026-08-04 — the pending
  // list is org-scoped, so the button on it has to be), and that check is part
  // of the UPDATE itself (`revokeInvitationQuery`): another org's admin, or any
  // non-oversight caller, matches no row.
  const result = await revokeInvitation(parsed.data.invitationId);

  if (!result.success) {
    return { error: result.error };
  }

  refresh();

  return {};
}
