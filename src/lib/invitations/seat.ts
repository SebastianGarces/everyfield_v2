// ============================================================================
// SEAT INVITATIONS — the logic layer (AS-010 / AS-012 / AS-013, #495).
//
// NO `"use server"` DIRECTIVE, and that absence is the point. Every export of a
// `"use server"` module is a POSTable endpoint reachable with no session and no
// UI (`memory/invariants.md` → Authentication), so the logic lives here and
// `src/app/(dashboard)/settings/team/actions.ts` — which mints its actor from
// `requireSeat` — is the only way in from a browser. Same shape, same reason, as
// `./core.ts`; read that file's header before adding an export here.
//
// ----------------------------------------------------------------------------
// WHAT A SEAT INVITATION IS, and how it differs from the org one next door
// ----------------------------------------------------------------------------
//
// `./core.ts` invites an ORGANIZATION into an association. This invites a
// PERSON into a tenancy: they register through the emailed link and land with
// the plant's `church_id` and the invited seat, in the same write that creates
// the account (AS-012). So:
//
//   * IT IS REGISTER-ONLY. An address that already holds an account is refused
//     with `ACCOUNT_NOT_INVITABLE_MESSAGE` — the ONE neutral message, imported
//     rather than restated. There is no in-product surface for an existing
//     account to answer a seat invitation from, and by the invariant "no
//     invitation that cannot be answered" one that could not be answered is not
//     created. Moving an account between tenancies is support's job, by ruling.
//   * THE TOKEN IS A SECRET, NOT AN ID. The org path's credential is the row's
//     own uuid, so anybody who reads the row (or its id in a DOM) holds it. Here
//     the database stores sha256 of a 32-byte random token and nothing else, so
//     a database read — or a log, or a backup — hands nobody a working link.
//   * A RESEND MINTS A NEW TOKEN. That follows from hashing: the plaintext
//     exists only in transit, so the send that fails cannot be repeated
//     verbatim. `resendUserInvitationEmailAs` rotates `token_hash` and the email
//     says plainly that earlier links stop working.
//
// ----------------------------------------------------------------------------
// EVERY CONSTANT IS IMPORTED. One implementation, never a second copy.
// ----------------------------------------------------------------------------
//
// `INVITATION_EXPIRY_DAYS`, `INVITES_PER_INVITEE_PER_WINDOW`,
// `ACCOUNT_NOT_INVITABLE_MESSAGE`, `INVALID_EMAIL_MESSAGE`, `InvitationError`,
// `InvitationActor`, `normalizeInviteeEmail`, `isUuid` — all from `./core`. The
// resend cooldown arithmetic comes from `./resend-window` and the refusal copy
// from `./resend`. AS-010 says "one implementation shared with the org
// invitation surface, not a second copy", and the way that is kept true is that
// this file declares no constant the other one already owns.
//
// ----------------------------------------------------------------------------
// THE POSITIONAL RULE HOLDS HERE TOO (`memory/invariants.md` → Multi-Tenancy)
// ----------------------------------------------------------------------------
//
// "Everything downstream of target resolution speaks about a STRANGER." The
// address lookup in `createUserInvitationAs` is that resolution, so every check
// that can compose a LEGIBLE refusal runs ABOVE it: the authority check, the
// email parse, the duplicate-pending check and the cap all read the caller's own
// tenancy's rows for an address the caller itself typed, and answer identically
// whether or not an account exists behind it. Below the lookup there is exactly
// one sentence, and it is the imported constant.
// ============================================================================

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  coachAssignments,
  userInvitations,
  users,
  type InvitableSeat,
  type NewUserInvitation,
  type UserInvitation,
  type UserInvitationKind,
} from "@/db/schema";
import { assertSeatFor, type Capability } from "@/lib/auth/seat-rules";

import {
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  INVITATION_EXPIRY_DAYS,
  INVITES_PER_INVITEE_PER_WINDOW,
  InvitationError,
  isInvitableEmailAddress,
  isUuid,
  normalizeInviteeEmail,
  rateLimitWindowStart,
  type InvitationActor,
} from "./core";
import {
  INVITATION_EXPIRED_MESSAGE,
  INVITATION_NOT_OURS_MESSAGE,
  resendRefusalMessage,
} from "./resend";
import { resendDedupeWindowAt, type ResendDedupeWindow } from "./resend-window";
import { type InvitedRole } from "./seat-copy";
import {
  sendSeatInvitationEmail,
  type SeatInvitationEmailDeps,
} from "./seat-email";

