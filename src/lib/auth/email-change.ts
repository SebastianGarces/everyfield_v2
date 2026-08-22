// ============================================================================
// CHANGING THE ADDRESS AN ACCOUNT SIGNS IN WITH — CS-002 / CS-005 (#616).
//
// NO `"use server"` DIRECTIVE, and that absence is the point. Every export of
// such a module is a POSTable endpoint reachable with no session and no UI
// (`memory/invariants.md` → Authentication), so the logic lives here and
// `src/app/(dashboard)/settings/account/actions.ts` — which mints its actor from
// `requireSeat("self.write")` — is the only way in from a browser. Same shape,
// same reason, as `@/lib/invitations/seat.ts`.
//
// ----------------------------------------------------------------------------
// THE CHANGE IS TWO STEPS, AND THE SECOND ONE NEEDS BOTH HALVES
// ----------------------------------------------------------------------------
//
// `users.email` IS the login identifier, so it may only ever hold an address
// somebody has proven they can read. Step one writes an `email_change_requests`
// row and mails a token to the new address; step two redeems that token and
// swaps the column. Until it is redeemed the old address still signs in, which
// is what makes a mistyped address a non-event rather than a lockout.
//
// REDEEMING NEEDS THE TOKEN *AND* THE SESSION, deliberately. The token proves
// somebody can read the new mailbox; the session proves they hold the account.
// Either alone is not enough to move a login identifier: a forwarded link
// (deliberately, or by an auto-forward rule nobody remembers setting) would
// otherwise hand the account's front door to whoever received it. So
// `confirmEmailChange` takes the actor and refuses a token issued to anybody
// else — and the surface that calls it sits under `(dashboard)`, whose layout
// bounces a signed-out reader through `/login` carrying the return path.
//
// ----------------------------------------------------------------------------
// AND ASKING NEEDS THE CURRENT PASSWORD
// ----------------------------------------------------------------------------
//
// A session cookie is a bearer credential: whoever holds one is, to a server
// action, the account. The login identifier is itself a credential, so a
// borrowed session must not be able to move it — and the notice to the old
// address is DETECTION, not prevention. Demanding the current password makes
// the two credential changes symmetrical (CS-003 already demands it) and means
// a stolen cookie alone cannot take an account permanently.
//
// It also gives the `email_change` limit something to count besides outstanding
// requests: a wrong password here is a failed attempt exactly as it is on the
// password path.
//
// ----------------------------------------------------------------------------
// WHAT IS DELIBERATELY *NOT* CHECKED WHEN THE CHANGE IS ASKED FOR
// ----------------------------------------------------------------------------
//
// WHETHER THE NEW ADDRESS ALREADY HOLDS AN ACCOUNT. That question is answered
// by `users.email`'s UNIQUE constraint at REDEMPTION time and nowhere else, and
// the reason is the rule this repo already applies to invitations
// (`memory/invariants.md` → Multi-Tenancy): a refusal that only a registered
// address can trigger is an enumeration oracle, and this one would be a
// particularly cheap one — any account holder could test addresses all day from
// a settings form.
//
// Moving the check to redemption costs nothing and gives it away to nobody: by
// the time somebody can redeem, they have READ the mailbox, so telling them
// what is true of it tells them nothing they could not already find out. What
// reaches a stranger's inbox meanwhile is one message saying somebody tried to
// move an account onto their address, which is a security notice they are
// entitled to — capped, per account and per IP, by the guard below.
//
// ----------------------------------------------------------------------------
// ONE LIVE REQUEST PER ACCOUNT, ENFORCED BY THE DATABASE
// ----------------------------------------------------------------------------
//
// `email_change_requests_live_user_unique_idx` is partial on
// `consumed_at IS NULL`, so asking again SUPERSEDES rather than accumulating —
// the supersede and the insert are one `db.batch`, in that order, because the
// index would refuse them the other way round. That is what makes a typo
// self-correcting with no Cancel control to build, and it means an account can
// never be holding two live links whose order nobody can reconstruct.
// ============================================================================

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { emailChangeRequests, users, type User } from "@/db/schema";

import {
  EMAIL_CHANGE_EXPIRY_HOURS,
  hashEmailChangeToken,
  isMailableAddress,
  newEmailChangeToken,
  normalizeAccountEmail,
} from "./email-change-token";
import { REAL_ATTEMPT_LIMITER, type AttemptLimiter } from "./attempt-limiter";
import { verifyPassword } from "./password";
import { CURRENT_PASSWORD_WRONG_MESSAGE } from "./password-policy";
import {
  sendEmailChangeNotice,
  sendEmailChangeVerification,
  type EmailChangeMailDeps,
} from "./email-change-email";

