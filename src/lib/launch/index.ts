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