// ----------------------------------------------------------------------------
// The token
// ----------------------------------------------------------------------------

/**
 * 32 bytes of CSPRNG, base64url — 256 bits, which is what a bearer credential
 * with a 30-day life needs. `base64url` so it survives a query string with no
 * escaping and no `%` in an inbox.
 */
export function newUserInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What the database stores. sha256 hex, 64 characters — the column's whole
 * width, so a value that is not a digest does not fit.
 *
 * NO SALT AND NO KDF, deliberately. A password needs one because it is
 * low-entropy and chosen by a human; this token is 256 random bits, so there is
 * no dictionary to run and a per-row salt would only stop the lookup being a
 * point read on a unique index.
 */
export function hashUserInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ----------------------------------------------------------------------------
// The refusal predicate
// ----------------------------------------------------------------------------

/**
 * WHAT THE TWO KINDS DISAGREE ABOUT, AS ONE TABLE (AS-008 / AS-010, #496).
 *
 * `user_invitations` has always had two kinds and exactly one axis of
 * difference: whether an address that ALREADY HOLDS AN ACCOUNT may be invited.
 * The asymmetry is deliberate and it is a ruling (2026-08-20, 185 (5)), not an
 * oversight:
 *
 *   * A SEAT invitation would MOVE an account between tenancies. One account
 *     holds one home tenancy, so accepting would have to vacate the old one —
 *     which is a support request, not a click. Register-only, therefore.
 *   * A COACH invitation only ADDS a `coach_assignments` row. Nothing moves, no
 *     tenancy is touched, and access is the UNION of what the account already
 *     reached and what the assignment reaches. Any account can hold one, so any
 *     account may be invited.
 *
 * Keeping it as a lookup rather than an `if` is what makes the property
 * `ACCOUNT_NOT_INVITABLE_MESSAGE` states checkable: ONE predicate answers for
 * both kinds, so "a coach invitation is never refused with that message" and "a
 * seat invitation always is" are two reads of the same row rather than two code
 * paths that can drift.
 */
const INVITATION_KIND_RULES = {
  seat: {
    admitsExistingAccount: false,
    capability: "seat.invitation.manage",
  },
  coach: {
    // `coach.assignment.manage`, NOT `seat.invitation.manage`: coaching is an
    // assignment and never a seat, so the verb that ENDS an assignment is the
    // verb that starts one (`endCoachAssignmentAction`, #497). Both are
    // ADMIN_PLUS on a plant tenancy, which is what refuses a Member (AS-004).
    admitsExistingAccount: true,
    capability: "coach.assignment.manage",
  },
} as const satisfies Record<
  UserInvitationKind,
  { admitsExistingAccount: boolean; capability: Capability }
>;

/**
 * REGISTER-ONLY, OR NOT, DECIDED BY THE KIND — one pure function for both
 * (AS-008 / AS-010).
 *
 * For `seat`, any existing account is refused, whatever it is: a plant Owner, an
 * Admin, a Member, an oversight seat, or a coach holding no seat at all. For
 * `coach`, none of them is — the invitation adds an assignment and moves
 * nothing, so there is no account it cannot be answered by.
 *
 * Pure, and total over "is there a row" × "which kind", so the property AS-010
 * states is executable across every kind of account without a database.
 */
export function inviteeRefusalFor(
  kind: UserInvitationKind,
  existingAccount: { id: string } | null | undefined
): string | null {
  if (!existingAccount) return null;
  return INVITATION_KIND_RULES[kind].admitsExistingAccount
    ? null
    : ACCOUNT_NOT_INVITABLE_MESSAGE;
}

/**
 * What an Owner or Admin reads when their plant has used up its attempts at one
 * address.
 *
 * It names the plant's OWN behaviour and nothing else — how many invitations
 * THEY sent, to an address THEY typed — so it is legible without being an
 * oracle, and it is only reachable from ABOVE the address lookup.
 */
