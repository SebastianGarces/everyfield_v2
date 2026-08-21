// ============================================================================
// SEAT INVITATIONS — the logic layer (AS-005 / AS-010 / AS-012 / AS-013, #495,
// widened to the org side by #500).
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
// that tenancy's FK and the invited seat, in the same write that creates the
// account (AS-012). So:
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
// ALL THREE TENANCIES, ONE FLOW (#500)
// ----------------------------------------------------------------------------
//
// The tenancy is a CHURCH PLANT, a SENDING CHURCH or a NETWORK, and it is one
// value — `SeatTenancy`, from `tenancyOf` — rather than three nullable FKs
// threaded through every query. `user_invitations` already carried all three
// columns under an exactly-one CHECK, so the org side set them rather than
// adding a table, and `seat.invitation.manage` widened from `tenancy: "plant"`
// to `tenancy: "tenancy"` rather than a second verb being declared: an org
// Admin inviting an org Member is the same decision about the same row shape
// (AS-005).
//
// THE TENANCY IS ALWAYS THE ACTOR'S OWN. `invitingTenancy(actor)` resolves it
// from the session; `UserInvitationRequest` has no field for one, and
// `TENANCY_COLUMN` is the single lookup every scoped `WHERE` is built from. So
// "an org's invitation never targets a plant" is a property of the surface
// rather than of a validator — there is nothing for a forged POST to re-aim.
//
// TWO THINGS STAY PLANT-ONLY, and both are the same fact: coaching is a
// relationship with a church plant. `coach.assignment.manage` is
// `tenancy: "plant"`, so `assertSeatFor` refuses an org actor before the
// already-coaching check is reached, and AS-013's person link is written only
// when the granted tenancy is a plant — an org has no directory for a `persons`
// row to live in, and an org Member is an account rather than a person record
// inside anybody's plant (ruling 185 (9)).
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
//
// THAT IS UNCHANGED BY THE WIDENING, and deliberately so: nothing below the
// lookup branches on which tenancy is inviting, because a second fact about a
// stranger is a second fact whichever org asked for it.
// ============================================================================

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  coachAssignments,
  sendingChurches,
  sendingNetworks,
  userInvitations,
  users,
  type InvitableSeat,
  type NewUserInvitation,
  type UserInvitation,
  type UserInvitationKind,
} from "@/db/schema";
import { assertSeatFor, type Capability } from "@/lib/auth/seat-rules";
import {
  tenancyColumns,
  tenancyOf,
  type SeatTenancy,
  type SeatTenancyType,
} from "@/lib/auth/tenancy";

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
import { type InvitedAs } from "./seat-copy";
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

// ----------------------------------------------------------------------------
// The inviting tenancy
// ----------------------------------------------------------------------------

/**
 * WHICH COLUMN A TENANCY IS, for the three predicates that scope this table.
 *
 * A LOOKUP AND NOT A SWITCH, so the list, the revoke, the resend, the duplicate
 * check, the cap and the auto-expire sweep all name the same column for the
 * same tenancy by construction. A `Record` over `SeatTenancyType` means a
 * fourth tenancy kind is a compile error here rather than a `WHERE` that
 * silently matches nothing.
 */
const TENANCY_COLUMN = {
  church: userInvitations.churchId,
  sending_church: userInvitations.sendingChurchId,
  network: userInvitations.sendingNetworkId,
} as const satisfies Record<SeatTenancyType, unknown>;

/** `<the tenancy's column> = <its id>` — the scope every read and write shares. */
function tenancyMatches(tenancy: SeatTenancy) {
  return eq(TENANCY_COLUMN[tenancy.type], tenancy.id);
}

/**
 * The tenancy this actor invites INTO — their plant, their sending church or
 * their network (AS-005 / AS-010).
 *
 * `assertSeatFor` has already refused every account whose seat cannot invite,
 * and `seat.invitation.manage` is `tenancy: "tenancy"`, so a null here is the
 * one account that verb admits with nothing to act on: a registered Owner whose
 * plant does not exist yet. The copy names what is missing without naming
 * another tenancy.
 */
function invitingTenancy(actor: InvitationActor): SeatTenancy {
  const tenancy = tenancyOf(actor);
  if (!tenancy) {
    throw new InvitationError(
      "Create your church plant before inviting anyone to it"
    );
  }
  return tenancy;
}

