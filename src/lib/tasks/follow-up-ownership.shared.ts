// ============================================================================
// WHO OWNS THIS FOLLOW-UP — the half with no database in it (#470, C01/C13).
//
// Bryan's objection to rubric v0: eight stale follow-ups do not prove the
// planter is carrying them. They may equally mean ownership was distributed
// badly, or that people did not do what they agreed. v0 inferred one of the
// three from staleness and told the planter it was true. The fix is to MEASURE
// it, and the definitions of what is measured live here.
//
// PURE AND CLIENT-SAFE, deliberately. Three surfaces share these definitions —
// the `/tasks` assignments view (a `"use client"` island), the task form's
// assignee select, and the phase engine's fact snapshot — and a single value
// imported from the query half would drag `@/db` into the browser bundle. The
// reads that feed these functions are in `follow-up-ownership.ts`, which
// re-exports everything below so server callers still have one import.
//
// OWNERSHIP IS TASK OWNERSHIP (D1). The assignee owns the open follow-up task,
// not the relationship with the contact — the CRM person record is untouched.
// ============================================================================

import type { PersonStatus } from "@/db/schema";

/**
 * The task category ownership is measured on. Follow-up is the only one: it is
 * the category the meeting-finalization generator writes (MEET-011) and the one
 * CSF-2 is about. Guarding every category would make the planter unable to
 * assign a facilities task to the person who owns the building.
 */
export const OWNED_TASK_CATEGORY = "follow_up" as const;

/** What the write path throws when the D2 guard refuses. */
export const FOLLOW_UP_ASSIGNEE_ERROR =
  "Only committed members — Core Group, Launch Team or Leader — can own a follow-up.";

export const NEEDS_OWNER_LABEL = "Needs owner";

// ----------------------------------------------------------------------------
// The shapes
// ----------------------------------------------------------------------------

/** An account that may own a follow-up: its person row holds a committed status. */
export interface FollowUpAssignee {
  /** The account id — what `tasks.assigned_to_id` stores. */
  id: string;
  name: string | null;
  email: string;
  /** Their current pipeline status, which is why they are eligible. */
  status: PersonStatus;
  /** Holds the plant's owner seat — the planter. */
  isPlanter: boolean;
}

/** One open follow-up task and the current standing of whoever holds it. */
export interface OpenFollowUpTask {
  taskId: string;
  title: string;
  dueDate: string | null;
  /** The contact this follow-up is about, when it names one. */
  contactId: string | null;
  assignedToId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  /** The assignee still holds a committed status here. A demotion flips this. */
  ownerIsCommitted: boolean;
  /** The assignee holds the plant's owner seat. */
  ownerIsPlanter: boolean;
}

/** A contact sitting in an open follow-up status. */
export interface FollowUpContact {
  personId: string;
  name: string;
  status: PersonStatus;
  /** Person `updatedAt` — staleness is person-based and stays that way. */
  lastTouchedAt: Date;
}

/** What a demotion out of the committed set leaves behind (Q2). */
export interface FollowUpHandoff {
  /** The account whose follow-ups need re-homing. */
  fromUserId: string;
  /** The demoted member, for the dialog's sentence. */
  personName: string;
  openCount: number;
  /** Who they could go to — the demoted member is not among them. */
  assignees: FollowUpAssignee[];
}

/** One owner's group in the assignments view. `ownerId: null` = Needs owner. */
export interface FollowUpOwnerGroup {
  ownerId: string | null;
  ownerName: string;
  tasks: OpenFollowUpTask[];
}

/** The four facts rubric v1's Lens 2 is allowed to speak from (AC-6). */
export interface FollowUpOwnershipFacts {
  /** Open follow-up CONTACTS with no open, live-owned follow-up task. */
  unownedCount: number;
  /** Stale ∩ unowned — the contacts the planter is told about first. */
  staleUnownedCount: number;
  /** Distinct live owners across the open follow-up tasks. */
  distinctOwnerCount: number;
  /** Open follow-up tasks held by the planter's own account. */
  planterOwnedCount: number;
}

// ----------------------------------------------------------------------------
// The projections
// ----------------------------------------------------------------------------