export const USER_INVITE_RATE_LIMITED_MESSAGE =
  "You have already sent that address several invitations recently — wait for them to sign up, or reach them another way";

export const USER_INVITE_DUPLICATE_MESSAGE =
  "There is already a pending invitation to that address — revoke it first";

/**
 * What an Owner or Admin reads when the person they are inviting to coach
 * already coaches this plant (AS-009).
 *
 * It names the plant's OWN roster — the one rendered a few inches up the same
 * screen — so it is legible without telling the caller anything they could not
 * already read.
 */
export const ALREADY_COACHING_MESSAGE =
  "That person already coaches this plant — end the current assignment first";

/**
 * The cap's statement. Exported so a test can read its bound parameters: the
 * scope is this PLANT's own rows and the window is the SERVER's instant, neither
 * of which a request can influence.
 *
 * NO `status` PREDICATE, and that is the rule AS-010 states — "counting every
 * status". A revoke–reinvite loop is exactly what the cap exists to stop, so
 * counting only the pending ones would count only the invitations that are not
 * the problem.
 */
export function invitesFromChurchToAddressQuery(
  kind: UserInvitationKind,
  churchId: string,
  inviteeEmail: string,
  since: Date
) {
  return db
    .select({ id: userInvitations.id })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.kind, kind),
        eq(userInvitations.churchId, churchId),
        eq(userInvitations.inviteeEmail, inviteeEmail),
        gte(userInvitations.createdAt, since)
      )
    )
    .limit(INVITES_PER_INVITEE_PER_WINDOW);
}

// ----------------------------------------------------------------------------
// Create
// ----------------------------------------------------------------------------

/**
 * What a client may say: WHO, and — for a seat — WHICH SEAT. That is the whole
 * of it.
 *
 * A UNION RATHER THAN AN OPTIONAL `seat`, because the database says the same
 * thing: `user_invitations_seat_check` is the biconditional
 * `(kind = 'seat') = (seat is not null)`. A shape that let a coach request carry
 * a seat could only ever produce a constraint violation, so it is not a shape.
 */
export type UserInvitationRequest =
  | { kind: "seat"; inviteeEmail: string; seat: InvitableSeat }
  | { kind: "coach"; inviteeEmail: string };

/**
 * The `seat` column for a request — the ONE place the biconditional above is
 * satisfied, so no caller has to remember it.
 */
function seatColumnFor(request: UserInvitationRequest): InvitableSeat | null {
  return request.kind === "seat" ? request.seat : null;
}

/**
 * Read a row back as the role it invites — the inverse of `seatColumnFor`, and
 * the ONE place a stored row becomes words (`./seat-copy`).
 *
 * NO `?? "member"` FALLBACK, which is what it had while `seat` was the only
 * thing a row could carry. `user_invitations_seat_check` makes a seat row with
 * no seat unrepresentable, so a fallback could not fire on a well-formed row —
 * it could only ever fire on a DEFECTIVE one, and what it would do there is
 * email a coach describing a Member's powers. Failing is the smaller harm, and
 * the caller turns it into a refusal with a reason.
 */
function invitedRoleOf(invitation: UserInvitation): InvitedRole {
  if (invitation.kind === "coach") return { kind: "coach" };
  if (!invitation.seat) {
    throw new InvitationError(
      `invitation ${invitation.id} is kind 'seat' with no seat`
    );
  }
  return { kind: "seat", seat: invitation.seat };
}

/** What a create produces. The token is returned for the EMAIL and nothing else. */
export interface CreatedUserInvitation {
  invitation: UserInvitation;
  /** Did the provider accept the invitation email? See `./seat-email`. */
  emailSent: boolean;
}

/**
 * The plant this actor invites for. `null` for anybody who does not hold a seat
 * that may invite, which `assertSeatFor` has already refused — so a null here
 * is a defect, not an outcome.
 */
function invitingChurchId(actor: InvitationActor): string {
  if (!actor.churchId) {
    throw new InvitationError(
      "Create your church plant before inviting anyone to it"
    );
  }
  return actor.churchId;
}

