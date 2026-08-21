/**
 * WHAT EVERY WRITE ON `/settings/team`'s ROSTER ANSWERS IN — one declaration,
 * imported by the roster and the coach list alike.
 *
 * DECLARED HERE AND NOT IN `settings/team/actions.ts`, which is where it
 * logically belongs: Next's server-action transform enumerates a `"use server"`
 * module's exports to build the page's action manifest and reads a re-exported
 * NAME as an action, so `export type { … } from "…"` through one fails the
 * build (`settings/team/actions.ts` carries the whole note). The action module
 * declares its own `SeatActionResult` locally; the compiler checks the two
 * against each other at the call site in `page.tsx`, which is where the actions
 * are handed to the components.
 *
 * AND NOT IN `seat-roster.tsx`, where it started. The coach list would then
 * import its result shape from the seat roster — contradicting, in an import
 * line, the thing its own docblock exists to say: coaching is an assignment,
 * never a seat. The type belongs to neither component.
 */
export type SeatActionOutcome =
  | { success: true }
  | { success: false; error: string };
