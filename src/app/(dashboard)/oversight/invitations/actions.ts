"use server";

// ============================================================================
// The invitations surface's two writes (#23 / OV-003).
//
// Both are thin: they parse a form, hand off to `@/lib/invitations/service`,
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
// nothing down: `createInvitation` / `revokeInvitation` mint their own from
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
import { createInvitation, revokeInvitation } from "@/lib/invitations/service";

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

export type CreateInvitationState = {
  error?: string;
  /**
   * Set on success, and it carries the ADDRESS THE ADMIN TYPED and nothing
   * else.
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
   * So there is one shape and one message. The success notice never asserts
   * whether an account exists, and this surface renders no `/register` link at
   * all. An open invitation's token still works — `/register?invitation=<id>`
   * is unchanged, and it is what an invitation EMAIL will carry — it is simply
   * not something this screen tells an admin, because telling them is the
   * disclosure.
   */
  created?: { inviteeEmail: string };
};

export type RevokeInvitationState = { error?: string };

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
  // echoed — the admin typed it — with the parsed value as the fallback.
  return {
    created: {
      inviteeEmail: result.invitation.inviteeEmail ?? parsed.data.inviteeEmail,
    },
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
