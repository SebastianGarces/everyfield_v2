import type { TaskStatus } from "@/db/schema/tasks";

/** Closed without claiming the work was done. Only completion earns completion credit. */
export const actionableTaskStatuses = [
  "not_started",
  "in_progress",
  "blocked",
] as const;
export function isTaskSettled(status: TaskStatus): boolean {
  return status === "complete" || status === "no_longer_needed";
}
