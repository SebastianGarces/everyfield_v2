import { z } from "zod";

// ============================================================================
// Launch — boundary validation.
//
// Separate from `service.ts` so a form, an action and a seed script can all
// validate a date without importing `@/db` (Zod at every boundary; the service
// re-validates anyway, since the action layer is not the only caller).
// ============================================================================

/**
 * `launches.target_date` is a `date` column — a calendar DAY the plant is aiming
 * at, not an instant — so it is carried as `YYYY-MM-DD` end to end and never
 * round-tripped through a `Date`. A naive day parsed in the runtime's zone is a
 * different day on the server than in the browser (memory/invariants.md → Date
 * & Time Rendering).
 *
 * The regex is a shape check, not a calendar check: `2026-02-31` passes here and
 * is refused by Postgres. `.refine` closes that, so the user is told rather than
 * shown a driver error.
 */
export const launchTargetDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date, like 2026-09-13")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    // A real day round-trips: `2026-02-31` parses to March 3rd and does not.
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "That is not a real date");
