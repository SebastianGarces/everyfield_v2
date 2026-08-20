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
//     verbatim. `resendSeatInvitationEmailAs` rotates `token_hash` and the email
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
// address lookup in `createSeatInvitationAs` is that resolution, so every check
// that can compose a LEGIBLE refusal runs ABOVE it: the authority check, the
// email parse, the duplicate-pending check and the cap all read the caller's own
// tenancy's rows for an address the caller itself typed, and answer identically
// whether or not an account exists behind it. Below the lookup there is exactly
// one sentence, and it is the imported constant.
// ============================================================================

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  userInvitations,
  users,
  type InvitableSeat,
  type NewUserInvitation,
  type UserInvitation,
} from "@/db/schema";
import { assertSeatFor } from "@/lib/auth/seat-rules";

import {
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  INVITATION_EXPIRY_DAYS,
  INVITES_PER_INVITEE_PER_WINDOW,
  InvitationError,
  isUuid,
  normalizeInviteeEmail,
  type InvitationActor,
} from "./core";
import { INVITATION_NOT_OURS_MESSAGE, resendRefusalMessage } from "./resend";
import { resendDedupeWindowAt, type ResendDedupeWindow } from "./resend-window";
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
export function newSeatInvitationToken(): string {
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
export function hashSeatInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ----------------------------------------------------------------------------
// The refusal predicate
// ----------------------------------------------------------------------------

/**
 * REGISTER-ONLY, AS ONE PURE FUNCTION (AS-010).
 *
 * Any existing account is refused, whatever it is: a plant Owner, an Admin, a
 * Member, an oversight seat, or a coach holding no seat at all. There is
 * deliberately no arm that admits one — a seat invitation is answered by
 * registering, and somebody who already has an account cannot register again, so
 * an admitted account would produce an invitation nobody could answer.
 *
 * Pure, and total over "is there a row", so the property AS-010 states is
 * executable across every kind of account without a database.
 */
export function seatInviteeRefusal(existingAccount: unknown): string | null {
  return existingAccount ? ACCOUNT_NOT_INVITABLE_MESSAGE : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The window every count in this file is taken inside — the SERVER's instant. */
function rateLimitWindowStart(now: Date): Date {
  return new Date(now.getTime() - INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * What an Owner or Admin reads when their plant has used up its attempts at one
 * address.
 *
 * It names the plant's OWN behaviour and nothing else — how many invitations
 * THEY sent, to an address THEY typed — so it is legible without being an
 * oracle, and it is only reachable from ABOVE the address lookup.
 */
export const SEAT_INVITE_RATE_LIMITED_MESSAGE =
  "You have already sent that address several invitations recently — wait for them to sign up, or reach them another way";

export const SEAT_INVITE_DUPLICATE_MESSAGE =
  "There is already a pending invitation to that address — revoke it first";

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
export function seatInvitesFromChurchToAddressQuery(
  churchId: string,
  inviteeEmail: string,
  since: Date
) {
  return db
    .select({ id: userInvitations.id })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.kind, "seat"),
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

/** What a client may say: WHO, and WHICH SEAT. That is the whole of it. */
export interface SeatInvitationRequest {
  inviteeEmail: string;
  seat: InvitableSeat;
}

/** What a create produces. The token is returned for the EMAIL and nothing else. */
export interface CreatedSeatInvitation {
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
export async function createSeatInvitationAs(
  actor: InvitationActor,
  request: SeatInvitationRequest,
  deps: SeatInvitationEmailDeps = {},
  now: Date = new Date()
): Promise<CreatedSeatInvitation> {
  // AUTHORITY FIRST, and specifically before the address is looked up: the
  // lookup's refusal is a fact about a stranger, and handing it to somebody who
  // may not invite at all would be an account-enumeration oracle for free.
  // `seat.invitation.manage` is ADMIN_PLUS on a plant tenancy, so a Member is
  // refused here as well as at the action's own `requireSeat` (AS-010).
  assertSeatFor(actor, "seat.invitation.manage");

  const churchId = invitingChurchId(actor);
  const inviteeEmail = normalizeInviteeEmail(request.inviteeEmail);

  if (!EMAIL_RE.test(inviteeEmail)) {
    throw new InvitationError(INVALID_EMAIL_MESSAGE);
  }

  // THIS PLANT'S OWN ROWS, for an address this plant typed. Legible, and
  // deliberately above the lookup so it cannot become a statement about the
  // person behind the address.
  const [duplicate] = await db
    .select({ id: userInvitations.id })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.kind, "seat"),
        eq(userInvitations.churchId, churchId),
        eq(userInvitations.inviteeEmail, inviteeEmail),
        eq(userInvitations.status, "pending"),
        gt(userInvitations.expiresAt, now)
      )
    )
    .limit(1);

  if (duplicate) {
    throw new InvitationError(SEAT_INVITE_DUPLICATE_MESSAGE);
  }

  // THE CAP, counting EVERY status (AS-010). Also above the lookup, and for the
  // same reason: a cap that applied only to invitable addresses would itself be
  // a probe.
  const recent = await seatInvitesFromChurchToAddressQuery(
    churchId,
    inviteeEmail,
    rateLimitWindowStart(now)
  );
  if (recent.length >= INVITES_PER_INVITEE_PER_WINDOW) {
    throw new InvitationError(SEAT_INVITE_RATE_LIMITED_MESSAGE);
  }

  // THE RESOLUTION. Everything from here down speaks about a stranger, so there
  // is exactly one sentence available and it is the imported constant.
  //
  // The projection is a single column: answering "does this address hold an
  // account" must not pull `password_hash` into application memory (the same
  // reasoning as `accessColumns` in `@/lib/notifications/enqueue`).
  const [existingAccount] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, inviteeEmail))
    .limit(1);

  const refusal = seatInviteeRefusal(existingAccount);
  if (refusal) {
    throw new InvitationError(refusal);
  }

  const token = newSeatInvitationToken();
  const row: NewUserInvitation = {
    kind: "seat",
    inviteeEmail,
    churchId,
    seat: request.seat,
    tokenHash: hashSeatInvitationToken(token),
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

  try {
    const facts = await lookupSeatInvitationSender(invitation);
    churchName = facts.churchName;
    inviterName = facts.inviterName;
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
      seat: invitation.seat ?? "member",
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
 */
function oursFilter(actor: InvitationActor) {
  return and(
    eq(userInvitations.kind, "seat"),
    eq(userInvitations.churchId, invitingChurchId(actor))
  );
}

/** Every seat invitation this plant has issued, newest first. */
export async function listSeatInvitationsFor(
  actor: InvitationActor
): Promise<UserInvitation[]> {
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
export async function revokeSeatInvitationAs(
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

export const SEAT_INVITATION_EXPIRED_MESSAGE =
  "That invitation has expired — invite them again to send a new link";

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
 */
export async function resendSeatInvitationEmailAs(
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
    throw new InvitationError(SEAT_INVITATION_EXPIRED_MESSAGE);
  }

  // THE ROTATION, as a compare-and-set on `pending`: a revoke that lands first
  // wins, and this path then finds no row to email.
  const token = newSeatInvitationToken();
  const rotated = await db
    .update(userInvitations)
    .set({ tokenHash: hashSeatInvitationToken(token) })
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
    // A DELIBERATE resend, which is what keeps the provider from deduping it
    // against the key the create already presented for this same invitation.
    occasion: { kind: "resend", at: now },
  });

  if (!outcome.sent) {
    throw new InvitationError(resendRefusalMessage(outcome.reason));
  }

  // `now` — the instant the occasion above was keyed with, not a second reading
  // of the clock.
  return { emailSent: true, resendWindow: resendDedupeWindowAt(now) };
}

// ----------------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------------

/**
 * What `/register` needs to know about a seat token. Everything here is either
 * the reader's own address or the plant's public name — nothing about any other
 * account, and NOT the token, which the browser already holds in its URL.
 */
export type SeatRegistrationInvitation = {
  id: string;
  inviteeEmail: string;
  churchId: string;
  churchName: string;
  seat: InvitableSeat;
};

/**
 * Look a token up for the register screen.
 *
 * `null` for anything a visitor must not be told about — unknown, answered,
 * revoked, expired — so a guessed token learns exactly what a wrong one does.
 * There is no branch here that varies on whether an ACCOUNT exists, because a
 * seat invitation is only ever created for an address that had none.
 *
 * Runs with NO session, by construction: there is no account yet.
 */
export async function describeSeatInvitationForRegistration(
  token: string | null | undefined,
  now: Date = new Date()
): Promise<SeatRegistrationInvitation | null> {
  const candidate = (token ?? "").trim();
  if (candidate.length === 0) return null;

  try {
    const [row] = await db
      .select({
        id: userInvitations.id,
        inviteeEmail: userInvitations.inviteeEmail,
        churchId: userInvitations.churchId,
        churchName: churches.name,
        seat: userInvitations.seat,
      })
      .from(userInvitations)
      .innerJoin(churches, eq(churches.id, userInvitations.churchId))
      .where(
        and(
          eq(userInvitations.tokenHash, hashSeatInvitationToken(candidate)),
          eq(userInvitations.kind, "seat"),
          eq(userInvitations.status, "pending"),
          gt(userInvitations.expiresAt, now)
        )
      )
      .limit(1);

    if (!row || !row.churchId || !row.seat) return null;

    return {
      id: row.id,
      inviteeEmail: row.inviteeEmail,
      churchId: row.churchId,
      churchName: row.churchName,
      seat: row.seat,
    };
  } catch {
    return null;
  }
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
export function seatInvitationActedOnAtRegistration(
  described: SeatRegistrationInvitation | null,
  registeringEmail: string
): SeatRegistrationInvitation | null {
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
 * `describeSeatInvitationForRegistration` and this batch leaves an account
 * created with the seat while the invitation reads `revoked`. What makes the
 * link SINGLE USE is not this compare-and-set but `users_email_unique` — the
 * token is bound to one address, so at most one account can ever be created for
 * it, and a second attempt is refused as a duplicate account. Closing the
 * revoke race as well would need the users insert itself to be conditional on
 * the invitation, which is an `INSERT … SELECT` guarding a millisecond.
 */
export function claimSeatInvitationStatement(
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
export async function expireLapsedSeatInvitations(
  actor: InvitationActor,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(userInvitations)
    .set({ status: "expired" })
    .where(
      and(
        oursFilter(actor),
        eq(userInvitations.status, "pending"),
        sql`${userInvitations.expiresAt} < ${now}`
      )
    );
}