/**
 * A follow-up counts as owned only while its owner is live and committed.
 *
 * THE ONE DEFINITION. `assigned_to_id` is a `users` FK, so it keeps pointing at
 * somebody who has since been demoted out of the committed set or removed from
 * the plant; a follow-up whose owner left has to resurface rather than hide
 * behind a name. Everything below, the view and the facts alike, asks this.
 */
export function isOwned(task: OpenFollowUpTask): boolean {
  return task.assignedToId !== null && task.ownerIsCommitted;
}

/**
 * Count ownership over the open follow-up CONTACTS, not over the tasks.
 *
 * The denominator matters and it is the contact cohort: "8 follow-ups need an
 * owner" has to cover the contact whose task is unassigned AND the contact who
 * has no task at all (Q1). Counting tasks would report zero for a plant that
 * never generated any, which is the worst case rather than the healthy one.
 *
 * `distinctOwnerCount` and `planterOwnedCount` are per-TASK, because they answer
 * "how is the work spread" rather than "who is uncovered".
 */
export function countFollowUpOwnership(
  contacts: readonly { id: string; isStale: boolean }[],
  openTasks: readonly OpenFollowUpTask[]
): FollowUpOwnershipFacts {
  const ownedContactIds = new Set<string>();
  const owners = new Set<string>();
  let planterOwnedCount = 0;

  for (const task of openTasks) {
    if (!isOwned(task)) continue;
    owners.add(task.assignedToId as string);
    if (task.ownerIsPlanter) planterOwnedCount += 1;
    if (task.contactId) ownedContactIds.add(task.contactId);
  }

  let unownedCount = 0;
  let staleUnownedCount = 0;
  for (const contact of contacts) {
    if (ownedContactIds.has(contact.id)) continue;
    unownedCount += 1;
    if (contact.isStale) staleUnownedCount += 1;
  }

  return {
    unownedCount,
    staleUnownedCount,
    distinctOwnerCount: owners.size,
    planterOwnedCount,
  };
}

/**
 * The contacts with no open, live-owned follow-up task (Q1) — the rows the view
 * offers a one-click create-and-assign on.
 *
 * Order is the caller's: `listFollowUpContacts` reads longest-waiting first,
 * because the planter reading this list is deciding whom to hand out and the
 * coldest contact is the one that decision is about.
 */
export function selectUnownedContacts(
  contacts: readonly FollowUpContact[],
  openTasks: readonly OpenFollowUpTask[]
): FollowUpContact[] {
  const covered = new Set(
    openTasks.filter(isOwned).flatMap((t) => (t.contactId ? [t.contactId] : []))
  );
  return contacts.filter((c) => !covered.has(c.personId));
}

/**
 * Group the open follow-ups by owner, with "Needs owner" pinned first (AC-3).
 *
 * Pinned rather than sorted into place because it is the only group that is
 * WORK: every other group is a report of who is carrying what, and the planter
 * opening this view is looking for what nobody has. It is returned even when
 * empty, so the view can say so out loud instead of rendering nothing.
 *
 * A task whose owner was demoted lands in "Needs owner" beside a task that was
 * never assigned — `isOwned` is the single definition, so the view and the facts
 * cannot drift.
 */
export function groupByOwner(
  openTasks: readonly OpenFollowUpTask[]
): FollowUpOwnerGroup[] {
  const needsOwner: FollowUpOwnerGroup = {
    ownerId: null,
    ownerName: NEEDS_OWNER_LABEL,
    tasks: [],
  };
  const owned = new Map<string, FollowUpOwnerGroup>();

  for (const task of openTasks) {
    if (!isOwned(task)) {
      needsOwner.tasks.push(task);
      continue;
    }
    const ownerId = task.assignedToId as string;
    let group = owned.get(ownerId);
    if (!group) {
      group = {
        ownerId,
        ownerName: task.ownerName ?? task.ownerEmail ?? "Unnamed member",
        tasks: [],
      };
      owned.set(ownerId, group);
    }
    group.tasks.push(task);
  }

  const rest = [...owned.values()].sort((a, b) =>
    a.ownerName.localeCompare(b.ownerName)
  );

  return [needsOwner, ...rest];
}
