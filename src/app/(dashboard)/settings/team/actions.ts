"use server";

// ============================================================================
// `/settings/team`'s three writes — AS-005 / AS-010 / AS-014 (#495, widened to
// the org side by #500).
//
// The tenancy's side of the invitation surface, and deliberately the same shape
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
import type { SessionValidationResult } from "@/lib/auth/session";
import {
  InvitationError,
  invitationActorFromSession,
} from "@/lib/invitations/core";
import {
  createUserInvitationAs,
  resendUserInvitationEmailAs,
  revokeUserInvitationAs,
} from "@/lib/invitations/seat";
import {
  appointAdmin,
  demoteToMember,
  endCoachAssignment,
  removeSeat,
  seatActorFromSession,
  SeatManagementError,
  type SeatManagementActor,
} from "@/lib/seats/roster";

/**
 * What the invite form asks for: an address and a seat. There is no expiry
 * field — `INVITATION_EXPIRY_DAYS` is server-fixed by the 2026-08-03 ruling and
 * this schema has no key for one to arrive in — and no tenancy field, because
 * the plant, sending church or network being staffed is the actor's own.
 */
const createSchema = z.object({
  inviteeEmail: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.email("Enter a valid email address")),
  // `owner` is deliberately not in the union: the Owner seat is the account
  // that created the tenancy, and the three partial unique indexes
  // (`users_church_owner_unique_idx` and its two org siblings) would refuse a
  // second one anyway.
  seat: z.enum(["admin", "member"]),
});

/**
 * The coach form asks for an address and NOTHING ELSE — derived from the seat
 * schema so the two cannot disagree about what a valid address is.
 *
 * There is no seat field because a coach has no seat: `user_invitations` writes
 * NULL there, and `user_invitations_seat_check` is the biconditional that makes
 * any other value a constraint violation rather than a bug to find later.
 */
