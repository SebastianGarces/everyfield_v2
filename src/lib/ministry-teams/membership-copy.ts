// ============================================================================
// The two seat refusals a team assignment can produce (#409 D1).
//
// AN IMPORT-FREE LEAF. Both sides of the refusal need the same sentence: the
// service throws it (`assignMember`, through `ExpectedError`) and the assign
// dialog reads it back to decide whether the roles tab it is sitting on has
// gone stale. The dialog is a `"use client"` module and
// `@/lib/ministry-teams/service` opens with `@/db`, so the wording lives here
// rather than there — the same rule as `src/lib/invitations/register-path.ts`,
// and for the same reason: a leaf whose contents are also served from the trunk
// is not a leaf, so neither `memberships.ts` nor `service.ts` re-exports these.
// ============================================================================

/**
 * The seat is taken. Produced by `team_memberships_role_active_unique_idx`
 * (migration 0038) and by the legible pre-check in front of it.
 *
 * WHAT THE PLANTER SHOULD DO ABOUT IT is not in the sentence, because the two
 * answers depend on what they meant: remove the current holder, or add a second
 * role to the team. The dialog refreshes the page underneath so the occupant
 * they did not know about is on screen when they read this.
 */
export const ROLE_ALREADY_FILLED_MESSAGE = "Role is already filled";

/** This person already holds this exact seat — a double-submitted assignment. */
export const PERSON_ALREADY_ASSIGNED_MESSAGE =
  "Person is already assigned to this role";

// The function that decides WHICH of the two sentences a driver error means is
// NOT here: it needs `isUniqueViolation` (`@/db/errors`), so keeping it in this
// module would either import into the leaf or force a second, weaker copy of a
// predicate this same track consolidated. It lives in the server-side sibling
// `membership-conflict.ts`; only the two sentences above are shared with the
// client, and only they are what `member-assign-dialog.tsx` imports.