/**
 * Resolve + guard + insert + send. The path the action layer takes.
 *
 * THE ORDER IS THE SECURITY PROPERTY, not the wording — see the module header.
 * Authority, then the parse, then the two counts over the caller's OWN rows,
 * then the address lookup. Nothing below the lookup composes a message of its
 * own.
 */
export async function createUserInvitationAs(
  actor: InvitationActor,
  request: UserInvitationRequest,
  deps: SeatInvitationEmailDeps = {},
  now: Date = new Date()
): Promise<CreatedUserInvitation> {
  const rules = INVITATION_KIND_RULES[request.kind];

  // AUTHORITY FIRST, and specifically before the address is looked up: the
  // lookup's refusal is a fact about a stranger, and handing it to somebody who
  // may not invite at all would be an account-enumeration oracle for free. Both
  // verbs are ADMIN_PLUS on a plant tenancy, so a Member is refused here as well
  // as at the action's own `requireSeat` (AS-004 / AS-010).
  assertSeatFor(actor, rules.capability);

  const churchId = invitingChurchId(actor);
  const inviteeEmail = normalizeInviteeEmail(request.inviteeEmail);

  if (!isInvitableEmailAddress(inviteeEmail)) {
    throw new InvitationError(INVALID_EMAIL_MESSAGE);
  }

  // THIS PLANT'S OWN ROWS, for an address this plant typed. Legible, and
  // deliberately above the lookup so it cannot become a statement about the
  // person behind the address. Scoped to the KIND: a pending coach invitation is
  // not a reason to refuse a seat invitation, and the two answer separately.
  const [duplicate] = await db
    .select({ id: userInvitations.id })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.kind, request.kind),
        eq(userInvitations.churchId, churchId),
        eq(userInvitations.inviteeEmail, inviteeEmail),
        eq(userInvitations.status, "pending"),
        gt(userInvitations.expiresAt, now)
      )
    )
    .limit(1);

  if (duplicate) {
    throw new InvitationError(USER_INVITE_DUPLICATE_MESSAGE);
  }

  // ALREADY COACHING THIS PLANT — an in-app sentence rather than the 500 the
  // unique index would otherwise deliver on acceptance (AS-009, #496).
  //
  // IT SITS ABOVE THE LOOKUP AND IT IS STILL NOT AN ORACLE, which is worth
  // saying because it does resolve an address to an account. The join is scoped
  // to THIS PLANT'S OWN `coach_assignments`, and the plant already reads that
  // roster by name on the same screen (`PlantCoachList`, #497). So the only fact
  // it can state is one the caller was already looking at — unlike the general
  // account lookup below, which speaks about the whole product.
  if (request.kind === "coach") {
    const [assigned] = await db
      .select({ id: coachAssignments.id })
      .from(coachAssignments)
      .innerJoin(users, eq(users.id, coachAssignments.coachUserId))
      .where(
        and(
          eq(coachAssignments.churchId, churchId),
          eq(coachAssignments.status, "active"),
          eq(users.email, inviteeEmail)
        )
      )
      .limit(1);

    if (assigned) {
      throw new InvitationError(ALREADY_COACHING_MESSAGE);
    }
  }

  // THE CAP, counting EVERY status (AS-010). Also above the lookup, and for the
  // same reason: a cap that applied only to invitable addresses would itself be
  // a probe.
  const recent = await invitesFromChurchToAddressQuery(
    request.kind,
    churchId,
    inviteeEmail,
    rateLimitWindowStart(now)
  );
  if (recent.length >= INVITES_PER_INVITEE_PER_WINDOW) {
    throw new InvitationError(USER_INVITE_RATE_LIMITED_MESSAGE);
  }

  // THE RESOLUTION. Everything from here down speaks about a stranger, so there
  // is exactly one sentence available and it is the imported constant — and for
  // `coach` there is not even that one, because the kind admits every account.
  //
  // The projection is a single column: answering "does this address hold an
  // account" must not pull `password_hash` into application memory (the same
  // reasoning as `accessColumns` in `@/lib/notifications/enqueue`).
  const [existingAccount] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, inviteeEmail))
    .limit(1);

  const refusal = inviteeRefusalFor(request.kind, existingAccount);
  if (refusal) {
    throw new InvitationError(refusal);
  }

  const token = newUserInvitationToken();
  const row: NewUserInvitation = {
    kind: request.kind,
    inviteeEmail,
    churchId,
    seat: seatColumnFor(request),
    tokenHash: hashUserInvitationToken(token),
    inviterUserId: actor.id,
    status: "pending",
    // Applied HERE, from the shared constant, so there is exactly one place the
    // window is decided and no parameter for a client to name it in.
    expiresAt: new Date(
      now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ),
  };

  const [invitation] = await db.insert(userInvitations).values(row).returning();

  // LAST, and deliberately after the committed row — an invitation that exists
  // but was not emailed is repaired by Resend on its row; an email sent for a
  // row that failed to insert is a link to nothing.
  const emailSent = await emailSeatInvitee(invitation, token, deps);

  return { invitation, emailSent };
}

