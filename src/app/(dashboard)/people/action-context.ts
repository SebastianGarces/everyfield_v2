/**
 * Shared envelope for the people server actions.
 *
 * Deliberately NOT a "use server" module: the export list of a "use server"
 * module IS the auth surface (memory/invariants.md → Authentication), and
 * these helpers are not endpoints. The action modules import from here.
 */

import type { User } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/people/types";
import type { ZodError } from "zod";

/** What an action body receives once the session and church are verified. */
export interface ChurchActionContext {
  user: User;
  /** `user.churchId`, non-null by construction. */
  churchId: string;
}

/** How an action's failures map to user-facing error strings. */
export interface ActionMessages {
  /** Returned when the session user has no church. Default: "Unauthorized". */
  noChurch?: string;
  /**
   * Thrown Error message → returned error string. Covers the known errors
   * the domain throws: "Unauthorized", "Person not found",
   * "Household not found", "Tag not found", "Skill not found".
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
 * The one session + churchId + try/catch envelope every people action shares:
 * verify the session, refuse churchless users, run the body, and map thrown
 * errors to the action's message table (logging the original).
 */
export async function withChurchSession<T>(
  label: string,
  messages: ActionMessages,
  fn: (ctx: ChurchActionContext) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  try {
    const { user } = await verifySession();

    if (!user.churchId) {
      return { success: false, error: messages.noChurch ?? "Unauthorized" };
    }

    return await fn({ user, churchId: user.churchId });
  } catch (error) {
    console.error(`${label} error:`, error);

    if (error instanceof Error) {
      const known = messages.known?.[error.message];
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
