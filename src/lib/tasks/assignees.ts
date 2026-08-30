import {
  and,
  eq,
  exists,
  isNull,
  or,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * A Task assignee is a plant account, not merely a row whose `church_id`
 * happens to match. Legacy/malformed rows can name more than one tenancy; the
 * global tenancy invariant makes those rows unavailable everywhere rather
 * than choosing one of their tenants.
 */
export const TASK_ASSIGNEE_ERROR =
  "This assignee is not available. Choose another person.";

export function exactTaskAssigneeConditions(plantId: string): SQL[] {
  return [
    eq(users.churchId, plantId),
    isNull(users.sendingChurchId),
    isNull(users.sendingNetworkId),
  ];
}

export function exactTaskAssigneeJoin(plantId: string): SQL {
  return and(...exactTaskAssigneeConditions(plantId))!;
}

/**
 * A correlated guard for a task row that may be unassigned.
 *
 * This belongs in every mutation predicate, rather than in a read followed by
 * a write: a legacy dual-tenant assignee and an assignee whose tenancy changes
 * after the read are both unavailable at the instant the write is attempted.
 */
export function taskAssigneeIsAvailable(
  plantId: string,
  assignedToId: SQLWrapper
): SQL {
  const exactAssignee = alias(users, "exact_task_assignee");

  return or(
    isNull(assignedToId),
    exists(
      db
        .select({ id: exactAssignee.id })
        .from(exactAssignee)
        .where(
          and(
            eq(exactAssignee.id, assignedToId),
            eq(exactAssignee.churchId, plantId),
            isNull(exactAssignee.sendingChurchId),
            isNull(exactAssignee.sendingNetworkId)
          )
        )
    )
  )!;
}

export async function isExactTaskAssignee(
  plantId: string,
  assigneeId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.id, assigneeId), ...exactTaskAssigneeConditions(plantId))
    )
    .limit(1);

  return Boolean(row);
}

export async function assertExactTaskAssignee(
  plantId: string,
  assigneeId: string | null | undefined
): Promise<void> {
  if (!assigneeId) return;
  if (await isExactTaskAssignee(plantId, assigneeId)) return;
  throw new Error(TASK_ASSIGNEE_ERROR);
}