/**
 * Tell the invitee. Best-effort by construction: `sendSeatInvitationEmail`
 * swallows its own transport failures, and this wrapper swallows the one thing
 * it cannot — the church-name lookup, which is a database read and can throw.
 */
async function emailSeatInvitee(
  invitation: UserInvitation,
  token: string,
  deps: SeatInvitationEmailDeps
): Promise<boolean> {
  return (await seatInviteeEmailOutcome(invitation, token, deps)).sent;
}

/** The same send, reporting WHY it did not happen — what the resend path needs. */
async function seatInviteeEmailOutcome(
  invitation: UserInvitation,
  token: string,
  deps: SeatInvitationEmailDeps
) {
  let churchName: string | null = null;
  let inviterName: string | null = null;
  let role: InvitedRole;

  try {
    const facts = await lookupSeatInvitationSender(invitation);
    churchName = facts.churchName;
    inviterName = facts.inviterName;
    // INSIDE THE TRY, so a row that contradicts its own CHECK becomes a refusal
    // with a reason rather than an unhandled throw out of a best-effort send.
    role = invitedRoleOf(invitation);
  } catch (error) {
    console.error("seat invitation sender lookup failed", {
      invitationId: invitation.id,
      error,
    });
    return { sent: false, reason: "preparation_threw" } as const;
  }

  return sendSeatInvitationEmail(
    {
      invitationId: invitation.id,
      token,
      inviteeEmail: invitation.inviteeEmail,
      status: invitation.status,
      churchName,
      inviterName,
      role,
      expiresAt: invitation.expiresAt,
    },
    deps
  );
}

/** Who the email says it is from: the plant, and the person who pressed Send. */
async function lookupSeatInvitationSender(
  invitation: UserInvitation
): Promise<{ churchName: string | null; inviterName: string | null }> {
  const [row] = await db
    .select({ churchName: churches.name, inviterName: users.name })
    .from(userInvitations)
    .innerJoin(churches, eq(churches.id, userInvitations.churchId))
    .innerJoin(users, eq(users.id, userInvitations.inviterUserId))
    .where(eq(userInvitations.id, invitation.id))
    .limit(1);

  return {
    churchName: row?.churchName ?? null,
    inviterName: row?.inviterName ?? null,
  };
}

// ----------------------------------------------------------------------------
// Read, revoke, resend
// ----------------------------------------------------------------------------

/**
 * THE AUTHORITY IS THE `WHERE`, and it is one predicate shared by the list, the
 * revoke and the resend — so what an Admin sees, closes and re-emails is
 * exactly one population and the three can never disagree about "ours".
 *
 * BOTH KINDS, AND THE KIND PREDICATE IS GONE (#496). It read
 * `kind = 'seat'` while that was the only kind with a caller. Keeping it would
 * have made every coach invitation invisible to the plant that sent it and
 * un-revokable by anyone — the list would not show it, `loadOurs` would not find
 * it, and the auto-expire sweep would leave it pending for ever.
 *
 * It is not a widening of authority, which is the question to ask of a `WHERE`
 * that loses a term: the two create verbs (`seat.invitation.manage` and
 * `coach.assignment.manage`) carry the SAME seat set on the SAME tenancy, so
 * every caller that could reach a seat row could already have sent the coach row
 * beside it. What is left is the tenancy, which is the part that was ever load
 * bearing.
 */
function oursFilter(actor: InvitationActor) {
  return eq(userInvitations.churchId, invitingChurchId(actor));
}

