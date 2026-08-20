// ============================================================================
// THE GUARD — `requireSeat`, and nothing else.
//
// The sets, the capability table and the two predicates live in
// `./seat-rules`, which is an import-free leaf. This file is the half that
// MINTS, so it is the half that reaches the database: `verifySession` opens the
// session cookie, and `@/lib/auth/session` calls `neon(...)` at module scope.
//
// IT DOES NOT RE-EXPORT THE LEAF. A module wanting `holdsSeatFor` or
// `assertSeatFor` imports `./seat-rules` directly, so one authority policy has
// one import path and the no-database seam holds for everything that only asks
// a question (`memory/invariants.md` → Authentication). Re-exporting here is
// the failure `@/lib/invitations/register-path` shipped once and
// `@/lib/auth/access` carries a comment against.
// ============================================================================

import {
  SeatRefusalError,
  holdsSeatFor,
  type Capability,
} from "@/lib/auth/seat-rules";
import {
  verifySession,
  type SessionValidationResult,
} from "@/lib/auth/session";

/**
 * THE GUARD. The first statement of every state-changing `"use server"` export.
 *
 * It MINTS the actor as well as checking it, which is what lets it be one line
 * rather than two and keeps the SESSION-FIRST rule intact: it returns exactly
 * what `verifySession()` returns, so a call site adopts it by changing the
 * function it already calls rather than by adding a statement above it.
 *
 * AHEAD OF THE PARSE, and that is not stylistic. Parsing first answers a
 * sessionless caller differently for a malformed argument than for a
 * well-formed one — a free shape-oracle on an endpoint that should have said
 * only "no" (`memory/invariants.md` → Authentication).
 *
 * @throws `Unauthorized` with no session; `Forbidden: …` when the seat or the
 * tenancy does not carry the capability. The prefix is the established refusal
 * shape (`@/lib/auth/access`): the action modules turn it into "You do not have
 * permission to …" and log the detail, so the sentence naming the seat reaches
 * the server log and never a response.
 */
export async function requireSeat(
  capability: Capability
): Promise<SessionValidationResult> {
  const result = await verifySession();

  if (!holdsSeatFor(result.user, capability)) {
    throw new SeatRefusalError(capability);
  }

  return result;
}
