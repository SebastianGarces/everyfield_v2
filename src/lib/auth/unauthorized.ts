/**
 * THE SESSIONLESS REFUSAL — one type, one marker, one way out (#508).
 *
 * `verifySession()` throws when there is no session, and every export of a
 * `"use server"` module is a POST endpoint an anonymous caller can reach
 * (`memory/invariants.md` → Authentication). What that caller gets back is the
 * whole point: a throw is a 500 with a digest and no information, while a
 * `{ success: false, error: "You must be logged in …" }` is a well-formed
 * answer from an endpoint that should only ever have said no.
 *
 * Both shapes shipped. `people/action-context.ts` and `teams/action-shell.ts`
 * rethrew; launch, phase, meetings and feedback caught the throw and converted
 * it — six modules, two answers to the same request. This module is the one
 * answer, and it is a FUNCTION rather than a rule in prose because a rule in
 * prose is what the four modules were already breaking.
 *
 * IT IS AN IMPORT-FREE LEAF ON PURPOSE. `(dashboard)/error.tsx` is a client
 * component and has to read the marker; anything this module imported would be
 * pulled into that bundle behind it.
 */

/**
 * The digest the refusal carries across the server→client boundary.
 *
 * A client error boundary is handed `{ message, digest }` and nothing else —
 * in production Next.js replaces the message with a generic sentence, so the
 * digest is the ONLY channel a boundary can classify on. Next.js keeps a digest
 * the error already has ("If the error already has a digest, respect the
 * original digest" — `next/dist/server/app-render/create-error-handler.js`) and
 * hashes the message and stack only when there is none, so a digest set here
 * arrives at the boundary unchanged.
 *
 * It is a CONSTANT, not a hash, because the boundary compares it: a value
 * derived from the message would change the moment somebody rewords the throw.
 */
export const SESSION_EXPIRED_DIGEST = "EF_SESSION_EXPIRED";

/**
 * The message `verifySession()` has always thrown. Kept as the message, and
 * exported, so the twenty-odd call sites and tests that read it have one
 * spelling to import instead of a string literal each.
 */
export const UNAUTHORIZED_MESSAGE = "Unauthorized";

/**
 * What `verifySession()` throws with no session.
 *
 * A subclass rather than a plain `Error` for exactly one reason: it can carry
 * `digest`. The message is unchanged, so every `error.message === "Unauthorized"`
 * that predates this class still reads true.
 */
export class UnauthorizedError extends Error {
  readonly digest = SESSION_EXPIRED_DIGEST;

  constructor() {
    super(UNAUTHORIZED_MESSAGE);
    this.name = "UnauthorizedError";
  }
}

/**
 * Is this the sessionless refusal?
 *
 * The MESSAGE and not `instanceof`, because the throw crosses module and bundle
 * boundaries where a class identity does not survive, and because a stray
 * `new Error("Unauthorized")` written anywhere in the product means the same
 * thing to a caller and must leave the same way.
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && error.message === UNAUTHORIZED_MESSAGE;
}

/**
 * THE ONE LINE EVERY ACTION CATCH OPENS WITH when its guard sits inside the
 * `try`: hand the sessionless refusal back to the framework, then carry on
 * classifying whatever else was thrown.
 *
 * Shaped like `unstable_rethrow` — a `void` call that throws — so it reads as a
 * statement rather than as a branch somebody can return out of, and so the
 * classification below it never has to mention `Unauthorized` at all.
 *
 * `server-action-surface.test.ts` asserts every such catch reaches this, so a
 * new action cannot quietly go back to answering an anonymous POST.
 */
export function rethrowUnauthorized(error: unknown): void {
  if (isUnauthorized(error)) throw error;
}

/**
 * Did this error boundary catch the sessionless refusal? The client half of the
 * marker, and the reason `(dashboard)/error.tsx` can say "your sign-in may have
 * expired" about the one case where that is true instead of about every 500 —
 * it told a reader that about a database failure during #498's validation.
 *
 * It takes `unknown` because that is what a boundary honestly holds: React
 * hands the component whatever the flight stream carried, and the `Error &
 * { digest?: string }` in the prop type is a claim about it, not a proof. The
 * `in` narrowing needs no cast to check the one field that matters.
 */
export function isSessionExpiry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    error.digest === SESSION_EXPIRED_DIGEST
  );
}
