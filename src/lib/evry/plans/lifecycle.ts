import {
  evryPlanStatuses as EVRY_PLAN_STATUSES,
  type EvryPlanStatus,
} from "@/db/schema/evry";

export { EVRY_PLAN_STATUSES };
export type { EvryPlanStatus };

const TRANSITIONS = {
  draft: ["awaiting_confirmation", "cancelled", "superseded"],
  awaiting_confirmation: ["approved", "cancelled", "superseded", "expired"],
  approved: ["executing", "cancelled", "superseded", "expired"],
  executing: ["completed", "partially_failed", "failed"],
  completed: [],
  partially_failed: [],
  failed: [],
  cancelled: [],
  superseded: [],
  expired: [],
} as const satisfies Record<EvryPlanStatus, readonly EvryPlanStatus[]>;

export function canTransitionEvryPlan(
  from: EvryPlanStatus,
  to: EvryPlanStatus
): boolean {
  return (TRANSITIONS[from] as readonly EvryPlanStatus[]).includes(to);
}

export function isTerminalEvryPlanStatus(status: EvryPlanStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