/** Every seat invitation this plant has issued, newest first. */
export async function listUserInvitationsFor(
  actor: InvitationActor
): Promise<UserInvitation[]> {
  assertSeatFor(actor, "seat.invitation.manage");

  return db
    .select()
    .from(userInvitations)
    .where(oursFilter(actor))
    .orderBy(desc(userInvitations.createdAt));
}

async function loadOurs(
  actor: InvitationActor,
  invitationId: string
): Promise<UserInvitation | undefined> {
  const [row] = await db
    .select()
    .from(userInvitations)
    .where(and(oursFilter(actor), eq(userInvitations.id, invitationId)))
    .limit(1);
  return row;
}

/**
 * Close a pending invitation. A compare-and-set, so revoking one an invitee is
 * registering with at the same instant either wins outright or loses outright —
 * never both.
 */
export async function revokeUserInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<void> {
  assertSeatFor(actor, "seat.invitation.manage");

  if (!isUuid(invitationId)) {
    throw new InvitationError(INVITATION_NOT_OURS_MESSAGE);
  }

  const revoked = await db
    .update(userInvitations)
    .set({ status: "revoked", respondedAt: new Date() })
    .where(
      and(
        oursFilter(actor),
        eq(userInvitations.id, invitationId),
        eq(userInvitations.status, "pending")
      )
    )
    .returning({ id: userInvitations.id });

  if (revoked.length === 0) {
    // One message for "no such invitation", "not yours" and "no longer
    // pending": telling them apart turns any seated account into a reader of
    // which invitation ids exist.
    throw new InvitationError(INVITATION_NOT_OURS_MESSAGE);
  }
}

/**
 * Send the invitation email again — AND MINT A NEW TOKEN WHILE DOING IT.
 *
 * The rotation is not a policy choice, it is what hashing costs: the plaintext
 * token exists only in transit, so the row cannot reproduce the link it already
 * sent. Rotating is the honest alternative to storing the credential, and the
 * email says plainly that earlier links stop working.
 *
 * It is also a real guard: a resend after a suspected forward invalidates the
 * forwarded copy.
 *
 * A FAILED RESEND IS A FAILED ACTION, exactly as on the org path — the send is
 * the entire product of this action, so a refusal throws with the words
 * `resendRefusalMessage` already owns.
 *
 * …AND A FAILED ONE PUTS THE OLD DIGEST BACK (#495, review round 1). On the org
 * path a refused resend costs nothing, because the link is the row's uuid and
 * was never at risk. Here the rotation commits before the send is proven, so a
 * provider outage would otherwise KILL THE LINK THE INVITEE ALREADY HOLDS and
 * deliver nothing to replace it — every retry destroying another one. The
 * restore is a compare-and-set on the digest this call wrote, so it cannot
 * clobber a rotation that raced past it, and it makes "a failed resend is a
 * failed action" true rather than merely stated.
 */
