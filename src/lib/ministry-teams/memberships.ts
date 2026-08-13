import { db } from "@/db";
import {
  ministryTeams,
  teamRoles,
  teamMemberships,
  persons,
  type TeamMembership,
  type NewTeamMembership,
  type MembershipStatus,
  type RoleStatus,
} from "@/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  emitTeamMemberAssigned,
  emitTeamLeaderAssigned,
  emitTeamStaffingChanged,
} from "./events";
import { ExpectedError } from "./expected-error";
import { isSeatConflict } from "./membership-conflict";
import {
  PERSON_ALREADY_ASSIGNED_MESSAGE,
  ROLE_ALREADY_FILLED_MESSAGE,
} from "./membership-copy";
import { getTeamStaffingCounts } from "./shared";

// ============================================================================
// Types
// ============================================================================

export interface PersonTeamAssignment {
  membershipId: string;
  teamId: string;
  teamName: string;
  roleId: string;
  roleName: string;
  status: MembershipStatus;
  startDate: string | null;
}

// ============================================================================
// Ruled copy (#409 D1)
// ============================================================================
//
// Both sentences live in the import-free leaf `membership-copy.ts` and are
// deliberately NOT re-exported from here — the assign dialog imports them too,
// and this module opens with `@/db`.
//
// `isSeatConflict` — "did the seat index refuse this write?" — lives BESIDE the
// leaf, in `membership-conflict.ts`, and not IN it:
// it recognises the violation with `isUniqueViolation` (`@/db/errors`), the one
// copy of that predicate every domain shares, so it cannot sit in an
// import-free module. It is the only thing between a lost race and a raw
// "duplicate key value violates unique constraint" reaching a planter; over
// there it is still a pure function testable with no database at all
// (`membership-conflict.test.ts`, hermetic, every `pnpm test`), whereas here
// the only test that could reach it was the opt-in live one. It answers a
// BOOLEAN, not a sentence: the sentence has one source, `seatRefusalMessage`.

// ============================================================================
// Membership Functions
// ============================================================================

/**
 * WHICH sentence a refused write means, read off the seat itself.
 *
 * THE ONE DECIDER, for every refusal `assignMember` can produce — the empty
 * `returning()` and the thrown unique violation alike. The database answers
 * "the seat is taken" and stops there: `role_id` alone is the seat key and an
 * index reports no intent, so the two-people race and the same-person
 * double-submit are indistinguishable at the point of refusal, whichever shape
 * they arrive in. This is the one extra query that tells them apart, and it runs
 * ONLY on the loser's cold path.
 *
 * It is a snapshot read, deliberately, and it decides nothing but wording — the
 * write has already been refused by the index above it. If the holder has since
 * been removed the read comes back empty and the seat sentence is used, which is
 * the honest answer to "somebody was ahead of you and it was not you".
 */
async function seatRefusalMessage(
  churchId: string,
  roleId: string,
  personId: string
): Promise<string> {
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

  return holder?.personId === personId
    ? PERSON_ALREADY_ASSIGNED_MESSAGE
    : ROLE_ALREADY_FILLED_MESSAGE;
}

