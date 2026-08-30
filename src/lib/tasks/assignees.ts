import { and, eq, isNull, type SQL } from "drizzle-orm";

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
