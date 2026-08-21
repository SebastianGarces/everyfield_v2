// ============================================================================
// WHO OWNS THIS FOLLOW-UP — the reads (#470, C01/C13).
//
// The definitions live next door in `follow-up-ownership.shared.ts` (pure, and
// therefore safe for the client islands that render them); this file is the SQL
// that feeds them, and it re-exports the shared half so a server caller has one
// import for the whole domain.
//
// Ownership is the `assigned_to_id` already on the follow-up task; nothing was
// added to the schema. Three surfaces ask the question and they must not be
// able to disagree:
//
//   - the WRITE path (`createTask` / `updateTask`), which refuses an assignee
//     who is not a committed member (D2);
//   - `/tasks`, whose assignments view and banner group open follow-ups by
//     owner and pin the ones with none;
//   - the phase engine's fact snapshot, whose four owner facts are the ONLY
//     licence rubric v1's Lens 2 gives the judge to say who carries follow-up.
//
// A LIVE OWNER, NOT A STORED ID. Every read here resolves the assignee through
// their person row and to their CURRENT status, so a follow-up whose owner was
// demoted or removed surfaces as unowned instead of hiding behind a name.
// ============================================================================

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { isOwnerSeat } from "@/lib/auth/seat-rules";
import { persons, tasks, users } from "@/db/schema";
import {
  COMMITTED_STATUSES,
  FOLLOW_UP_STATUSES,
} from "@/lib/people/status.shared";
import {
  FOLLOW_UP_ASSIGNEE_ERROR,
  OWNED_TASK_CATEGORY,
  type FollowUpAssignee,
  type FollowUpContact,
  type FollowUpHandoff,
  type OpenFollowUpTask,
} from "./follow-up-ownership.shared";

export * from "./follow-up-ownership.shared";

/** An open (not complete, not deleted) follow-up task — what all three reads mean. */
function openTaskConditions(churchId: string) {
  return [
    eq(tasks.churchId, churchId),
    isNull(tasks.deletedAt),
    ne(tasks.status, "complete"),
    eq(tasks.category, OWNED_TASK_CATEGORY),
  ];
}

// ----------------------------------------------------------------------------
// Who may hold one (D2)
// ----------------------------------------------------------------------------

/**
 * The accounts that may own a follow-up in this plant: an account whose linked
 * person row holds a committed status.
 *
 * THE JOIN IS THE `persons.user_id` FK, not the address bridge. The FK is the
 * identity claim ("this person row IS that account") written at church-gain and
 * at invited registration (`people/account-person.ts`, `account-person-link.ts`
 * — #495), so it answers "what is this account's status in this plant" exactly.
 * The address bridge in `person-user.ts` answers a different question — which
 * CONTACTS happen to hold a login — and using it here would let an unlinked
 * contact who shares an address own work.
 *
 * Church-scoped on BOTH sides: the account's tenancy and the person's church
 * (`memory/invariants.md` → Multi-Tenancy).
 */
export async function listFollowUpAssignees(
  churchId: string
): Promise<FollowUpAssignee[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: persons.status,
      seat: users.seat,
    })
    .from(users)
    .innerJoin(
      persons,
      and(
        eq(persons.userId, users.id),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
      )
    )
    .where(
      and(
        eq(users.churchId, churchId),
        inArray(persons.status, [...COMMITTED_STATUSES])
      )
    )
    .orderBy(users.name, users.email);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    isPlanter: isOwnerSeat(row.seat),
  }));
}

/**
 * The guard the write path runs (AC-1). `true` when this account may own a
 * follow-up in this church.
 *
 * A one-row read rather than `listFollowUpAssignees().some(…)`: the write path
 * is the hot side and a plant with sixty committed members would fetch sixty
 * rows to answer a yes/no.
 */