/**
 * Assign a person to a team role.
 *
 * ONE PERSON PER ROLE, AND THE DATABASE IS WHAT SAYS SO (#409 D1, migration
 * 0038). `team_memberships_role_active_unique_idx` — partial, on `role_id`
 * where `status = 'active'` — is the guard; everything here is about which
 * sentence the planter reads.
 *
 * "IS THE SEAT FREE" IS ASKED ONCE, BY THE INDEX, and it is asked by attempting
 * the write. Refusal arrives in one of TWO SHAPES, one per write path, and BOTH
 * are post-write:
 *
 *   * an EMPTY `returning()` — the INSERT path, always. It carries
 *     `ON CONFLICT (role_id) WHERE status = 'active' DO NOTHING` against the one
 *     unique index on the table, so every conflict it can meet is the arbiter's:
 *     the statement answers `INSERT 0 0` and that emptiness IS the refusal;
 *   * a THROWN unique violation, recognised by `isSeatConflict` — the
 *     REACTIVATION path, always. An UPDATE takes no `ON CONFLICT` at all, so it
 *     meets the index as an exception and nothing can cover it.
 *
 * THE INSERT USED TO BE ABLE TO THROW TOO, and it no longer can (#411 quality
 * round 1). A second, strictly subsumed unique index —
 * `team_memberships_active_unique` on (team_id, person_id, role_id) — sat beside
 * the seat index; it was not the arbiter, so a raced insert that passed the
 * arbiter's pre-check met it first (lower OID) and raised a unique violation
 * where the DO NOTHING could not reach. Migration 0039 drops it: it forbade
 * nothing the seat index does not, and its only effect was to turn a designed
 * `INSERT 0 0` into a driver exception about two runs in three. One index, one
 * shape per path.
 *
 * WHICH SENTENCE THE LOSER READS IS A SECOND QUESTION, IT NEEDS A SECOND READ,
 * AND THAT READ IS THE ONLY DECIDER FOR BOTH SHAPES. Neither shape can tell the
 * two-people race from the same-person double-submit — `role_id` alone is the
 * seat key, and an index does not report intent — so `seatRefusalMessage` READS
 * THE HOLDER and names it: the same person is `PERSON_ALREADY_ASSIGNED_MESSAGE`,
 * anybody else is `ROLE_ALREADY_FILLED_MESSAGE`. Both refusal branches below end
 * in that one call, deliberately: a table mapping index names to sentences was
 * the earlier design, and it had to predict which index a race raises on. That
 * distinction is not decoration — the seat sentence carries
 * `ROLE_ALREADY_FILLED_DESCRIPTION` ("Someone filled it while this page was
 * open"), which is a FALSE statement to a planter who filled it themselves,
 * twice.
 *
 * That read is NOT a guard and must never be turned into one. It runs AFTER the
 * write has already been refused, on a cold path, and its only output is a
 * string; the index remains the only thing that decides who gets the seat.
 *
 * THERE IS NO PRE-FLIGHT "is anybody on this seat?" SELECT, and never re-add
 * one. A SELECT-then-INSERT is not a concurrency guard (`memory/invariants.md`
 * → Transactions), so it can only ever be a third copy of a rule the index
 * already owns — and it costs a round trip on every assignment. It is also not
 * inert: while it was here it ran for BOTH paths, so a reactivation onto an
 * occupied seat was refused before the batch, the driver error never happened,
 * and `role-seat-race.test.ts`'s third case passed while the translation it
 * exists to prove was unreachable.
 *
 * The pre-check that STAYS is `existing.status === 'active'` below, and it is
 * load-bearing: reactivating an already-active row UPDATEs that same row, which
 * raises no violation at all, so nothing downstream would answer it. It is a
 * snapshot read, so it is the LEGIBLE half of the double-submit refusal and
 * never its backing — the loser branch below is what answers the two submits
 * that pass it together.
 */
