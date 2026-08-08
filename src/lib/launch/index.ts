// ============================================================================
// Launch (LS-001…009) — the barrel.
//
// NOTHING HERE CARRIES `"use server"`, and nothing here may be re-exported from
// a module that does: these are helpers taking bare ids, and in a `"use server"`
// module the export list IS the auth surface (memory/invariants.md →
// Authentication). Actions live next to their page and mint their actor from
// `verifySession()`.
// ============================================================================

export { daysUntilTarget, parseTargetDate } from "./countdown";
export { getLaunchJournalEntries, type LaunchJournalEntry } from "./journal";
export {
  LAUNCH_MILESTONE_AREA_LABELS,
  LAUNCH_MILESTONE_AREA_ORDER,
} from "./milestone-areas";
export {
  completeLaunchMilestone,
  getLaunchReadiness,
  isLaunchTask,
  LAUNCH_MILESTONE_TEMPLATES,
  MILESTONE_HAS_OPEN_TASKS_MESSAGE,
  MILESTONE_NOT_FOUND_MESSAGE,
  reopenLaunchMilestone,
  seedLaunchMilestones,
  type LaunchMilestoneView,
  type LaunchReadiness,
} from "./milestones";
export {
  canRecordOutcome,
  launchOutcomeSchema,
  OUTCOME_ALREADY_RECORDED_MESSAGE,
  OUTCOME_NO_LAUNCH_MESSAGE,
  OUTCOME_TOO_EARLY_MESSAGE,
  recordLaunchOutcome,
  type LaunchOutcomeInput,
} from "./outcome";
export {
  getLaunchDatesForChurches,
  getLaunchForChurch,
  getLaunchJournal,
  getLaunchMilestones,
  type LaunchRecord,
} from "./queries";
export {
  LAUNCH_ALREADY_COMPLETED_MESSAGE,
  LAUNCH_CHANGED_ELSEWHERE_MESSAGE,
  setLaunchDate,
  setLaunchDateStatement,
  type SetLaunchDateOptions,
  type SetLaunchDateResult,
} from "./service";
export { launchTargetDateSchema } from "./validation";
