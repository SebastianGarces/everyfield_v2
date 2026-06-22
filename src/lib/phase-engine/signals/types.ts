// ============================================================================
// Phase Engine — Signal layer types (the deterministic fact-snapshot contract)
//
// This is the typed shape produced by `buildFactSnapshot(churchId)` and consumed
// by BOTH the LLM-as-judge and the phase-transition audit log. Every value here
// is SQL-derived (PE-004 / AC-PE-2 / NFR-PE-1): the LLM never produces a fact.
//
// Design rules baked into the types:
//   - Reproducibility (AC-PE-2): the snapshot is a pure function of (DB state,
//     reference time). The reference time is captured in `generatedAt` and all
//     time-relative facts (cadence, staleness, countdown) are computed from it.
//   - Cold-start (PE-018): sparse plants never throw. Counts are 0 and trends/
//     deltas are `null` with explicit emptiness markers, so the judge can produce
//     onboarding guidance rather than misleading numbers.
//   - Tenant isolation (NFR-PE-6): everything is derived from church_id-scoped
//     queries; the snapshot itself carries `churchId` for auditability.
// ============================================================================

/**
 * The 8 canonical ministry roles a plant must fill before launch
 * (CSF-7, rubric-v0 Part A). Coverage of these 8 is a load-bearing signal.
 */
export const MINISTRY_ROLE_KEYS = [
  "worship",
  "childrens",
  "assimilation",
  "small_groups",
  "admin_finance",
  "facilities",
  "promotion",
  "technology",
] as const;
export type MinistryRoleKey = (typeof MINISTRY_ROLE_KEYS)[number];

/** Status of one of the 8 canonical ministry roles. */
export interface MinistryRoleCoverage {
  key: MinistryRoleKey;
  /** Human label, e.g. "Worship". */
  label: string;
  /** A team matching this role exists for the plant. */
  teamPresent: boolean;
  /** A leader/owner is assigned to the matched team (role is "filled"). */
  filled: boolean;
}

/** Committed core-group size + growth, derived from signed commitments. */
export interface CoreGroupSignals {
  /** Distinct people with a signed `core_group` commitment. */
  committedCount: number;
  /** Distinct people with a signed `launch_team` commitment. */
  launchTeamCount: number;
  /**
   * Net change in committed count over the trailing window vs. the prior
   * window (people whose first commitment landed in the window).
   * `null` at cold-start (no commitments yet).
   */
  growthDelta: number | null;
  /** Length of the comparison window, in days. */
  growthWindowDays: number;
  /** No commitments recorded yet. */
  isEmpty: boolean;
}

/** Vision-meeting cadence + attendance trend, derived from completed meetings. */
export interface VisionMeetingSignals {
  /** Completed vision meetings ever held. */
  totalCompleted: number;
  /** ISO date of the most recent completed vision meeting, or `null`. */
  lastMeetingAt: string | null;
  /** Whole days since the last completed vision meeting, or `null`. */
  daysSinceLastMeeting: number | null;
  /** Average gap (days) between the last few meetings; `null` if < 2 meetings. */
  averageCadenceDays: number | null;
  /** Attendance of the most recent completed meeting, or `null`. */
  latestAttendance: number | null;
  /** Attendance of the prior completed meeting, or `null`. */
  previousAttendance: number | null;
  /**
   * Direction of the attendance trend between the last two meetings.
   * `null` when fewer than 2 measured meetings exist.
   */
  attendanceTrend: "up" | "down" | "flat" | null;
  /** No completed vision meetings yet. */
  isEmpty: boolean;
}

/** Follow-up health: how stale the warmest pre-commitment contacts are. */
export interface FollowUpSignals {
  /** People in active follow-up stages (attendee / following_up / interviewed). */
  openCount: number;
  /**
   * Max whole days since any open follow-up contact was last touched
   * (person `updatedAt`). `null` when there are no open contacts.
   */
  stalestDays: number | null;
  /** Count of open contacts untouched beyond the staleness threshold. */
  staleCount: number;
  /** Threshold (days) used to classify a contact as "stale". */
  staleThresholdDays: number;
  /** No open follow-up contacts. */
  isEmpty: boolean;
}