export async function assignMember(
  churchId: string,
  teamId: string,
  roleId: string,
  personId: string,
  userId: string,
  startDate?: string
): Promise<TeamMembership> {
  // Verify person exists
  const [person] = await db
    .select()
    .from(persons)
    .where(
      and(
        eq(persons.id, personId),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
      )
    )
    .limit(1);

  // ExpectedError throughout assignMember: these messages are user copy — the
  // action shell surfaces them to the planter verbatim (ruling 409-6C).
  if (!person) throw new ExpectedError("Person not found");

  // Verify role exists and belongs to team
  const [role] = await db
    .select()
    .from(teamRoles)
    .where(
      and(
        eq(teamRoles.id, roleId),
        eq(teamRoles.churchId, churchId),
        eq(teamRoles.teamId, teamId)
      )
    )
    .limit(1);

  if (!role) throw new ExpectedError("Role not found in this team");

  // Look for any existing membership row for this (team, person, role).
  // A row may linger after removeMember sets status='inactive' (the partial
  // unique index only constrains active rows). If an active row exists this is
  // a true duplicate; if an inactive row exists we reactivate it instead of
  // inserting a duplicate (F8 re-assignment fix).
  const [existing] = await db
    .select()
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.roleId, roleId),
        eq(teamMemberships.personId, personId)
      )
    )
    .orderBy(desc(teamMemberships.createdAt))
    .limit(1);

  if (existing && existing.status === "active") {
    throw new ExpectedError(PERSON_ALREADY_ASSIGNED_MESSAGE);
  }

  // The membership write and the role's status flip are both known up front,
  // so they ship as ONE db.batch — a Neon batched transaction, all-or-nothing
  // (memory/invariants.md → Transactions). Two separate awaits could fail in
  // between and leave a role reading Filled with no active membership. That
  // all-or-nothing is also what makes the REACTIVATION refusal safe: the index
  // violation aborts the batch, so `markRoleFilled` never lands either.
  const markRoleFilled = db
    .update(teamRoles)
    .set({ status: "filled" as RoleStatus, updatedAt: new Date() })
    .where(and(eq(teamRoles.id, roleId), eq(teamRoles.churchId, churchId)));

  let membership: TeamMembership;
  try {
    if (existing) {
      // Reactivate the inactive row: fresh startDate, cleared end fields.
      // An UPDATE takes no `ON CONFLICT`, so this path always meets the seat
      // index as a violation; the catch below recognises it and reads the
      // holder for the sentence.
      const [[reactivated]] = await db.batch([
        db
          .update(teamMemberships)
          .set({
            status: "active" as MembershipStatus,
            startDate: startDate ?? null,
            endDate: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(teamMemberships.churchId, churchId),
              eq(teamMemberships.id, existing.id)
            )
          )
          .returning(),
        markRoleFilled,
      ]);
      membership = reactivated;
    } else {
      const [[inserted]] = await db.batch([
        db
          .insert(teamMemberships)
          .values({
            churchId,
            teamId,
            personId,
            roleId,
            startDate: startDate ?? null,
            status: "active" as MembershipStatus,
            createdBy: userId,
          } satisfies NewTeamMembership)
          .onConflictDoNothing({
            target: teamMemberships.roleId,
            // The index predicate, repeated byte for byte. A mismatch is
            // "there is no unique or exclusion constraint matching the ON
            // CONFLICT specification", on every assignment.
            //
            // It names the SEAT index, which since migration 0039 is the ONLY
            // unique index on this table — so every conflict this statement can
            // meet is the arbiter's and the refusal is always `INSERT 0 0`.
            where: sql`${teamMemberships.status} = 'active'`,
          })
          .returning(),
        markRoleFilled,
      ]);
      // An empty `returning()` is not an error — it is the loser of the race
      // (memory/invariants.md → Transactions). `markRoleFilled` still ran, and
      // that is right rather than tolerated: somebody holds the seat, so
      // `filled` is what the role is. The refusal below is about what this
      // caller is told, not about repairing a write.
      if (!inserted) {
        throw new ExpectedError(
          await seatRefusalMessage(churchId, roleId, personId)
        );
      }
      membership = inserted;
    }
  } catch (error) {
    // The OTHER refusal path — the reactivation UPDATE — and it ends in the
    // SAME read. The seat index raised, so what happened is "somebody is
    // already on this seat"; who that is, and therefore which sentence, is
    // answered exactly once, below and above. `ExpectedError` from the branch
    // above passes through untouched: it is no unique violation.
    if (isSeatConflict(error)) {
      throw new ExpectedError(
        await seatRefusalMessage(churchId, roleId, personId)
      );
    }
    throw error;
  }

  // Emit events
  await emitTeamMemberAssigned(teamId, personId, roleId, churchId, userId);

  // If this is a leadership role, also emit leader assigned event
  if (role.isLeadershipRole) {
    await emitTeamLeaderAssigned(teamId, personId, churchId, userId);
  }

  const stats = await getTeamStaffingCounts(churchId, teamId);
  await emitTeamStaffingChanged(
    teamId,
    stats.filled,
    stats.total,
    churchId,
    userId
  );

  return membership;
}