/**
 * The cap's statement. Exported so a test can read its bound parameters: the
 * scope is this TENANCY's own rows and the window is the SERVER's instant,
 * neither of which a request can influence.
 *
 * NO `status` PREDICATE, and that is the rule AS-010 states — "counting every
 * status". A revoke–reinvite loop is exactly what the cap exists to stop, so
 * counting only the pending ones would count only the invitations that are not
 * the problem.
 */
export function invitesFromTenancyToAddressQuery(
  kind: UserInvitationKind,
  tenancy: SeatTenancy,
  inviteeEmail: string,
  since: Date
) {
  return db
    .select({ id: userInvitations.id })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.kind, kind),
        tenancyMatches(tenancy),
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
 * Read a row back as what it invites somebody to be — the inverse of
 * `seatColumnFor`, and
 * the ONE place a stored row becomes words (`./seat-copy`).
 *
 * NO `?? "member"` FALLBACK, which is what it had while `seat` was the only
 * thing a row could carry. `user_invitations_seat_check` makes a seat row with
 * no seat unrepresentable, so a fallback could not fire on a well-formed row —
 * it could only ever fire on a DEFECTIVE one, and what it would do there is
 * email a coach describing a Member's powers. Failing is the smaller harm, and
 * the caller turns it into a refusal with a reason.
 */
