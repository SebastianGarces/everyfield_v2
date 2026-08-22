// ============================================================================
// WHAT A PASSWORD MUST BE, AND WHAT A REFUSED ONE IS TOLD — CS-003 (#616).
//
// AN IMPORT-FREE LEAF, and that is what it is FOR. `password-change.ts` reaches
// `@/db`, and no `"use client"` module may reach `@/db` — a client component
// that imported one innocent constant from there would pull
// `neon(process.env.DATABASE_URL!)` into a browser chunk and kill the page at
// module evaluation (`src/db/client-boundary.bundle.test.ts`, the #602 outage
// twice over). The form needs the minimum length for its `minLength` and for
// the sentence under the input; the server needs it for the refusal. One
// declaration, reachable from both sides, importing nothing.
//
// The refusal SENTENCES live here for the same reason: a test that asserts what
// a wrong password is told, and a form that renders it, must be reading the
// same string as the check that produces it.
// ============================================================================

/**
 * THE FLOOR, AND IT IS THE ONE REGISTRATION ALREADY APPLIES (`registerSchema`,
 * `@/lib/validations/auth`). A change that demanded more than sign-up did would
 * refuse the password the account was created with, on a screen offering no way
 * to learn why.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_TOO_SHORT_MESSAGE = `Use at least ${MIN_PASSWORD_LENGTH} characters`;

/**
 * WHAT A WRONG CURRENT PASSWORD SAYS — on the password form and on the email
 * form, which demands the same secret for the same reason.
 *
 * It names the field and nothing else. The caller already holds a session, so
 * there is no account existence left to protect, and a vaguer sentence would
 * only make a typo harder to find.
 */
export const CURRENT_PASSWORD_WRONG_MESSAGE =
  "That is not your current password";

export const PASSWORD_UNCHANGED_MESSAGE =
  "Choose a password you are not already using";

export const PASSWORD_CHANGE_RATE_LIMITED_MESSAGE =
  "Too many attempts. Please try again later.";
