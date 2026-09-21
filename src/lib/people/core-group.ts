import type { PersonStatus } from "@/db/schema/people";

/** Advancing into the launch team or leadership does not leave the Core Group. */
export const CORE_GROUP_STATUSES = [
  "core_group",
  "launch_team",
  "leader",
] as const satisfies readonly PersonStatus[];

export function isCoreGroupStatus(status: string): boolean {
  return CORE_GROUP_STATUSES.some((member) => member === status);
}