function invitedAsOf(invitation: UserInvitation): InvitedAs {
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

  const tenancy = invitingTenancy(actor);
  const inviteeEmail = normalizeInviteeEmail(request.inviteeEmail);

  if (!isInvitableEmailAddress(inviteeEmail)) {
    throw new InvitationError(INVALID_EMAIL_MESSAGE);
  }

  // THIS TENANCY'S OWN ROWS, for an address it typed. Legible, and deliberately
  // above the lookup so it cannot become a statement about the person behind the
  // address. Scoped to the KIND: a pending coach invitation is not a reason to
  // refuse a seat invitation, and the two answer separately.
  const [duplicate] = await db
    .select({ id: userInvitations.id })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.kind, request.kind),
        tenancyMatches(tenancy),
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
  //
  // IT IS PLANT-ONLY AND STAYS SO. `coach.assignment.manage` is
  // `tenancy: "plant"`, so `assertSeatFor` above has already refused every org
  // actor — a coach coaches a church plant, and there is no org-side coaching
  // to widen this to. The narrowing on `tenancy.type` is what lets the query
  // keep naming `coach_assignments.church_id`.
  if (request.kind === "coach" && tenancy.type === "church") {
    const [assigned] = await db
      .select({ id: coachAssignments.id })
      .from(coachAssignments)
      .innerJoin(users, eq(users.id, coachAssignments.coachUserId))
      .where(
        and(
          eq(coachAssignments.churchId, tenancy.id),
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
  const recent = await invitesFromTenancyToAddressQuery(
    request.kind,
    tenancy,
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
    // SPREAD, NEVER NAMED. `tenancyColumns` sets the one FK this tenancy is and
    // NULLs the other two explicitly, so `user_invitations_tenancy_check` is
    // satisfied by construction rather than by this call site remembering it.
    ...tenancyColumns(tenancy),
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
  let orgName: string | null = null;
  let inviterName: string | null = null;
  let invitedAs: InvitedAs;

  // Resolved OUTSIDE the try because it reaches no database — it is a read of
  // the three FKs already on the row — and `null` here is a refusal the send
  // reports (`no_inviting_org`), not a throw.
  const orgType = tenancyOf(invitation)?.type ?? null;

  try {
    const facts = await lookupSeatInvitationSender(invitation);
    orgName = facts.orgName;
    inviterName = facts.inviterName;
    // INSIDE THE TRY, so a row that contradicts its own CHECK becomes a refusal
    // with a reason rather than an unhandled throw out of a best-effort send.
    invitedAs = invitedAsOf(invitation);
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
      orgName,
      orgType,
      inviterName,
      invitedAs,
      expiresAt: invitation.expiresAt,
    },
    deps
  );
}

/**
 * THE INVITING TENANCY'S OWN NAME — the words the email and the register banner
 * both put in front of the invitee.
 *
 * A SWITCH RATHER THAN THE `TENANCY_COLUMN` LOOKUP, because the three names
 * live in three different TABLES: `churches`, `sending_churches` and
 * `sending_networks` are separate relations, so there is no one column a map
 * could point at. It is exhaustive over `SeatTenancyType`, so a fourth kind
 * fails to compile here rather than resolving to `null` and refusing every
 * send with `no_inviting_org`.
 *
 * `null` for a tenancy row that has been deleted. The send refuses on it — an
 * email that misnames who invited you is indistinguishable from a phishing
 * attempt (`./seat-email` → `no_inviting_org`).
 */
async function tenancyDisplayName(
  tenancy: SeatTenancy
): Promise<string | null> {
  switch (tenancy.type) {
    case "church": {
      const [row] = await db
        .select({ name: churches.name })
        .from(churches)
        .where(eq(churches.id, tenancy.id))
        .limit(1);
      return row?.name ?? null;
    }
    case "sending_church": {
      const [row] = await db
        .select({ name: sendingChurches.name })
        .from(sendingChurches)
        .where(eq(sendingChurches.id, tenancy.id))
        .limit(1);
      return row?.name ?? null;
    }
    case "network": {
      const [row] = await db
        .select({ name: sendingNetworks.name })
        .from(sendingNetworks)
        .where(eq(sendingNetworks.id, tenancy.id))
        .limit(1);
      return row?.name ?? null;
    }
  }
}

/**
 * Who the email says it is from: the inviting tenancy, and the person who
 * pressed Send.
 *
 * THE TENANCY COMES OFF THE ROW IN HAND, through the same `tenancyOf` a session
 * goes through — `user_invitations` carries the same three FKs under the same
 * exactly-one CHECK, so the invitation projection IS `TenancyFields`. A row that
 * contradicts its own CHECK resolves to no tenancy and the send refuses, which
 * is the same answer a deleted org gets.
 */
async function lookupSeatInvitationSender(
  invitation: UserInvitation
): Promise<{ orgName: string | null; inviterName: string | null }> {
  const tenancy = tenancyOf(invitation);

  const [inviter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, invitation.inviterUserId))
    .limit(1);

  return {
    orgName: tenancy ? await tenancyDisplayName(tenancy) : null,
    inviterName: inviter?.name ?? null,
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
  return tenancyMatches(invitingTenancy(actor));
}

/** Every seat invitation this tenancy has issued, newest first. */
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
 * `invitedAs` is the union rather than a nullable seat, so the sign-up path cannot
 * read a seat off a coach invitation and grant one (#496).
 */
export type UserRegistrationInvitation = {
  id: string;
  inviteeEmail: string;
  /**
   * THE TENANCY THE SEAT IS GRANTED IN — a plant, a sending church or a network
   * (#500). It is the same value the invitation row was written with, so
   * registration writes back the FK the inviter chose and can write no other.
   */
  tenancy: SeatTenancy;
  /** That tenancy's own name, for the banner and the email. */
  tenancyName: string;
  invitedAs: InvitedAs;
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

  // NO JOIN ANY MORE, because there is no ONE table to join: the inviting
  // tenancy is one of three relations (#500). The three FKs are selected
  // instead and resolved by `tenancyOf` — the same function the session goes
  // through — and the name is then a point read on whichever table it named.
  const [row] = await db
    .select({
      id: userInvitations.id,
      kind: userInvitations.kind,
      inviteeEmail: userInvitations.inviteeEmail,
      churchId: userInvitations.churchId,
      sendingChurchId: userInvitations.sendingChurchId,
      sendingNetworkId: userInvitations.sendingNetworkId,
      seat: userInvitations.seat,
    })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.tokenHash, hashUserInvitationToken(candidate)),
        eq(userInvitations.status, "pending"),
        gt(userInvitations.expiresAt, now)
      )
    )
    .limit(1);

  if (!row) return null;

  const tenancy = tenancyOf(row);
  if (!tenancy) return null;

  // Narrowed rather than cast: a `seat` row with no seat contradicts
  // `user_invitations_seat_check`, and it is read as no invitation at all — the
  // same `null` an unknown token gets, which is the only answer this route is
  // allowed to distinguish.
  const invitedAs: InvitedAs | null =
    row.kind === "coach"
      ? { kind: "coach" }
      : row.seat
        ? { kind: "seat", seat: row.seat }
        : null;

  if (!invitedAs) return null;

  // The tenancy row itself is gone — the same `null` an unknown token gets. The
  // join this replaced was an INNER one, so a missing org already produced
  // exactly this answer.
  const tenancyName = await tenancyDisplayName(tenancy);
  if (!tenancyName) return null;

  return {
    id: row.id,
    inviteeEmail: row.inviteeEmail,
    tenancy,
    tenancyName,
    invitedAs,
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