export async function mayOwnFollowUp(
  churchId: string,
  assigneeId: string
): Promise<boolean> {
  const rows = await db
    .select({ status: persons.status })
    .from(users)
    .innerJoin(
      persons,
      and(
        eq(persons.userId, users.id),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
      )
    )
    .where(
      and(
        eq(users.id, assigneeId),
        eq(users.churchId, churchId),
        inArray(persons.status, [...COMMITTED_STATUSES])
      )
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Refuse a follow-up assignment to somebody outside the committed set.
 *
 * Reads as a no-op for every other category and for an unassigned task, so the
 * two write paths call it unconditionally and neither has to remember the rule.
 */
export async function assertMayOwnFollowUp(
  churchId: string,
  category: string | null | undefined,
  assigneeId: string | null | undefined
): Promise<void> {
  if (category !== OWNED_TASK_CATEGORY || !assigneeId) return;
  if (await mayOwnFollowUp(churchId, assigneeId)) return;
  throw new Error(FOLLOW_UP_ASSIGNEE_ERROR);
}

// ----------------------------------------------------------------------------
// The open follow-up tasks, with their owners resolved
// ----------------------------------------------------------------------------

/**
 * Every open follow-up task in the plant, owner resolved to their CURRENT
 * status. Ordered for determinism — the fact snapshot is assembled from these
 * rows and has to be reproducible (AC-PE-2).
 *
 * Both joins are LEFT joins on purpose: an unassigned task, and a task whose
 * assignee has no linked person row, are both rows this read must return — they
 * are precisely the ones that need an owner.
 */
export async function listOpenFollowUpTasks(
  churchId: string
): Promise<OpenFollowUpTask[]> {
  const rows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      assignedToId: tasks.assignedToId,
      ownerName: users.name,
      ownerEmail: users.email,
      ownerSeat: users.seat,
      ownerStatus: persons.status,
    })
    .from(tasks)
    .leftJoin(
      users,
      and(eq(users.id, tasks.assignedToId), eq(users.churchId, churchId))
    )
    .leftJoin(
      persons,
      and(
        eq(persons.userId, users.id),
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt)
      )
    )
    .where(and(...openTaskConditions(churchId)))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, tasks.id);

  return rows.map((row) => ({
    taskId: row.taskId,
    title: row.title,
    dueDate: row.dueDate,
    contactId: row.relatedType === "person" ? row.relatedId : null,
    assignedToId: row.assignedToId,
    ownerName: row.ownerName,
    ownerEmail: row.ownerEmail,
    ownerIsCommitted:
      row.ownerStatus !== null &&
      (COMMITTED_STATUSES as readonly string[]).includes(row.ownerStatus),
    ownerIsPlanter: isOwnerSeat(row.ownerSeat),
  }));
}

/**
 * The plant's open follow-up contacts, named.
 *
 * The phase engine reads the same cohort through `getOpenFollowUpContacts`,
 * which projects only what a count needs; this one carries the names the view
 * has to render. One cohort, two projections — the definition they share is
 * `FOLLOW_UP_STATUSES`, which is why it lives in the people domain now.
 *
 * Longest-waiting first: `selectUnownedContacts` preserves this order, and it is
 * the order the handing-out decision is made in.
 */
export async function listFollowUpContacts(
  churchId: string
): Promise<FollowUpContact[]> {
  const rows = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      status: persons.status,
      updatedAt: persons.updatedAt,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        inArray(persons.status, [...FOLLOW_UP_STATUSES])
      )
    )
    .orderBy(persons.updatedAt, persons.id);

  return rows.map((row) => ({
    personId: row.id,
    name: [row.firstName, row.lastName].filter(Boolean).join(" ").trim(),
    status: row.status,
    lastTouchedAt: row.updatedAt,
  }));
}

// ----------------------------------------------------------------------------
// Demotion: re-homing what a leaving member was carrying (Q2)
// ----------------------------------------------------------------------------

/**
 * The handoff a status change owes, or `null` when it owes none.
 *
 * DECLINING IS A NO-OP, BY CONSTRUCTION. A skipped handoff needs no write: the
 * demotion already made `isOwned` false for every one of these tasks, so they
 * are in "Needs owner" and under the banner the moment the status lands. The
 * dialog is an offer to do the re-homing NOW, while the planter knows whose
 * work it was — not a repair for a state the demotion left broken.
 *
 * Returns `null` for a person with no account (most contacts), and for a member
 * who was carrying nothing. Neither is worth a modal.
 */
export async function planFollowUpHandoff(
  churchId: string,
  personId: string
): Promise<FollowUpHandoff | null> {
  const [person] = await db
    .select({
      userId: persons.userId,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(persons)
    .where(and(eq(persons.id, personId), eq(persons.churchId, churchId)))
    .limit(1);

  if (!person?.userId) return null;
  const fromUserId = person.userId;

  const [open, assignees] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(...openTaskConditions(churchId), eq(tasks.assignedToId, fromUserId))
      ),
    listFollowUpAssignees(churchId),
  ]);

  const openCount = open[0]?.count ?? 0;
  if (openCount === 0) return null;

  return {
    fromUserId,
    personName: [person.firstName, person.lastName]
      .filter(Boolean)
      .join(" ")
      .trim(),
    openCount,
    assignees: assignees.filter((a) => a.id !== fromUserId),
  };
}

/**
 * The open follow-ups one account is holding — the ids a handoff moves.
 *
 * IDS, NOT AN UPDATE. The handoff re-assigns each one through `updateTask`, the
 * task domain's single write door, so the moved tasks get the notification
 * re-sync an assignee change owes (N-011) and the D2 guard on the receiver
 * without this module re-implementing either. `updateTask` lives in
 * `service.ts`, which imports the guard from here, so the loop belongs to the
 * caller rather than to a cycle.
 */
export async function listFollowUpTaskIdsOwnedBy(
  churchId: string,
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(...openTaskConditions(churchId), eq(tasks.assignedToId, userId)))
    .orderBy(tasks.id);

  return rows.map((row) => row.id);
}