/**
 * Remove (deactivate) a team membership
 */
export async function removeMember(
  churchId: string,
  membershipId: string,
  userId: string
): Promise<void> {
  const [membership] = await db
    .select()
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.id, membershipId)
      )
    )
    .limit(1);

  // ExpectedError: user copy — surfaced to the planter verbatim (409-6C).
  if (!membership) throw new ExpectedError("Membership not found");

  // Deactivate the membership and reopen its role in ONE db.batch — both
  // writes are known up front, so a failure in between can no longer leave the
  // role Open while the person still reads assigned (memory/invariants.md →
  // Transactions).
  await db.batch([
    db
      .update(teamMemberships)
      .set({
        status: "inactive" as MembershipStatus,
        endDate: new Date().toISOString().split("T")[0],
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teamMemberships.churchId, churchId),
          eq(teamMemberships.id, membershipId)
        )
      ),
    db
      .update(teamRoles)
      .set({ status: "open" as RoleStatus, updatedAt: new Date() })
      .where(
        and(
          eq(teamRoles.id, membership.roleId),
          eq(teamRoles.churchId, churchId)
        )
      ),
  ]);

  // Emit staffing changed
  const stats = await getTeamStaffingCounts(churchId, membership.teamId);
  await emitTeamStaffingChanged(
    membership.teamId,
    stats.filled,
    stats.total,
    churchId,
    userId
  );
}

/**
 * Get all team assignments for a person (for person profile)
 */
export async function getPersonTeams(
  churchId: string,
  personId: string
): Promise<PersonTeamAssignment[]> {
  const memberships = await db
    .select({
      membershipId: teamMemberships.id,
      teamId: teamMemberships.teamId,
      roleId: teamMemberships.roleId,
      status: teamMemberships.status,
      startDate: teamMemberships.startDate,
    })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.personId, personId),
        eq(teamMemberships.status, "active")
      )
    );

  if (memberships.length === 0) return [];

  // Batch-load team and role names
  const teamIdSet = [...new Set(memberships.map((m) => m.teamId))];
  const roleIdSet = [...new Set(memberships.map((m) => m.roleId))];

  const [teamRows, roleRows] = await Promise.all([
    db
      .select({ id: ministryTeams.id, name: ministryTeams.name })
      .from(ministryTeams)
      .where(
        and(
          eq(ministryTeams.churchId, churchId),
          inArray(ministryTeams.id, teamIdSet)
        )
      ),
    db
      .select({ id: teamRoles.id, name: teamRoles.name })
      .from(teamRoles)
      .where(
        and(eq(teamRoles.churchId, churchId), inArray(teamRoles.id, roleIdSet))
      ),
  ]);

  const teamNameMap = new Map(teamRows.map((t) => [t.id, t.name]));
  const roleNameMap = new Map(roleRows.map((r) => [r.id, r.name]));

  return memberships.map((m) => ({
    membershipId: m.membershipId,
    teamId: m.teamId,
    teamName: teamNameMap.get(m.teamId) ?? "Unknown",
    roleId: m.roleId,
    roleName: roleNameMap.get(m.roleId) ?? "Unknown",
    status: m.status,
    startDate: m.startDate,
  }));
}

/**
 * Count how many teams each of the given people is actively assigned to, in
 * one grouped query (for the assign dialog's "already on N teams" warning).
 * People with no active membership are simply absent from the result.
 */
export async function getTeamCountsForPeople(
  churchId: string,
  personIds: string[]
): Promise<Record<string, number>> {
  if (personIds.length === 0) return {};

  const rows = await db
    .select({
      personId: teamMemberships.personId,
      count: sql<number>`count(DISTINCT ${teamMemberships.teamId})::int`,
    })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        inArray(teamMemberships.personId, personIds),
        eq(teamMemberships.status, "active")
      )
    )
    .groupBy(teamMemberships.personId);

  return Object.fromEntries(rows.map((row) => [row.personId, row.count]));
}