const HOUR_MS = 60 * 60 * 1000;

// ----------------------------------------------------------------------------
// The words
// ----------------------------------------------------------------------------

/**
 * ONE SENTENCE FOR EVERY LINK THAT WILL NOT OPEN — expired, already used,
 * superseded by a later request, unknown, or issued to a different account.
 *
 * Collapsed on purpose. Splitting them would make the refusal a report on a row
 * the reader may have no claim to; and the three cases a legitimate holder
 * actually meets ("I waited too long", "I clicked it twice", "I asked again")
 * all have the same remedy, which the sentence names.
 */
export const EMAIL_CHANGE_LINK_DEAD_MESSAGE =
  "That confirmation link no longer works — ask for the change again from Settings";

/** The address asked for is the one this account already uses. */
export const EMAIL_CHANGE_SAME_ADDRESS_MESSAGE = "That is already your address";

/** What a badly-formed address gets. Field-level, beside the input. */
export const EMAIL_CHANGE_INVALID_ADDRESS_MESSAGE =
  "Enter a valid email address";

/**
 * The ONE refusal that names another account, and the only place it is legible
 * to do so: the reader reached it by opening the mailbox in question.
 */
export const EMAIL_CHANGE_ADDRESS_TAKEN_MESSAGE =
  "That address already belongs to another EveryField account";

/** Both actions, when the account has asked too often too recently. */
export const EMAIL_CHANGE_RATE_LIMITED_MESSAGE =
  "You have asked to change your address several times recently — confirm one of those links, or try again later";

// ----------------------------------------------------------------------------
// Step one — asking
// ----------------------------------------------------------------------------

/** What the actor is, here. The session's own row, never an argument a POST names. */
export type EmailChangeActor = Pick<
  User,
  "id" | "email" | "name" | "passwordHash"
>;

export type EmailChangeRequestOutcome =
  | {
      ok: true;
      /** The address the link went to, so the surface can name it back. */
      newEmail: string;
      /**
       * Whether the provider accepted the message. `false` is still `ok` — the
       * ROW is the durable thing and the reader needs to be told the mail did
       * not leave, not have the whole request rolled back under them.
       */
      emailSent: boolean;
    }
  | {
      ok: false;
      /**
       * WHICH INPUT IS WRONG, so the form can point at it (CS-002: "a failed
       * save names the field"). `null` means the failure is about the request
       * rather than about a field the reader typed.
       */
      field: "email" | "currentPassword" | null;
      message: string;
    };

/**
 * The statement that ends every live request this account is holding.
 *
 * It runs BEFORE the insert in the same batch, because
 * `email_change_requests_live_user_unique_idx` refuses the other order — so
 * "asking again supersedes the last ask" is enforced by the index rather than by
 * a sequence somebody has to remember.
 */
export function supersedeLiveRequestsStatement(userId: string, at: Date) {
  return db
    .update(emailChangeRequests)
    .set({ consumedAt: at })
    .where(
      and(
        eq(emailChangeRequests.userId, userId),
        isNull(emailChangeRequests.consumedAt)
      )
    );
}

/**
 * Ask to move this account to `requestedEmail`.
 *
 * `users.email` IS NOT TOUCHED. The old address keeps signing in until the link
 * in the new mailbox is opened, which is the whole safety property of the flow.
 *
 * ORDER, AND WHY IT IS THIS ONE:
 *
 *   1. The guard, before anything is written or sent (CS-005). Its identifier
 *      is the account's CURRENT address — see `RATE_LIMITS` for why the target
 *      would be the wrong key.
 *   2. The parse and the same-address check, which speak about what the reader
 *      typed and about their own account, and about nothing else — and cost no
 *      argon2 pass, so a typo is answered without spending one.
 *   3. The current password, verified against the actor's stored hash. A wrong
 *      one is RECORDED as a failed attempt and refused by field.
 *   4. ONE batch: supersede, then insert. The partial unique index refuses the
 *      other order, so the sequence is not a convention anybody has to hold.
 *   5. The send, best-effort, AFTER the row is durable — a token that reached an
 *      inbox with no row behind it is a link that cannot be honoured.
 *   6. The attempt, recorded as NOT SUCCEEDED. An outstanding request is an
 *      unfinished attempt; `confirmEmailChange` records the success that clears
 *      it (see `RATE_LIMITS`).
 */