/** Coverage of the 8 canonical ministry roles (CSF-7). */
export interface MinistryRoleSignals {
  /** How many of the 8 roles are filled (have a leader assigned). */
  filledCount: number;
  /** Always 8. */
  totalRoles: number;
  /** Per-role detail in canonical order. */
  roles: MinistryRoleCoverage[];
  /** No ministry teams exist yet. */
  isEmpty: boolean;
}

/**
 * Per-person leadership-readiness signal. Purely countable inputs — the judge
 * interprets them; it never invents the underlying numbers.
 */
export interface LeadershipReadinessSignal {
  personId: string;
  /** Current pipeline status (PersonStatus). */
  status: string;
  /** Whole days since the person was created (tenure proxy). */
  tenureDays: number;
  /** Completed vision meetings this person attended. */
  meetingsAttended: number;
  /** Active ministry-team memberships (volunteering proxy). */
  activeMemberships: number;
  /** Person holds a signed core-group or launch-team commitment. */
  hasCommitment: boolean;
  /** Person leads at least one ministry team. */
  leadsTeam: boolean;
}

export interface LeadershipSignals {
  /** Readiness rows for committed / core-group / launch-team / leader people. */
  candidates: LeadershipReadinessSignal[];
  /** No leadership candidates yet. */
  isEmpty: boolean;
}

/** Training progress across required programs (CSF-8). */
export interface TrainingSignals {
  /** Distinct training programs defined for the plant. */
  programCount: number;
  /** Programs flagged `is_required`. */
  requiredProgramCount: number;
  /** Total completion records across all programs. */
  completionCount: number;
  /**
   * Share of required-program "slots" completed, where a slot is one committed
   * person × one required program. 0..1; `null` when no required programs or no
   * committed people exist.
   */
  requiredCompletionRate: number | null;
  /** No training programs defined yet. */
  isEmpty: boolean;
}

/** Launch-date countdown (PE-004). `launch_date` lives on the church entity. */
export interface LaunchSignals {
  /** ISO date (yyyy-mm-dd) of the target launch, or `null` if unset. */
  launchDate: string | null;
  /**
   * Whole days from `generatedAt` to `launchDate`. Positive = future,
   * negative = past, `null` when no launch date is set.
   */
  daysUntilLaunch: number | null;
  /** Launch date is set and already in the past relative to `generatedAt`. */
  isPastDue: boolean;
  /** No launch date set yet. */
  isEmpty: boolean;
}

/** One manual self-attestation merged in from `plant_signals` (PE-005). */
export interface ManualAttestation {
  signalKey: string;
  value: unknown;
  attestedAt: string;
}

/**
 * Manual attestations the system cannot observe (PE-005). These are the ONLY
 * facts read from `plant_signals`; no computed fact is stored there.
 */
export interface ManualSignals {
  attestations: ManualAttestation[];
  /** Lookup by signal key for convenience. */
  byKey: Record<string, unknown>;
  /** No manual attestations recorded yet. */
  isEmpty: boolean;
}

/**
 * The complete deterministic fact snapshot for a plant. Reproducible from the
 * DB given the same `generatedAt`; contains no LLM-generated value.
 */
export interface PlantFactSnapshot {
  /** Schema version of this snapshot shape (for audit/migration). */
  snapshotVersion: string;
  churchId: string;
  /** Current phase of the plant (context, not a gate). */
  currentPhase: number;
  /** Reference time all time-relative facts were computed from (ISO). */
  generatedAt: string;
  /**
   * True when the plant has essentially no activity across all sources —
   * the cold-start case (PE-018). Lets the judge produce onboarding guidance.
   */
  isColdStart: boolean;
  coreGroup: CoreGroupSignals;
  visionMeetings: VisionMeetingSignals;
  followUp: FollowUpSignals;
  ministryRoles: MinistryRoleSignals;
  leadership: LeadershipSignals;
  training: TrainingSignals;
  launch: LaunchSignals;
  manual: ManualSignals;
}

/** Options controlling the snapshot computation (kept deterministic). */
export interface BuildFactSnapshotOptions {
  /**
   * Reference time for all time-relative facts. Defaults to "now" at call time.
   * Passing a fixed value makes the snapshot fully reproducible (AC-PE-2).
   */
  asOf?: Date;
}
