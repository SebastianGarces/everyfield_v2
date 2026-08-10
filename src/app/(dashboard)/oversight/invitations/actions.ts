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
// `refresh()` rather than `revalidatePath`, per
// memory/contracts/data-patterns.md — the list is server-rendered from props
// and the server is what reconciles it.
// ============================================================================

import { refresh } from "next/cache";
import { z } from "zod";

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
   * Set on success — the surface shows what happened and the link that carries
   * the invitation. Every invitation this action can create is an OPEN one (the
   * 2026-08-04 ruling refuses addresses that already have an account), so there
   * is no second TARGET shape to render.
   *
   * `emailSent` is carried through verbatim from `createInvitation`, and it is
   * OPTIONAL on purpose (OV-003b / #293). Three values, three different things
   * to say:
   *
   *   * `true`      — the provider accepted the email; the link below is a
   *                   backup, not the delivery mechanism;
   *   * `false`     — it did not, so the row exists and the invitee has NOT
   *                   been told. The notice says exactly that and promotes the
   *                   link;
   *   * `undefined` — nothing tried to send. Not the same fact as `false`.
   *
   * Normalising it to a boolean here would destroy the distinction before the
   * surface could read it, which is the whole point of the contract pinned in
   * `src/lib/invitations/service.test.ts`. The words themselves live in
   * `@/lib/invitations/create-notice`, so they are executable.
   */
  created?: {
    inviteePath: string;
    inviteeEmail: string;
    emailSent?: boolean;
  };
};

export type RevokeInvitationState = { error?: string };

export async function createInvitationAction(
  _prevState: CreateInvitationState,
  formData: FormData
): Promise<CreateInvitationState> {
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

  // `emailSent` is passed through UNTOUCHED — no `?? false`, no `Boolean(…)`.
  // The send is best-effort by design (`@/lib/invitations/email`), so an
  // invitation whose email was refused still succeeds here; what changes is
  // what the admin is told, and they can only be told the truth if the three
  // values reach the surface intact.
  return {
    created: {
      inviteePath: `/register?invitation=${result.invitation.id}`,
      inviteeEmail: result.invitation.inviteeEmail ?? parsed.data.inviteeEmail,
      emailSent: result.emailSent,
    },
  };
}

export async function revokeInvitationAction(
  _prevState: RevokeInvitationState,
  formData: FormData
): Promise<RevokeInvitationState> {
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