export async function requestEmailChange({
  actor,
  requestedEmail,
  currentPassword,
  ip,
  now = new Date(),
  mail = {},
  limiter = REAL_ATTEMPT_LIMITER,
}: {
  actor: EmailChangeActor;
  requestedEmail: string;
  currentPassword: string;
  ip: string | null;
  now?: Date;
  mail?: EmailChangeMailDeps;
  limiter?: AttemptLimiter;
}): Promise<EmailChangeRequestOutcome> {
  const identifier = normalizeAccountEmail(actor.email);

  const { limited } = await limiter.check(identifier, ip, "email_change");
  if (limited) {
    return {
      ok: false,
      field: null,
      message: EMAIL_CHANGE_RATE_LIMITED_MESSAGE,
    };
  }

  const newEmail = normalizeAccountEmail(requestedEmail);
  if (!isMailableAddress(newEmail)) {
    return {
      ok: false,
      field: "email",
      message: EMAIL_CHANGE_INVALID_ADDRESS_MESSAGE,
    };
  }
  if (newEmail === identifier) {
    return {
      ok: false,
      field: "email",
      message: EMAIL_CHANGE_SAME_ADDRESS_MESSAGE,
    };
  }

  if (!(await verifyPassword(actor.passwordHash, currentPassword))) {
    await limiter.record(identifier, ip, "email_change", false);
    return {
      ok: false,
      field: "currentPassword",
      message: CURRENT_PASSWORD_WRONG_MESSAGE,
    };
  }

  const token = newEmailChangeToken();
  const expiresAt = new Date(
    now.getTime() + EMAIL_CHANGE_EXPIRY_HOURS * HOUR_MS
  );

  await db.batch([
    supersedeLiveRequestsStatement(actor.id, now),
    db.insert(emailChangeRequests).values({
      userId: actor.id,
      newEmail,
      tokenHash: hashEmailChangeToken(token),
      createdAt: now,
      expiresAt,
    }),
  ]);

  const sent = await sendEmailChangeVerification(
    {
      to: newEmail,
      currentEmail: identifier,
      recipientName: actor.name,
      token,
      expiresAt,
    },
    mail
  );

  await limiter.record(identifier, ip, "email_change", false);

  return { ok: true, newEmail, emailSent: sent };
}

// ----------------------------------------------------------------------------
// Step two — confirming
// ----------------------------------------------------------------------------

/**
 * STATEMENT ONE — THE CLAIM. Consume the request, but only while it is still
 * live and still inside its window.
 *
 * Its `RETURNING` is the whole answer to "did I win this token": a second
 * redemption, a double click or a replay matches nothing and comes back empty
 * (`memory/invariants.md` → Transactions — the compare-and-set goes FIRST).
 *
 * EXPIRY IS ASSERTED HERE and not only in the read above, because the read is a
 * separate round trip. A row that expires between the two would otherwise be
 * redeemed on the strength of a stale snapshot.
 */
export function consumeRequestStatement(requestId: string, now: Date) {
  return db
    .update(emailChangeRequests)
    .set({ consumedAt: now })
    .where(
      and(
        eq(emailChangeRequests.id, requestId),
        isNull(emailChangeRequests.consumedAt),
        sql`${emailChangeRequests.expiresAt} > ${now}`
      )
    )
    .returning({ id: emailChangeRequests.id });
}

/**
 * STATEMENT TWO — THE SWAP, whose `WHERE` RE-ASSERTS WHAT THE CLAIM SET.
 *
 * `users.email = previousEmail` is a compare-and-set on the very row being
 * changed, so this is not "update the account the caller named" — it is "move
 * this account off exactly the address it was on". A replay, a second tab, or a
 * change that landed from somewhere else in between writes NOTHING instead of
 * re-applying a swap whose starting point has moved.
 *
 * `users_email_unique` is what decides whether the new address is free, and it
 * decides it HERE — a failure aborts the whole batch, so the claim rolls back
 * with it and the token survives (see the module header for why the question is
 * not asked earlier).
 */
export function swapLoginIdentifierStatement(
  userId: string,
  previousEmail: string,
  newEmail: string,
  now: Date
) {
  return db
    .update(users)
    .set({ email: newEmail, updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.email, previousEmail)))
    .returning({ id: users.id });
}

export type EmailChangeConfirmOutcome =
  | { ok: true; newEmail: string; previousEmail: string }
  | { ok: false; message: string };

