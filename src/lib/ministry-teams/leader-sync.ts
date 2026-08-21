// ============================================================================
// THE DERIVED TEAM LEADER (#311 WS2, MT-004b).
//
// A team's leader is `ministry_teams.leader_id`, and until now exactly one
// thing wrote it: `assignTeamLeader`, reached from a control the planter has to
// find. Meanwhile the roles tab has always had a "Leadership" flag on roles,
// and filling one of those roles said nothing to the header — a plant could
// have a Senior Pastor sitting in the Senior Pastor seat and still read "No
// leader assigned" one line above them.
//
// SO A FILLED LEADERSHIP ROLE IMPLIES THE LEADER, AND IT IMPLIES IT ONLY WHILE
// NOBODY HAS SAID OTHERWISE. Both directions are ONE STATEMENT each, and the
// condition lives in the `WHERE` rather than in a read above it:
//
//   fill   `SET leader_id = $person WHERE leader_id IS NULL`
//   vacate `SET leader_id = NULL    WHERE leader_id = $person`
//
// A same-row compare-and-set (`memory/invariants.md` → Transactions), so two
// people filling two leadership seats at once produce ONE leader rather than a
// last-writer-wins coin flip, and neither is the explicit answer's equal: the
// `IS NULL` predicate is what makes "an existing leader is never overwritten"
// a property of the write instead of a check somebody has to remember.
//
// WHICH DOOR SET THE LEADER IS NOT RECORDED, and the cost is one honest gap:
// a leader named EXPLICITLY who also happens to hold a leadership role is
// cleared when that role is vacated, because `leader_id = $person` is all the
// column can be asked. Distinguishing the two needs a provenance column and a
// rule for what an explicit answer means once its holder leaves — a wider
// change than the relationship this file adds, so it is carried deliberately.
// ============================================================================

import { db } from "@/db";
import { ministryTeams, teamMemberships } from "@/db/schema";
import { and, eq, exists, isNull, sql } from "drizzle-orm";

/**
 * Who actively holds a role right now, or null for an open seat.
 *
 * ONE ACTIVE ROW EXISTS AT MOST — `team_memberships_role_active_unique_idx`
 * says so — so this is a point read and not a "first of several".
 */
export async function activeRoleHolder(
  churchId: string,
  roleId: string
): Promise<string | null> {
  const [holder] = await db
    .select({ personId: teamMemberships.personId })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.roleId, roleId),
        eq(teamMemberships.status, "active")
      )
    )
    .limit(1);

  return holder?.personId ?? null;
}

/**
 * Somebody now holds a leadership role: make them the team's leader, unless
 * the team already has one.
 *
 * THE SEAT IS RE-ASSERTED INSIDE THE WRITE, not read above it. The caller
 * learned who the holder was from a SELECT, and a predicate about another table
 * is a snapshot (`memory/invariants.md` → Transactions) — so between that read
 * and this write a concurrent `removeMember` could take the person off the
 * team, and its own vacate would be a no-op because it read the role's flag
 * before this call flipped it. The result was a team led by somebody who had
 * left, with no door left to clear them: their membership is already inactive,
 * so no later vacate fires for them. The `EXISTS` makes one statement decide
 * both halves, so that ordering cannot commit.
 *
 * @returns whether this call is what made them leader. The caller decides what
 *   that is worth — nothing here emits, because the two doors into this
 *   function have different stories to tell about the same row.
 */
export async function syncLeaderOnFill(
  churchId: string,
  teamId: string,
  personId: string
): Promise<boolean> {
  const filled = await db
    .update(ministryTeams)
    .set({ leaderId: personId, updatedAt: new Date() })
    .where(
      and(
        eq(ministryTeams.churchId, churchId),
        eq(ministryTeams.id, teamId),
        isNull(ministryTeams.leaderId),
        exists(
          db
            .select({ one: sql`1` })
            .from(teamMemberships)
            .where(
              and(
                eq(teamMemberships.churchId, churchId),
                eq(teamMemberships.teamId, teamId),
                eq(teamMemberships.personId, personId),
                eq(teamMemberships.status, "active")
              )
            )
        )
      )
    )
    .returning({ id: ministryTeams.id });

  return filled.length > 0;
}

/**
 * A leadership role stopped being held by this person — because they were
 * removed, because the role was deleted, or because the role stopped being a
 * leadership role. Clear the team's leader IF AND ONLY IF it points at them.
 *
 * The `iff` is the `WHERE`: a team led by somebody else is untouched, which is
 * the whole rule and needs no read to decide.
 */
export async function syncLeaderOnVacate(
  churchId: string,
  teamId: string,
  personId: string
): Promise<boolean> {
  const cleared = await db
    .update(ministryTeams)
    .set({ leaderId: null, updatedAt: new Date() })
    .where(
      and(
        eq(ministryTeams.churchId, churchId),
        eq(ministryTeams.id, teamId),
        eq(ministryTeams.leaderId, personId)
      )
    )
    .returning({ id: ministryTeams.id });

  return cleared.length > 0;
}