export async function resendUserInvitationEmailAs(
  actor: InvitationActor,
  invitationId: string,
  deps: SeatInvitationEmailDeps = {},
  now: Date = new Date()
): Promise<{ emailSent: boolean; resendWindow: ResendDedupeWindow }> {
  assertSeatFor(actor, "seat.invitation.manage");

  if (!isUuid(invitationId)) {
    throw new InvitationError(INVITATION_NOT_OURS_MESSAGE);
  }

  const invitation = await loadOurs(actor, invitationId);
  if (!invitation) {
    throw new InvitationError(INVITATION_NOT_OURS_MESSAGE);
  }

  // EXPIRY IS REFUSED, AND THE REFUSAL WRITES. `sendSeatInvitationEmail` guards
  // the status, not the window, so a pending-but-expired row would otherwise be
  // emailed with a link registration is guaranteed to reject.
  if (invitation.status === "pending" && invitation.expiresAt < now) {
    await db
      .update(userInvitations)
      .set({ status: "expired" })
      .where(
        and(
          eq(userInvitations.id, invitationId),
          eq(userInvitations.status, "pending")
        )
      );
    throw new InvitationError(INVITATION_EXPIRED_MESSAGE);
  }

  // THE ROTATION, as a compare-and-set on `pending`: a revoke that lands first
  // wins, and this path then finds no row to email.
  const token = newUserInvitationToken();
  const rotatedHash = hashUserInvitationToken(token);
  const rotated = await db
    .update(userInvitations)
    .set({ tokenHash: rotatedHash })
    .where(
      and(
        eq(userInvitations.id, invitationId),
        eq(userInvitations.status, "pending")
      )
    )
    .returning();

  if (rotated.length === 0) {
    throw new InvitationError(resendRefusalMessage("not_pending"));
  }

  const outcome = await seatInviteeEmailOutcome(rotated[0], token, {
    ...deps,
    // A DELIBERATE resend, keyed by THIS ROTATION rather than by a clock bucket:
    // every resend here carries a different credential, so a key two of them
    // could share would let the provider swallow the only message that named
    // the token now in the database. See `./seat-email` →
    // `SeatInvitationSendOccasion` for what that cost.
    occasion: { kind: "resend", rotationId: randomUUID() },
  });

  if (!outcome.sent) {
    // PUT THE OLD DIGEST BACK, guarded on the one this call wrote, so the link
    // the invitee already holds survives a refused send.
    await db
      .update(userInvitations)
      .set({ tokenHash: invitation.tokenHash })
      .where(
        and(
          eq(userInvitations.id, invitationId),
          eq(userInvitations.tokenHash, rotatedHash)
        )
      );

    throw new InvitationError(resendRefusalMessage(outcome.reason));
  }

  // The client cooldown, and ONLY the client cooldown: the provider key above
  // no longer rides on this arithmetic (see the note on the occasion).
  return { emailSent: true, resendWindow: resendDedupeWindowAt(now) };
}

// ----------------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------------

/**
 * What `/register` needs to know about a user-invitation token. Everything here
 * is either the reader's own address or the plant's public name — nothing about
 * any other account, and NOT the token, which the browser already holds in its
 * URL.
 *
 * `role` is the union rather than a nullable seat, so the sign-up path cannot
 * read a seat off a coach invitation and grant one (#496).
 */
export type UserRegistrationInvitation = {
  id: string;
  inviteeEmail: string;
  churchId: string;
  churchName: string;
  role: InvitedRole;
};

/**
 * Look a token up for the register screen.
 *
 * `null` for anything a visitor must not be told about — unknown, answered,
 * revoked, expired — so a guessed token learns exactly what a wrong one does.
 * There is no branch here that varies on whether an ACCOUNT exists, and that
 * stays true now BOTH kinds pass through it (#496): a coach invitation may name
 * an address that already holds an account, but this lookup never asks, so the
 * page it feeds cannot tell the visitor either. What a coach with an account
 * does instead is answer at `/coach-invitation`, where the branch is on the
 * VIEWER's own session.
 *
 * IT THROWS ON A DATABASE FAILURE, and that is a correction (#495, review round
 * 1). This had a blanket `catch { return null }`, which cannot catch anything
 * else — hashing a string does not throw — so its only effect was to turn a
 * transient database blip into a SILENT WRONG WRITE: `register` reads the null
 * as "no invitation" and takes the cold-planter branch, creating an account with
 * `seat: "owner"` and no plant, no person link and the invitation still pending.
 * `users_email_unique` then holds that address, so the visitor cannot retry and
 * AS-010 refuses a fresh invitation to them — support is the only exit. A
 * registration that fails loudly is repeatable; a wrong one is not.
 *
 * Runs with NO session, by construction: there is no account yet.
 */