/**
 * The live request this account is holding, if any — what the Account section
 * says "check your inbox" about, and what `/verify-email` names before it asks
 * the reader to confirm.
 *
 * A READ, in a module with no directive, so it is reachable from a Server
 * Component and from nothing a browser can POST.
 */
export async function liveEmailChangeRequest(
  userId: string,
  now: Date = new Date()
): Promise<{ newEmail: string; expiresAt: Date } | null> {
  const [row] = await db
    .select({
      newEmail: emailChangeRequests.newEmail,
      expiresAt: emailChangeRequests.expiresAt,
    })
    .from(emailChangeRequests)
    .where(
      and(
        eq(emailChangeRequests.userId, userId),
        isNull(emailChangeRequests.consumedAt)
      )
    )
    .limit(1);

  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

/**
 * Redeem a confirmation token and swap the login identifier.
 *
 * THE CLAIM GOES FIRST AND THE DEPENDENT WRITE RE-ASSERTS IT
 * (`memory/invariants.md` → Transactions). Statement one consumes the request,
 * predicated on it still being live and unexpired; statement two swaps
 * `users.email`, predicated on the row still holding the address this actor
 * signed in with. That second predicate is a compare-and-set on the row being
 * changed, so a replay, a double click, or a second tab writes nothing rather
 * than re-applying a swap whose starting point has moved.
 *
 * A ZERO ROWCOUNT IS NOT A ROLLBACK. `db.batch` is all-or-nothing on FAILURE
 * only, so both statements return and the caller answers on the claim's
 * rowcount — the same shape `removeSeat` uses.
 *
 * A UNIQUE VIOLATION ON `users.email` IS THE EXPECTED REFUSAL, not a bug: it is
 * where "is this address free" is asked (see the header), and it aborts the
 * whole batch, so the token survives for an address that later frees up.
 */
export async function confirmEmailChange({
  actor,
  token,
  ip,
  now = new Date(),
  mail = {},
  limiter = REAL_ATTEMPT_LIMITER,
}: {
  actor: EmailChangeActor;
  token: string;
  ip: string | null;
  now?: Date;
  mail?: EmailChangeMailDeps;
  limiter?: AttemptLimiter;
}): Promise<EmailChangeConfirmOutcome> {
  const previousEmail = normalizeAccountEmail(actor.email);

  const { limited } = await limiter.check(previousEmail, ip, "email_change");
  if (limited) {
    return { ok: false, message: EMAIL_CHANGE_RATE_LIMITED_MESSAGE };
  }

  const [request] = await db
    .select()
    .from(emailChangeRequests)
    .where(eq(emailChangeRequests.tokenHash, hashEmailChangeToken(token)))
    .limit(1);

  // ONE ANSWER FOR ALL FIVE DEAD CASES — unknown token, consumed, expired,
  // superseded (which sets `consumed_at`), and issued to another account. See
  // `EMAIL_CHANGE_LINK_DEAD_MESSAGE`.
  if (
    !request ||
    request.userId !== actor.id ||
    request.consumedAt !== null ||
    request.expiresAt.getTime() <= now.getTime()
  ) {
    return { ok: false, message: EMAIL_CHANGE_LINK_DEAD_MESSAGE };
  }

  const newEmail = request.newEmail;

  let claimed;
  try {
    [claimed] = await db.batch([
      consumeRequestStatement(request.id, now),
      swapLoginIdentifierStatement(actor.id, previousEmail, newEmail, now),
    ]);
  } catch (error) {
    if (isUniqueViolation(error, "users_email_unique")) {
      return { ok: false, message: EMAIL_CHANGE_ADDRESS_TAKEN_MESSAGE };
    }
    throw error;
  }

  if (claimed.length === 0) {
    return { ok: false, message: EMAIL_CHANGE_LINK_DEAD_MESSAGE };
  }

  // THE OLD ADDRESS IS TOLD, AND IT NAMES WHERE THE ACCOUNT WENT (CS-002).
  // Best-effort, like every other send here: the change has committed, and a
  // provider outage must not un-commit it. The notice is what makes an
  // unauthorised change visible to the person who can act on it, so it names
  // the new address in full — a masked one would tell them something happened
  // and leave them nothing to check it against.
  await sendEmailChangeNotice(
    {
      to: previousEmail,
      newEmail,
      recipientName: actor.name,
      changedAt: now,
    },
    mail
  );

  // The success that CLEARS the window, recorded against the address every
  // request in it was recorded against — the OLD one (ruled 405-4b).
  await limiter.record(previousEmail, ip, "email_change", true);

  return { ok: true, newEmail, previousEmail };
}
