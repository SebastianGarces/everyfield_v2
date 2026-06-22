// ============================================================================
// Phase Engine — Signal layer public surface.
//
// The Signal layer computes the deterministic plant fact snapshot consumed by
// the LLM-as-judge (judgment layer) and the phase-transition audit log. Import
// `buildFactSnapshot` from here; the underlying queries are an implementation
// detail and intentionally not re-exported.
// ============================================================================

export { buildFactSnapshot, SNAPSHOT_VERSION } from "./build-fact-snapshot";
export {
  MINISTRY_ROLE_KEYS,
  type BuildFactSnapshotOptions,
  type CoreGroupSignals,
  type FollowUpSignals,
  type LaunchSignals,
  type LeadershipReadinessSignal,
  type LeadershipSignals,
  type ManualAttestation,
  type ManualSignals,
  type MinistryRoleCoverage,
  type MinistryRoleKey,
  type MinistryRoleSignals,
  type PlantFactSnapshot,
  type TrainingSignals,
  type VisionMeetingSignals,
} from "./types";