const createCoachSchema = createSchema.omit({ seat: true });

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
  // on ANY tenancy since #500, so what it refuses here — before a single field
  // is read — is a Member of either kind, a coach (no seat at all) and the
  // registered Owner whose plant does not exist yet (AS-005 / AS-010). WHICH
  // tenancy the row lands in is the actor's own, resolved one layer down.
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
    const result = await createUserInvitationAs(
      invitationActorFromSession(session),
      { kind: "seat", ...parsed.data }
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

/**
 * Invite somebody to COACH this plant (AS-008 / AS-009, #496).
 *
 * `coach.assignment.manage`, the same verb that ENDS an assignment
 * (`endCoachAssignmentAction`): coaching is an assignment and never a seat, so
 * the two halves of managing one answer to one authority. It is ADMIN_PLUS on a
 * plant tenancy, which is what refuses a Member.
 *
 * The result shape is the seat action's, unchanged and deliberately so — the
 * create-notice rule (`invitationCreatedNotice`) says the same neutral sentence
 * for both kinds, and a coach-specific success message would be the one place
 * the surface could start saying whether an account exists.
 */
export async function createCoachInvitationAction(
  _prevState: CreateSeatInvitationState,
  formData: FormData
): Promise<CreateSeatInvitationState> {
  const session = await requireSeat("coach.assignment.manage");

  const parsed = createCoachSchema.safeParse({
    inviteeEmail: formData.get("inviteeEmail") ?? "",
  });

  if (!parsed.success) {
    return {
      error:
        z.flattenError(parsed.error).fieldErrors.inviteeEmail?.[0] ??
        "Check the form and try again",
    };
  }

  try {
    const result = await createUserInvitationAs(
      invitationActorFromSession(session),
      { kind: "coach", ...parsed.data }
    );

    refresh();

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
    const result = await resendUserInvitationEmailAs(
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
    await revokeUserInvitationAs(
      invitationActorFromSession(session),
      parsed.data.invitationId
    );
  } catch (error) {
    return { error: refusal(error, GENERIC_FAILURE) };
  }

  refresh();

  return {};
}

// ============================================================================
// THE SEAT ROSTER'S FOUR WRITES — AS-015 / AS-016 / AS-017 / AS-018 (#497).
//
// Same shape as the three above: guard, parse, hand off, narrow the result. The
// authority decision is `requireSeat`'s and the business rules are
// `@/lib/seats/roster`'s; nothing here re-decides either.
//
// THE TARGET IS A BARE ID AND THAT IS SAFE, because it is never trusted as a
// SCOPE. Every query one layer down puts the ACTOR's own TENANCY in its `WHERE`
// (`inTenancy`, off the one `tenancyOf` resolution), so a forged id naming an
// account in another plant, sending church or network matches no row and is
// refused with the same sentence a stale one gets. There is no tenancy field on
// this surface for a forged POST to re-aim.
//
// `refresh()` on success only — `runSeatAction` owns it — so a refused call
// leaves the row mounted with its message readable, exactly as the resend above
// does.
// ============================================================================

/** What every roster control gets back. Success carries nothing to render. */
export type SeatActionResult =
  | { success: true }
  | { success: false; error: string };

const userIdSchema = z.uuid("That is not a person we can act on");
const assignmentIdSchema = z.uuid("That is not an assignment we can act on");

/**
 * One place where a seat mutation becomes a result.
 *
 * IT MINTS THE ACTOR RATHER THAN TAKING ONE, and inside the `try` on purpose:
 * `seatActorFromSession` throws `SeatManagementError` for an account naming NO
 * tenancy — the registered Owner whose plant does not exist yet, who passes
 * `seat.manage`'s `tenancy: "any"` — and that refusal is a sentence the caller
 * should read, not an unhandled 500. An ORG Owner is no longer in that set:
 * they staff their own org through the same four verbs (#500). The
 * SESSION is still minted by `requireSeat` at the top of each export, above the
 * `try`, so the session-first rule holds and the tenancy check is the only thing
 * that happens in here.
 *
 * A `SeatManagementError` is user copy and is rendered verbatim; anything else
 * is a real failure, logged with its detail and reported as one neutral
 * sentence.
 */
async function runSeatAction(
  session: SessionValidationResult,
  label: string,
  mutate: (actor: SeatManagementActor) => Promise<void>
): Promise<SeatActionResult> {
  try {
    await mutate(seatActorFromSession(session));
    refresh();
    return { success: true };
  } catch (error) {
    if (error instanceof SeatManagementError) {
      return { success: false, error: error.message };
    }
    console.error(`${label} failed`, error);
    return { success: false, error: GENERIC_FAILURE };
  }
}

/** Appoint a Member to Admin (AS-015). Owner-only, in any tenancy. */
export async function appointAdminAction(
  targetUserId: string
): Promise<SeatActionResult> {
  const session = await requireSeat("seat.manage");

  const parsed = userIdSchema.safeParse(targetUserId);
  if (!parsed.success) {
    return { success: false, error: "That is not a person we can appoint" };
  }

  return runSeatAction(session, "appointAdminAction", (actor) =>
    appointAdmin(actor, parsed.data)
  );
}

/** Demote an Admin to Member (AS-015). Owner-only, in any tenancy. */
export async function demoteToMemberAction(
  targetUserId: string
): Promise<SeatActionResult> {
  const session = await requireSeat("seat.manage");

  const parsed = userIdSchema.safeParse(targetUserId);
  if (!parsed.success) {
    return { success: false, error: "That is not a person we can demote" };
  }

  return runSeatAction(session, "demoteToMemberAction", (actor) =>
    demoteToMember(actor, parsed.data)
  );
}

/**
 * Remove a seat and run its effects (AS-016, AS-017).
 *
 * The confirmation in front of this is a deliberateness control, not an
 * authorization one: the Owner-only rule, the self-removal refusal and the
 * tenancy scoping all live in `removeSeat`, where a request that never opened
 * the dialog meets them too. WHICH effects run is the tenancy's — a plant's
 * cascade reassigns tasks and clears a leader slot, an org's is the access and
 * nothing else (#500).
 */
export async function removeSeatAction(
  targetUserId: string
): Promise<SeatActionResult> {
  const session = await requireSeat("seat.manage");

  const parsed = userIdSchema.safeParse(targetUserId);
  if (!parsed.success) {
    return { success: false, error: "That is not a person we can remove" };
  }

  return runSeatAction(session, "removeSeatAction", (actor) =>
    removeSeat(actor, parsed.data)
  );
}

/**
 * End a coach assignment (AS-018).
 *
 * `coach.assignment.manage` and NOT `seat.manage`: coaching is an assignment,
 * never a seat, so an Admin — who may invite a coach under AS-004 — may end one
 * too. The capability's own docblock records the residual that this is any plant
 * Admin rather than only the one who created the assignment.
 */
export async function endCoachAssignmentAction(
  assignmentId: string
): Promise<SeatActionResult> {
  const session = await requireSeat("coach.assignment.manage");

  const parsed = assignmentIdSchema.safeParse(assignmentId);
  if (!parsed.success) {
    return { success: false, error: "That is not an assignment we can end" };
  }

  return runSeatAction(session, "endCoachAssignmentAction", (actor) =>
    endCoachAssignment(actor, parsed.data)
  );
}
