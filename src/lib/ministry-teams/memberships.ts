import { db } from "@/db";
import { lockPlantLeadership } from "./leadership-lock";
import { canLeadTeam } from "./leader-eligibility";
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
import { and, desc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { toCalendarDate } from "@/lib/datetime";
import {
  emitTeamMemberAssigned,
  emitTeamLeaderAssigned,
  emitTeamStaffingChanged,
} from "./events";
import { ExpectedError } from "./expected-error";
import {
  lockTeamLeadership,
  fillLeaderStatement,
  clearVacantRoleLeader,
} from "./leader-sync";
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
 * Assign one active person per role. The partial unique role index arbitrates
 * inserts; reactivation also requires status='inactive' on the written row.
 * Both an empty RETURNING and a unique violation are expected seat refusals.
 * Their person-specific wording comes from seatRefusalMessage after refusal.
 *
 * The team lock, membership write, derived appointment and role status share
 * one neon-http batch. The membership RETURNING CTE gates the appointment, so
 * a losing assignment cannot restore leadership cleared by another operation.
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

  // The parent lock precedes every child write. The RETURNING CTE gates
  // leadership on this assignment actually succeeding, including reactivation.
  const assigned = db.$with("assigned_membership").as(
    existing
      ? db
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
              eq(teamMemberships.id, existing.id),
              eq(teamMemberships.status, "inactive")
            )
          )
          .returning()
      : db
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
            where: sql`${teamMemberships.status} = 'active'`,
          })
          .returning()
  );
  const filled = db.$with("filled_leader").as(
    fillLeaderStatement(
      churchId,
      teamId,
      roleId,
      personId,
      exists(
        db
          .select({ one: sql`1` })
          .from(assigned)
          .innerJoin(teamRoles, eq(teamRoles.id, assigned.roleId))
          .where(
            and(
              eq(teamRoles.churchId, churchId),
              eq(teamRoles.teamId, teamId),
              eq(teamRoles.isLeadershipRole, true)
            )
          )
      )
    )
  );
  let membership: TeamMembership;
  let assignedLeadershipRole = false;
  try {
    const [, , [written], [currentRole]] = await db.batch([
      lockPlantLeadership(churchId),
      lockTeamLeadership(churchId, teamId),
      db.with(assigned, filled).select().from(assigned),
      db
        .update(teamRoles)
        .set({ status: "filled" as RoleStatus, updatedAt: new Date() })
        .where(
          and(
            eq(teamRoles.id, roleId),
            eq(teamRoles.churchId, churchId),
            exists(
              db
                .select({ one: sql`1` })
                .from(teamMemberships)
                .where(
                  and(
                    eq(teamMemberships.roleId, roleId),
                    eq(teamMemberships.churchId, churchId),
                    eq(teamMemberships.status, "active")
                  )
                )
            )
          )
        )
        .returning({
          isLeadershipRole: teamRoles.isLeadershipRole,
          canLead: canLeadTeam(churchId, personId),
        }),
    ]);
    if (!written)
      throw new ExpectedError(
        await seatRefusalMessage(churchId, roleId, personId)
      );
    membership = written;
    assignedLeadershipRole =
      currentRole?.isLeadershipRole === true && currentRole.canLead;
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
  if (assignedLeadershipRole) {
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

/** Deactivate membership and reconcile role status and derived leadership in
 * one team-locked batch. A stale request cannot clear a different holder.
 */
export async function removeMember(
  churchId: string,
  membershipId: string,
  userId: string
): Promise<void> {
  const [held] = await db
    .select({
      membership: teamMemberships,
    })
    .from(teamMemberships)
    .innerJoin(teamRoles, eq(teamRoles.id, teamMemberships.roleId))
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.id, membershipId)
      )
    )
    .limit(1);

  // ExpectedError: user copy — surfaced to the planter verbatim (409-6C).
  if (!held) throw new ExpectedError("Membership not found");

  const { membership } = held;

  // Deactivate the membership and reopen its role in ONE db.batch — both
  // writes are known up front, so a failure in between can no longer leave the
  // role Open while the person still reads assigned (memory/invariants.md →
  // Transactions).
  await db.batch([
    lockPlantLeadership(churchId),
    lockTeamLeadership(churchId, membership.teamId),
    db
      .update(teamMemberships)
      .set({
        status: "inactive" as MembershipStatus,
        // The calendar-day primitive, never re-spelled: a `date` column names a
        // day, and which day that is has to be measured in the zone the day is
        // later read in (`memory/invariants.md` → Date & Time Rendering).
        endDate: toCalendarDate(new Date()),
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
      .set({
        status: sql`case when exists (
        select 1 from ${teamMemberships} where ${teamMemberships.roleId} = ${membership.roleId}
        and ${teamMemberships.churchId} = ${churchId} and ${teamMemberships.status} = 'active'
      ) then 'filled' else 'open' end`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teamRoles.id, membership.roleId),
          eq(teamRoles.churchId, churchId)
        )
      ),
    clearVacantRoleLeader(churchId, membership.teamId, membership.roleId),
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
