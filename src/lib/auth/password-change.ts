// ============================================================================
// CHANGING AN ACCOUNT'S OWN PASSWORD — CS-003 / CS-005 (#616).
//
// NO `"use server"` DIRECTIVE, for the reason `./email-change.ts` has none:
// every export of such a module is a POSTable endpoint reachable with no
// session and no UI, so the logic lives here and the action module is the only
// way in from a browser.
//
// ----------------------------------------------------------------------------
// THE CURRENT PASSWORD IS THE WHOLE GUARD, SO IT RIDES THE SAME LIMIT AS A
// SIGN-IN
// ----------------------------------------------------------------------------
//
// A session cookie is a bearer credential: whoever holds one is, to this
// endpoint, the account. What stops a borrowed session from taking the account
// permanently is that the change demands the CURRENT password — and a demand
// for a secret is a thing to guess at, which is a sign-in by another name. So
// `password_change` is `login`'s policy applied to `login`'s guard, keyed on
// the account's own address (CS-005: one implementation, never a second copy).
//
// ----------------------------------------------------------------------------
// EVERY OTHER SESSION ENDS
// ----------------------------------------------------------------------------
//
// The reason somebody changes a password is usually that they think somebody
// else has it. Leaving the other sessions alive would answer that fear with
// nothing: the attacker's cookie outlives the rotation and the password they
// stole never mattered. So the rotation and the revocation are ONE `db.batch` —
// all-or-nothing, so there is no state where the password moved and the old
// sessions survived.
//
// THE CALLER'S OWN SESSION IS KEPT, by id, and that is a deliberate exception
// rather than an oversight: signing somebody out of the tab they are typing in
// makes the confirmation unreadable, and it is the one session we know belongs
// to whoever just proved they know the current password.
// ============================================================================

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";

import { normalizeAccountEmail } from "./account-email";
import {
  CURRENT_PASSWORD_WRONG_MESSAGE,
  MIN_PASSWORD_LENGTH,
  PASSWORD_CHANGE_RATE_LIMITED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORD_UNCHANGED_MESSAGE,
} from "./password-policy";
import { REAL_ATTEMPT_LIMITER, type AttemptLimiter } from "./attempt-limiter";
import { checkRateLimit } from "./rate-limit";
import { hashPassword, verifyPassword } from "./password";

export type PasswordChangeActor = Pick<User, "id" | "email" | "passwordHash">;

export type PasswordChangeOutcome =
  | { ok: true; otherSessionsEnded: number }
  | {
      ok: false;
      /**
       * WHICH INPUT IS WRONG, so the form can point at it (CS-003: "a failed
       * save names the field"). `null` means the failure is about the attempt
       * rather than about a field the reader typed.
       */
      field: "currentPassword" | "newPassword" | null;
      message: string;
    };

/**
 * Rotate this account's password.
 *
 * ORDER, AND WHY IT IS THIS ONE:
 *
 *   1. The guard, before the hash comparison (CS-005) — argon2id is deliberately
 *      expensive, so verifying first would make the endpoint its own CPU
 *      exhaustion vector for a caller who is already over the limit.
 *   2. The new password's own shape, which is about what the reader typed.
 *   3. The current password, verified against the actor's stored hash. A wrong
 *      one is RECORDED as a failed attempt and refused — that record is what
 *      drives the window to refusal.
 *   4. The rotation and the revocation, in ONE batch.
 *   5. The success, recorded, which clears this identifier's failed rows inside
 *      the window (ruled 405-4b) so a fumbled attempt does not follow somebody
 *      into their next real one.
 */
export async function changeOwnPassword({
  actor,
  currentSessionId,
  currentPassword,
  newPassword,
  ip,
  now = new Date(),
  limiter = REAL_ATTEMPT_LIMITER,
}: {
  actor: PasswordChangeActor;
  /** The session doing the asking — the one session that survives. */
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
  ip: string | null;
  now?: Date;
  limiter?: AttemptLimiter;
}): Promise<PasswordChangeOutcome> {
  const identifier = normalizeAccountEmail(actor.email);

  const { limited } = await checkRateLimit(
    identifier,
    ip,
    "password_change",
    limiter.count
  );
  if (limited) {
    return {
      ok: false,
      field: null,
      message: PASSWORD_CHANGE_RATE_LIMITED_MESSAGE,
    };
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: "newPassword",
      message: PASSWORD_TOO_SHORT_MESSAGE,
    };
  }

  if (!(await verifyPassword(actor.passwordHash, currentPassword))) {
    await limiter.record(identifier, ip, "password_change", false);
    return {
      ok: false,
      field: "currentPassword",
      message: CURRENT_PASSWORD_WRONG_MESSAGE,
    };
  }

  // ASKED AFTER THE CURRENT PASSWORD IS PROVEN, not before. `verifyPassword`
  // against the SAME hash answers "is the new one the old one" — running that
  // comparison first would turn this refusal into a free oracle for a caller
  // who does not know the current password at all.
  if (await verifyPassword(actor.passwordHash, newPassword)) {
    return {
      ok: false,
      field: "newPassword",
      message: PASSWORD_UNCHANGED_MESSAGE,
    };
  }

  const passwordHash = await hashPassword(newPassword);

  const [, revoked] = await db.batch([
    db
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, actor.id)),
    db
      .delete(sessions)
      .where(
        and(eq(sessions.userId, actor.id), ne(sessions.id, currentSessionId))
      )
      .returning({ id: sessions.id }),
  ]);

  await limiter.record(identifier, ip, "password_change", true);

  return { ok: true, otherSessionsEnded: revoked.length };
}
