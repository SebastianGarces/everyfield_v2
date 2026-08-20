/**
 * Shared envelope for the people server actions.
 *
 * Deliberately NOT a "use server" module: the export list of a "use server"
 * module IS the auth surface (memory/invariants.md → Authentication), and
 * these helpers are not endpoints. The action modules import from here.
 */

import type { User } from "@/db/schema";
import { requireSeat } from "@/lib/auth/seats";
import { SeatRefusalError, type Capability } from "@/lib/auth/seat-rules";
import { rethrowUnauthorized } from "@/lib/auth/unauthorized";
import type { ActionResult } from "@/lib/people/types";
import { unstable_rethrow } from "next/navigation";
import type { ZodError } from "zod";

/** What an action body receives once the session and church are verified. */
export interface ChurchActionContext {
  user: User;
  /** `user.churchId`, non-null by construction. */
  churchId: string;
}

/**
 * Domain error strings that pass through to the user unchanged in every
 * action. A per-action `known` table only carries the strings that actually
 * differ (e.g. updatePersonAction's "Person not found or has been deleted").
 */
const DEFAULT_KNOWN_ERRORS: Record<string, string> = {
  "Person not found": "Person not found",
  "Household not found": "Household not found",
  "Tag not found": "Tag not found",
  "Skill not found": "Skill not found",
};

/** What a seat refusal reads as. One sentence for every capability (#498). */
const NOT_PERMITTED_MESSAGE =
  "You do not have permission to do that in this church.";

/** How an action's failures map to user-facing error strings. */
export interface ActionMessages {
  /** Returned when the session user has no church. Default: "Unauthorized". */
  noChurch?: string;
  /**
   * Thrown Error message → returned error string, merged over
   * DEFAULT_KNOWN_ERRORS (an entry here wins). Only list strings that differ
   * from the defaults.
   *
   * `"Unauthorized"` is NOT one of them and cannot be: the catch below rethrows
   * it before this table is consulted, so a sessionless call leaves as a throw
   * (#498). Every action here used to carry a "You must be logged in to …"
   * entry, and every one of them was the handled answer an anonymous caller
   * should never have got.
   */
  known?: Record<string, string>;
  /**
   * Escape hatch for non-exact matching (used by household deletion, whose
   * "Cannot delete household with members…" message is passed through).
   */
  mapError?: (error: Error) => string | undefined;
  /** Returned for anything else. */
  fallback: string;
}

/**
 * The one session + seat + churchId + try/catch envelope every people action
 * shares: check the caller's seat against the capability (which mints the actor
 * — `requireSeat` returns what `verifySession` returned), refuse churchless
 * users, run the body, and map thrown errors to the action's message table
 * (logging the original).
 *
 * THE CAPABILITY IS THE FIRST ARGUMENT so the guard is the first thing this
 * envelope does and, transitively, the first thing every people action does —
 * ahead of the `safeParse` each of them runs inside `fn`. The directory is not
 * one permission: a Member may READ it (`"read"`) and may not write to it
 * (`"people.write"`), and this is where those two answers are told apart.
 */
export async function withChurchSession<T>(
  capability: Capability,
  label: string,
  messages: ActionMessages,
  fn: (ctx: ChurchActionContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  try {
    const { user } = await requireSeat(capability);

    if (!user.churchId) {
      return { success: false, error: messages.noChurch ?? "Unauthorized" };
    }

    return await fn({ user, churchId: user.churchId });
  } catch (error) {
    // redirect()/notFound()/forbidden() work by throwing — hand those back
    // to the framework instead of logging them and returning the fallback.
    unstable_rethrow(error);

    console.error(`${label} error:`, error);

    // A SESSIONLESS CALL THROWS, and it has to leave through here rather than
    // become a handled result. `verifySession` is what `requireSeat` opens on,
    // and converting its `Unauthorized` into `{ success: false, … }` is what
    // gives an anonymous caller a well-formed answer from an endpoint that
    // should only ever have said no (`memory/invariants.md` → Authentication).
    //
    // WHERE IT LANDS FOR A REAL PERSON: `src/app/(dashboard)/error.tsx`, which
    // reads the `SESSION_EXPIRED_DIGEST` this throw carries and says the
    // sign-in probably expired. Before that boundary existed the only one in
    // the tree was `global-error.tsx`, which swaps in a bare document — so this
    // rethrow was a blank page on a filled-in form. A seat refusal does NOT go
    // that way; it is answered inline below, because "you may not do this" is
    // an answer, not a fault.
    rethrowUnauthorized(error);

    if (error instanceof Error) {
      // The seat refusal, turned into a sentence that does not name the guard.
      // An `instanceof` and not a message prefix: `requireChurchAccess` and the
      // invitation layer also throw `Forbidden: …`, so a prefix test is a
      // classification resting on prose that a reword silently changes.
      if (error instanceof SeatRefusalError) {
        return { success: false, error: NOT_PERMITTED_MESSAGE };
      }

      const known = { ...DEFAULT_KNOWN_ERRORS, ...messages.known }[
        error.message
      ];
      if (known) {
        return { success: false, error: known };
      }

      const mapped = messages.mapError?.(error);
      if (mapped) {
        return { success: false, error: mapped };
      }
    }

    return { success: false, error: messages.fallback };
  }
}

/**
 * Zod issues → the ActionResult fieldErrors shape, keyed by dotted path.
 * Replaces the repeated `flatten().fieldErrors as Record<string, string[]>`
 * cast.
 */
export function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}
