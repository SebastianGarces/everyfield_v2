// ============================================================================
// The one shell every team action runs in. Deliberately NOT a "use server"
// module: nothing here is an endpoint (memory/invariants.md → Authentication —
// the export list of a "use server" module IS the auth surface).
//
// Every action in actions.ts / queries.ts used to repeat the same 12 lines:
// verifySession → churchId guard → optional zod parse with a cast →
// service call → revalidate → two-branch catch. The repetition is why the
// revalidate paths and the error-message policy drifted per action; this
// module is the single place where "what a team action does" is stated.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { verifySession } from "@/lib/auth/session";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/** The actor every team action mints from the session — never from an argument. */
export interface ChurchActor {
  churchId: string;
  userId: string;
}

async function runAsChurchActor<T>(
  fallbackError: string,
  reportErrorMessages: boolean,
  run: (actor: ChurchActor) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  try {
    const { user } = await verifySession();
    if (!user.churchId) {
      return { success: false, error: "No church associated" };
    }
    return await run({ churchId: user.churchId, userId: user.id });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return { success: false, error: "You must be logged in" };
    }
    if (reportErrorMessages && error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: fallbackError };
  }
}

/**
 * Run a team action as the session's church actor. A thrown service error is
 * reported as `fallbackError` — the caller never sees the raw message.
 */
export function withChurch<T>(
  fallbackError: string,
  run: (actor: ChurchActor) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  return runAsChurchActor(fallbackError, false, run);
}

/**
 * Like `withChurch`, but a thrown Error's own message is surfaced ("Person not
 * found", "Membership not found", …), with `fallbackError` for non-Errors.
 * Two explicit shells rather than a boolean flag: today's actions genuinely
 * differ in this policy, and unifying it is a product DECISION, not a refactor.
 */
export function withChurchReportingErrors<T>(
  fallbackError: string,
  run: (actor: ChurchActor) => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  return runAsChurchActor(fallbackError, true, run);
}

/** The one home of the flatten-and-cast every action used to repeat. */
export function fieldErrorResult(error: z.ZodError): {
  success: false;
  error: string;
  fieldErrors: Record<string, string[]>;
} {
  return {
    success: false,
    error: "Validation failed",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/**
 * FormData → plain object for a zod parse, dropping empty strings so an
 * untouched optional field stays undefined (→ NULL in the DB) instead of
 * becoming "" — and so an unselected enum (Radix Select posts "") does not
 * fail validation. The schemas own type coercion; this owns only that rule.
 */
export function formEntries(
  formData: FormData
): Record<string, FormDataEntryValue> {
  const entries: Record<string, FormDataEntryValue> = {};
  formData.forEach((value, key) => {
    if (value !== "") entries[key] = value;
  });
  return entries;
}

/**
 * Repaint every surface a team mutation can change: the /teams overview and
 * the whole /teams/[teamId] layout subtree (detail header, roster, training
 * matrix, meetings). The layout form is the documented dynamic-segment call
 * (.next-docs → revalidatePath): a URL-form revalidate of one page left the
 * sibling pages and the layout stale, which is exactly how removeMember and
 * the training actions ended up repainting nothing the user was looking at.
 */
export function revalidateTeamSurfaces(): void {
  revalidatePath("/teams");
  revalidatePath("/teams/[teamId]", "layout");
}
