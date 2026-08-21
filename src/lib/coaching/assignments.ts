// ============================================================================
// COACH ASSIGNMENTS — what a coach reaches, and the one write that grants it
// (AS-008 / AS-009 / AS-011, #496).
//
// NO `"use server"` DIRECTIVE, on the same footing as `@/lib/invitations/seat`:
// every export of a `"use server"` module is a POSTable endpoint reachable with
// no session and no UI (`memory/invariants.md` → Authentication), so the logic
// lives here and the actions that mint an actor from `requireSeat` are the only
// way in from a browser.
//
// ----------------------------------------------------------------------------
// A COACH IS NOT A SEAT, AND NOT OVERSIGHT
// ----------------------------------------------------------------------------
//
// `users.seat` stays NULL and no tenancy FK is written. What a coach holds is a
// `coach_assignments` row per plant, and the reach that row grants is:
//
//   * THE PLANT'S OWN RECORDS, not aggregates. An oversight account reading the
//     same plant sees counts; a coach sees the people, the meetings, the tasks.
//   * UNGATED BY `share_*`. Those six toggles gate what OVERSIGHT may pull. A
//     coach's consent is the assignment itself — the plant's own Owner or Admin
//     named this person — so `canAccessFeatureData` answers `true` for a coach
//     by way of `isChurchLevelUser`, and that is deliberate, not incidental.
//   * READ ONLY. Every write verb in `@/lib/auth/seat-rules` is
//     `tenancy: "plant"`, which demands a non-null `users.church_id`. A coach has
//     none, so the refusal is structural and there is no coach arm to forget.
//
// THE TWO REACHES DO NOT BORROW EACH OTHER'S SCOPE. An oversight seat holder
// may also coach a plant inside their own portfolio. They then read that plant's
// own records THROUGH THE ASSIGNMENT, while every `/oversight` surface the same
// session opens stays aggregate and `share_*`-gated — because the oversight
// reads start from `getAccessibleChurchIds`, which answers from the ORG, and the
// coach reads start from `assignedChurchIds`, which answers from the
// ASSIGNMENTS. Two consents, two queries, neither reading the other's list.
// ============================================================================

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, coachAssignments, userInvitations } from "@/db/schema";

/** One plant a coach reaches, as the nav and the plant page need it. */
export type AssignedPlant = {
  churchId: string;
  churchName: string;
};

/**
 * The plants this account actively coaches, by name, alphabetically.
 *
 * THE SOURCE OF TRUTH FOR "which plants does a coach reach", and the only one:
 * `getCoachChurchIds` in `@/lib/auth/access` reads its ids from here rather than
 * running a second copy of this `WHERE`, so the nav, the plant page and the
 * access check can never disagree about which assignment is live.
 */
export async function assignedPlantsFor(
  coachUserId: string
): Promise<AssignedPlant[]> {
  return db
    .select({ churchId: churches.id, churchName: churches.name })
    .from(coachAssignments)
    .innerJoin(churches, eq(churches.id, coachAssignments.churchId))
    .where(
      and(
        eq(coachAssignments.coachUserId, coachUserId),
        eq(coachAssignments.status, "active")
      )
    )
    .orderBy(churches.name);
}

/** Just the ids — what an access check needs and all it should be handed. */
export async function assignedChurchIds(
  coachUserId: string
): Promise<string[]> {
  const rows = await db
    .select({ churchId: coachAssignments.churchId })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachUserId, coachUserId),
        eq(coachAssignments.status, "active")
      )
    );

  return rows.map((row) => row.churchId);
}

/**
 * Does this account actively coach this plant? The gate every coach read runs
 * before it reads anything (see `./read`).
 *
 * A point read rather than `assignedChurchIds(…).includes(…)`, so a coach with
 * fifty assignments pays for one row rather than fifty.
 */
export async function coachesPlant(
  coachUserId: string,
  churchId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachUserId, coachUserId),
        eq(coachAssignments.churchId, churchId),
        eq(coachAssignments.status, "active")
      )
    )
    .limit(1);

  return Boolean(row);
}

/**
 * THE GRANT, AS A STATEMENT RATHER THAN AN AWAITED WRITE — so it goes in the
 * same `db.batch` as the claim that answers the invitation, and neither can
 * apply without the other.
 *
 * IT READS ITS OWN ARGUMENTS OUT OF THE INVITATION ROW. The coach is
 * `responded_by` and the plant is `church_id`, both selected from
 * `user_invitations` rather than passed in, so an assignment cannot name a
 * person the invitation did not answer or a plant it did not come from. There is
 * no parameter here for a caller to get wrong.
 *
 * THE `WHERE` RE-ASSERTS WHAT THE CLAIM SET (`memory/invariants.md` →
 * Transactions): `status = 'accepted'`, which only the compare-and-set batched
 * ahead of it can have written. A claim that matched nothing — the invitation
 * was revoked, expired or already answered a millisecond ago — leaves this
 * `SELECT` empty, so the insert writes nothing and rolls nothing back. An empty
 * `returning()` is the caller's signal, not an error.
 *
 * IDEMPOTENT ON RE-ACCEPT. `coach_assignments_coach_church_unique` is a total
 * unique index, not a partial one on `status`, so an ENDED assignment still
 * occupies the pair. `ON CONFLICT DO UPDATE SET status = 'active'` is therefore
 * the correct write and not a convenience: re-inviting a coach whose assignment
 * was ended has to revive that row, and a bare insert would answer a 500 to a
 * flow the product offers.
 */
export function assignCoachOnAcceptStatement(invitationId: string) {
  return db
    .insert(coachAssignments)
    .select(
      db
        .select({
          id: sql<string>`gen_random_uuid()`.as("id"),
          coachUserId: userInvitations.respondedBy,
          churchId: userInvitations.churchId,
          assignedAt: sql<Date>`now()`.as("assigned_at"),
          status: sql<string>`'active'`.as("status"),
        })
        .from(userInvitations)
        .where(
          and(
            eq(userInvitations.id, invitationId),
            eq(userInvitations.kind, "coach"),
            eq(userInvitations.status, "accepted")
          )
        )
    )
    .onConflictDoUpdate({
      target: [coachAssignments.coachUserId, coachAssignments.churchId],
      set: { status: "active" },
    })
    .returning({ id: coachAssignments.id });
}
