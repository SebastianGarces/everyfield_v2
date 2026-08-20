"use server";

// ============================================================================
// `/settings/team`'s three writes — AS-010 / AS-014 (#495).
//
// The plant's side of the invitation surface, and deliberately the same shape
// as `/oversight/invitations/actions.ts`: parse a form, hand off to the logic
// layer, turn the result into something `useActionState` can render. Every
// authority decision lives one layer down; nothing here re-decides any of it,
// and nothing here takes an actor — the actor is minted from the session by
// `requireSeat` and passed as a branded value the client cannot forge.
//
// SESSION FIRST, THEN THE PARSE (`memory/invariants.md` → Authentication). Each
// export opens with `requireSeat("seat.invitation.manage")`, ahead of its
// `safeParse`, so an anonymous POST — or a MEMBER's POST, which is AS-010's own
// acceptance criterion — is refused before its FormData is examined at all.
//
// THE STATE TYPES ARE THE ORG SURFACE'S, imported rather than restated: the
// pending list renders both tables' rows through one component
// (`InvitationsList`), so the two actions must answer in the shape it reads. A
// second copy of `ResendInvitationEmailState` is how the countdown starts
// working on one surface and not the other.
//
// IMPORTED, AND DELIBERATELY NOT RE-EXPORTED. `export type { A } from "…"` in a
// `"use server"` module does not survive the build: Next's server-action
// transform enumerates this module's exports to build the page's action
// manifest, reads the re-exported NAMES as actions, and fails compilation with
// "The export ResendInvitationEmailState was not found in module". A locally
// declared `export type` (see `CreateSeatInvitationState` below) is erased and
// is fine; a re-export statement is not. Anything that needs these two types
// takes them from the module that declares them, exactly as `InvitationsList`
// already does.
//
// `refresh()` rather than `revalidatePath`, per
// memory/contracts/data-patterns.md — the list is server-rendered from props.
// ============================================================================

import { refresh } from "next/cache";
import { z } from "zod";

import type {
  ResendInvitationEmailState,
  RevokeInvitationState,
} from "@/app/(dashboard)/oversight/invitations/actions";
import { requireSeat } from "@/lib/auth/seats";
import {
  InvitationError,
  invitationActorFromSession,
} from "@/lib/invitations/core";
import {
  createSeatInvitationAs,
  resendSeatInvitationEmailAs,
  revokeSeatInvitationAs,
} from "@/lib/invitations/seat";

/**
 * What the invite form asks for: an address and a seat. There is no expiry
 * field — `INVITATION_EXPIRY_DAYS` is server-fixed by the 2026-08-03 ruling and
 * this schema has no key for one to arrive in — and no church field, because the
 * plant is the actor's own.
 */
const createSchema = z.object({
  inviteeEmail: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.email("Enter a valid email address")),
  // `owner` is deliberately not in the union: the Owner seat is the account
  // that created the plant, and `users_church_owner_unique_idx` would refuse a
  // second one anyway.
  seat: z.enum(["admin", "member"]),
});

const invitationIdSchema = z.object({
  invitationId: z.uuid("That is not an invitation we can act on"),
});

/** Same shape as the org surface's, for the same notice component. */
export type CreateSeatInvitationState = {
  error?: string;
  created?: { inviteeEmail: string; emailSent?: boolean };
};

/**
 * The one refusal shape every export here shares.
 *
 * An `InvitationError` carries a message the invitee's counterpart is allowed
 * to read and it is rendered verbatim; anything else is a real failure, logged
 * with its detail and reported as one neutral sentence — an internal error must
 * never reach a surface with its reasons attached.
 */
function refusal(error: unknown, fallback: string): string {
  if (error instanceof InvitationError) return error.message;
  console.error("seat invitation action failed", error);
  return fallback;
}

const GENERIC_FAILURE = "Something went wrong. Please try again.";

export async function createSeatInvitationAction(
  _prevState: CreateSeatInvitationState,
  formData: FormData
): Promise<CreateSeatInvitationState> {
  // SESSION FIRST, AND THE SEAT WITH IT. `seat.invitation.manage` is ADMIN_PLUS
  // on a plant tenancy, so a Member — and a coach, and every oversight account —
  // is refused here, before a single field is read (AS-010).
  const session = await requireSeat("seat.invitation.manage");

  const parsed = createSchema.safeParse({
    inviteeEmail: formData.get("inviteeEmail") ?? "",
    seat: formData.get("seat") ?? "member",
  });

  if (!parsed.success) {
    return {
      error:
        z.flattenError(parsed.error).fieldErrors.inviteeEmail?.[0] ??
        "Check the form and try again",
    };
  }

  try {
    const result = await createSeatInvitationAs(
      invitationActorFromSession(session),
      parsed.data
    );

    refresh();

    // ONE SHAPE, WHATEVER WAS CREATED. Nothing derived from the address lookup
    // reaches the client — the create either succeeded or refused with the one
    // neutral message, and the success says only what the admin typed plus what
    // the mail provider said (`invitationCreatedNotice`).
    return {
      created: {
        inviteeEmail: result.invitation.inviteeEmail,
        emailSent: result.emailSent,
      },
    };
  } catch (error) {
    return { error: refusal(error, GENERIC_FAILURE) };
  }
}

export async function resendSeatInvitationEmailAction(
  _prevState: ResendInvitationEmailState,
  formData: FormData
): Promise<ResendInvitationEmailState> {
  const session = await requireSeat("seat.invitation.manage");

  const parsed = invitationIdSchema.safeParse({
    invitationId: formData.get("invitationId") ?? "",
  });

  if (!parsed.success) {
    return { error: "That is not an invitation we can email" };
  }

  try {
    const result = await resendSeatInvitationEmailAs(
      invitationActorFromSession(session),
      parsed.data.invitationId
    );

    // ONLY on success, and the failure path's silence is the point — the row
    // stays mounted so its refusal is readable (see the org action's own note).
    refresh();

    return {
      sent: true,
      cooldown: {
        window: result.resendWindow.index,
        remainingMs: result.resendWindow.remainingMs,
      },
    };
  } catch (error) {
    return { error: refusal(error, GENERIC_FAILURE) };
  }
}

export async function revokeSeatInvitationAction(
  _prevState: RevokeInvitationState,
  formData: FormData
): Promise<RevokeInvitationState> {
  const session = await requireSeat("seat.invitation.manage");

  const parsed = invitationIdSchema.safeParse({
    invitationId: formData.get("invitationId") ?? "",
  });

  if (!parsed.success) {
    return { error: "That is not an invitation we can revoke" };
  }

  try {
    await revokeSeatInvitationAs(
      invitationActorFromSession(session),
      parsed.data.invitationId
    );
  } catch (error) {
    return { error: refusal(error, GENERIC_FAILURE) };
  }

  refresh();

  return {};
}
