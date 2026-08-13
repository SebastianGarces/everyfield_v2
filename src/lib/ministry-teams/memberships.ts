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
import { membershipConflictMessage } from "./membership-conflict";
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
// `membershipConflictMessage` — the translation from a unique-violation to one
// of those two sentences — lives BESIDE the leaf, in `membership-conflict.ts`,
// and not IN it: it recognises the violation with `isUniqueViolation`
// (`@/db/errors`), the one copy of that predicate every domain shares, so it
// cannot sit in an import-free module. It is the only guard between a lost
// reactivation race and a raw "duplicate key value violates unique constraint"
// reaching a planter; over there it is still a pure function testable with no
// database at all (`membership-conflict.test.ts`, hermetic, every `pnpm test`),
// whereas here the only test that could reach it was the opt-in live one.

// ============================================================================
// Membership Functions
// ============================================================================

/**
 * Assign a person to a team role.
 *
 * ONE PERSON PER ROLE, AND THE DATABASE IS WHAT SAYS SO (#409 D1, migration
 * 0038). `team_memberships_role_active_unique_idx` — partial, on `role_id`
 * where `status = 'active'` — is the guard; everything here is about which
 * sentence the planter reads.
 *
 * "IS THE SEAT FREE" IS ASKED ONCE, BY THE INDEX, and it is asked by attempting
 * the write. There are exactly TWO refusals, one per write path, and both are
 * post-write: the INSERT path carries `ON CONFLICT … DO NOTHING`, so a taken
 * seat comes back with an empty `returning()` and that emptiness IS the
 * refusal; the REACTIVATION path is an UPDATE, takes no `ON CONFLICT`, meets
 * the index as a driver violation, and `membershipConflictMessage` translates
 * that into the very same sentence. Both say `ROLE_ALREADY_FILLED_MESSAGE`.
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
 * raises no violation at all, so nothing downstream would answer it.
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
      // An UPDATE takes no `ON CONFLICT`, so this path meets the index as a
      // violation and `membershipConflictMessage` turns it into user copy.
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
      if (!inserted) throw new ExpectedError(ROLE_ALREADY_FILLED_MESSAGE);
      membership = inserted;
    }
  } catch (error) {
    const message = membershipConflictMessage(error);
    if (message) throw new ExpectedError(message);
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