export async function describeUserInvitationForRegistration(
  token: string | null | undefined,
  now: Date = new Date()
): Promise<UserRegistrationInvitation | null> {
  const candidate = (token ?? "").trim();
  if (candidate.length === 0) return null;

  const [row] = await db
    .select({
      id: userInvitations.id,
      kind: userInvitations.kind,
      inviteeEmail: userInvitations.inviteeEmail,
      churchId: userInvitations.churchId,
      churchName: churches.name,
      seat: userInvitations.seat,
    })
    .from(userInvitations)
    .innerJoin(churches, eq(churches.id, userInvitations.churchId))
    .where(
      and(
        eq(userInvitations.tokenHash, hashUserInvitationToken(candidate)),
        eq(userInvitations.status, "pending"),
        gt(userInvitations.expiresAt, now)
      )
    )
    .limit(1);

  if (!row || !row.churchId) return null;

  // Narrowed rather than cast: a `seat` row with no seat contradicts
  // `user_invitations_seat_check`, and it is read as no invitation at all — the
  // same `null` an unknown token gets, which is the only answer this route is
  // allowed to distinguish.
  const role: InvitedRole | null =
    row.kind === "coach"
      ? { kind: "coach" }
      : row.seat
        ? { kind: "seat", seat: row.seat }
        : null;

  if (!role) return null;

  return {
    id: row.id,
    inviteeEmail: row.inviteeEmail,
    churchId: row.churchId,
    churchName: row.churchName,
    role,
  };
}

/**
 * THE TOKEN IS BOUND TO THE INVITED ADDRESS — the same rule the org path has
 * carried since 2026-08-04, and silently since Ruling C (2026-08-12).
 *
 * A link travels by email: it is forwarded, pasted and archived. Whoever holds
 * one must not be able to register under some other address and walk off with a
 * seat in somebody else's plant. A mismatch carries NO message and no invitation
 * — it falls through to the ordinary sign-up exactly as an unknown token does,
 * because `/register` is an anonymous POST and a per-row message there tells a
 * stranger which address a live token names.
 */
export function userInvitationActedOnAtRegistration(
  described: UserRegistrationInvitation | null,
  registeringEmail: string
): UserRegistrationInvitation | null {
  if (!described) return null;
  const invited = described.inviteeEmail.trim().toLowerCase();
  const registering = (registeringEmail ?? "").trim().toLowerCase();
  if (invited.length === 0 || registering.length === 0) return null;
  return invited === registering ? described : null;
}

/**
 * The claim, as a STATEMENT rather than an awaited write — so it goes in the
 * same `db.batch` as the users insert and the person link (AS-012: the grant
 * happens in the same write that creates the account).
 *
 * A compare-and-set on `pending`, so a revoke that lands in the same instant
 * wins and this row is not re-answered.
 *
 * ACCEPTED RESIDUAL, recorded rather than guarded: a revoke committing between
 * `describeUserInvitationForRegistration` and this batch leaves an account
 * created with the seat while the invitation reads `revoked`. What makes the
 * link SINGLE USE is not this compare-and-set but `users_email_unique` — the
 * token is bound to one address, so at most one account can ever be created for
 * it, and a second attempt is refused as a duplicate account. Closing the
 * revoke race as well would need the users insert itself to be conditional on
 * the invitation, which is an `INSERT … SELECT` guarding a millisecond.
 */
export function claimUserInvitationStatement(
  invitationId: string,
  userId: string,
  now: Date = new Date()
) {
  return db
    .update(userInvitations)
    .set({ status: "accepted", respondedAt: now, respondedBy: userId })
    .where(
      and(
        eq(userInvitations.id, invitationId),
        eq(userInvitations.status, "pending")
      )
    )
    .returning({ id: userInvitations.id });
}

/**
 * The auto-expire sweep the list read performs — lazily, exactly as the org
 * path expires (`memory/invariants.md` → Multi-Tenancy: expiry is lazy, so the
 * COLUMN is checked and the status is corrected when somebody looks).
 *
 * Idempotent by construction: it only ever moves `pending` rows whose window has
 * closed, so running it twice changes nothing the first run did not.
 */
export async function expireLapsedUserInvitations(
  actor: InvitationActor,
  now: Date = new Date()
): Promise<void> {
  assertSeatFor(actor, "seat.invitation.manage");

  await db
    .update(userInvitations)
    .set({ status: "expired" })
    .where(
      and(
        oursFilter(actor),
        eq(userInvitations.status, "pending"),
        // `lt`, not a `sql` template: `expires_at` is `timestamp` WITHOUT time
        // zone, and a `Date` interpolated into a template bypasses the column's
        // driver mapping — the offset is serialised and then discarded by the
        // cast, so the sweep is wrong by that offset on any non-UTC host. The
        // other two comparisons in this file already use the typed helper.
        lt(userInvitations.expiresAt, now)
      )
    );
}
