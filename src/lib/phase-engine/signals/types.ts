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

// Type-only import: erased at build time, so the snapshot contract names the
// launch lifecycle the schema defines instead of re-declaring it as a string
// union that could drift from `launches.status`.
import type { LaunchStatus } from "@/db/schema/launch";
import type { EvidenceProfile } from "./evidence";

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
  /**
   * THE FLAT-STREAK FACT (#471, C02/C22). Whole days since the most recent
   * person's FIRST `core_group` commitment. `null` at cold start.
   *
   * The +1 RESET IS THE DEFINITION, not a rule the judge applies: one new
   * committed adult makes this 0, so "any new adult resets the clock" needs no
   * interpretation. A person's SECOND commitment — launch team, or a re-signed
   * card — is not a new adult and does not touch it.
   *
   * Distinct from `growthDelta`, which compares two 28-day windows and can read
   * "flat" while somebody joined yesterday. Bryan kept that window; this is the
   * one the "stalled" word is allowed to rest on.
   */
  daysSinceLastNewCommitment: number | null;
  /**
   * The two-level threshold rubric v1's Lens 3 cites (#471). "Momentum has
   * slowed" is allowed at `slowedThresholdDays`; the word STALLED is not
   * allowed before `stalledThresholdDays`, because one vision-meeting cycle
   * can change the picture inside three weeks. Facts rather than constants in
   * the prompt text, so the judge cites a number it was handed.
   */
  slowedThresholdDays: number;
  stalledThresholdDays: number;
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
  /**
   * THE CADENCE SLIP HAS TWO LEVELS (#486, C22). Bryan: "21 days without a
   * vision meeting: KEEP, but make it a 'watch'… I wouldn't make it sound like
   * a crisis. At 28+ days, the language can get more direct."
   *
   * v0 had one number and therefore one voice. Facts rather than numbers in the
   * prompt text, so the judge cites thresholds it was handed.
   */
  cadenceWatchDays: number;
  cadenceDirectDays: number;
  /** No completed vision meetings yet. */
  isEmpty: boolean;
}

/**
 * COHESION, MEASURED AS A SHARE (#486, C22/D1/D2).
 *
 * Bryan on the v0 rule: "Four members disengaging: CHANGE COMPLETELY.
 * Percentage based. 20-25% of the active committed group over 28 days,
 * absolute minimum of three people. Leaders carry more weight." Four of twelve
 * is a crisis; four of seventy may be a holiday.
 *
 * "Disengaging" has ONE definition (D2), chosen because it fits in a sentence:
 * a committed member who attended NO meeting in the last 28 days after
 * attending at least one in the 28 before that. No scoring curve, nothing to
 * explain twice.
 */
export interface CohesionSignals {
  /**
   * Committed members who attended anything in the last 56 days — the
   * denominator. "Active" is deliberately not "everyone who ever signed":
   * a plant carrying forty dormant commitments would make any share look tiny.
   */
  activeCommittedCount: number;
  /** Of those, how many have gone quiet by the definition above. */
  disengagedCount: number;
  /** Their share of the active committed group, 0–1. `null` when nobody is active. */
  disengagedShare: number | null;
  /**
   * At least one of the disengaged leads a ministry team.
   *
   * A QUALITATIVE FLAG, NOT A WEIGHT. Bryan said leaders carry more weight;
   * turning that into a coefficient would produce a number nobody could
   * explain, so the rubric tells the judge to make the language more direct
   * when this is true and the arithmetic stays honest.
   */
  disengagedIncludesLeader: boolean;
  /** Share of the active group at which the pattern is worth naming. */
  disengagedShareThreshold: number;
  /** …and never fewer people than this, however small the plant. */
  disengagedMinimumCount: number;
  /** The window both halves of the definition are measured over. */
  windowDays: number;
  /** No committed members are active, so there is nothing to read. */
  isEmpty: boolean;
}

/**
 * Follow-up health: how stale the warmest pre-commitment contacts are.
 *
 * The cohort is the plant's FIRST-TIME attendees who have not yet committed —
 * the only door into these statuses is a person's first vision meeting — which
 * is the same set VM-007 generates follow-up tasks for (#323 WS2). The
 * interpretation note lives above `buildFollowUpSignals`.
 */
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
  /**
   * MEASURED OWNERSHIP (#470, C01/C13) — the only facts rubric v1's Lens 2 may
   * speak from about who carries follow-up. Staleness does not imply the
   * planter is carrying it; these four say what is actually known.
   *
   * `unownedCount` and `staleUnownedCount` are per CONTACT, so they cover both
   * "the task is unassigned" and "there is no task at all". The other two are
   * per TASK, because they describe how the work is spread. All four treat an
   * assignee who has been demoted out of the committed set, or removed, as no
   * owner at all. Counted by `countFollowUpOwnership` in
   * `lib/tasks/follow-up-ownership.ts`, which is also what `/tasks` groups by.
   */
  unownedCount: number;
  staleUnownedCount: number;
  distinctOwnerCount: number;
  planterOwnedCount: number;
  /**
   * STALENESS DEPENDS ON THE CONTACT (#486, C22). Bryan: "Warm / just came to a
   * vision meeting: 48-72 hours ideal, flag at 7, seriously stale at 14. Colder
   * contacts: 14 may be fine."
   *
   * A universal 14 days was wrong in both directions at once — a week late for
   * somebody who came on Tuesday, and fussy about somebody who has been on the
   * list since spring.
   *
   * WARM = attended a vision meeting within the last `warmWindowDays`. Not a
   * status and not a guess: the thing that makes a contact warm is that they
   * just turned up.
   */
  warmCount: number;
  /** Warm contacts untouched beyond `warmStaleThresholdDays` (7). */
  staleWarmCount: number;
  /** Warm contacts untouched beyond the cold threshold (14) — seriously stale. */
  seriouslyStaleWarmCount: number;
  /** Cold contacts untouched beyond the cold threshold (14). */
  staleColdCount: number;
  warmWindowDays: number;
  warmStaleThresholdDays: number;
  /** The 48–72h ideal is rubric language, not a fact: nothing measures hours. */
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
 * Per-person LEADERSHIP CANDIDATE signal (#476, C07) — renamed from
 * `LeadershipReadinessSignal`, because the old name was the claim.
 *
 * Bryan: "Attendance and volunteering can identify a potential leader, but
 * character, doctrine, gifting, relational maturity, teachability, etc. still
 * require human judgment. Maybe call this a Leadership Candidate Signal rather
 * than readiness." The facts below are unchanged — what changed is that the
 * type no longer promises they add up to readiness.
 *
 * Purely countable inputs; the judge interprets them and never invents the
 * numbers. Two of them are RECORDED HUMAN JUDGMENTS rather than behaviour, and
 * they are the reason this signal can now say more than "they turn up": the
 * judge may cite what an interviewer concluded, and may never conclude it.
 */
export interface LeadershipCandidateSignal {
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
  /** 5-criteria interviews recorded for this person. */
  interviewCount: number;
  /**
   * The `overall_result` of the most recent interview, or `null` when there has
   * been none. A HUMAN'S recorded verdict — the judge cites it, never makes it.
   */
  lastInterviewResult: string | null;
  /** ISO date of that interview, or `null`. */
  lastInterviewDate: string | null;
  /** 4 C's assessments recorded for this person. */
  assessmentCount: number;
  /** `total_score` of the most recent 4 C's assessment, or `null`. */
  lastAssessmentTotal: number | null;
  /** ISO date of that assessment, or `null`. */
  lastAssessmentDate: string | null;
}

/**
 * @deprecated Renamed to {@link LeadershipCandidateSignal} in #476. The alias
 * stays for one release so a stored snapshot's type can still be named by
 * anything reading history; new code uses the candidate name.
 */
export type LeadershipReadinessSignal = LeadershipCandidateSignal;

export interface LeadershipSignals {
  /** Readiness rows for committed / core-group / launch-team / leader people. */
  candidates: LeadershipCandidateSignal[];
  /**
   * The behavioural pattern that OPENS a leadership conversation, in days
   * (#476, C07 + C22). It never closes one: 60 days of unbroken attendance and
   * serving is "have you considered more for this person?", not "this person is
   * ready to lead". A fact rather than a number in the prompt text, so the
   * judge cites a threshold it was handed.
   */
  candidateThresholdDays: number;
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

/**
 * Launch-date countdown (PE-004). The date lives on the LAUNCH entity
 * (`launches.target_date`) as of LS-001 / migration 0032 — the church row's
 * `launch_date` column was dropped, and the field names below are kept as they
 * were so no consumer of the snapshot had to change.
 */
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

  // --------------------------------------------------------------------------
  // Status, readiness and outcome (LS-008). ADDITIVE, AND THEREFORE OPTIONAL.
  //
  // This interface is also the shape a PERSISTED snapshot is read back as
  // (`computeSnapshotDelta` compares an assessment's stored JSON against a fresh
  // one), and every snapshot written before LS-008 lacks these keys. Optional is
  // the honest description of that: the builder always sets them, a stored
  // snapshot from last month does not have them, and a reader must not assume.
  //
  // WHAT THEY ARE NOT: none of these advance anything. Recording a launch is a
  // material event and nothing more — the engine stays ADVISORY (ruled
  // 2026-08-04), `current_phase` is copied from the church row, and no fact here
  // is consulted to change it. `assembleFactSnapshot` is pure; the phase only
  // ever moves through the transition service.
  // --------------------------------------------------------------------------

  /**
   * The launch lifecycle: `planning` | `scheduled` | `postponed` | `completed`.
   * `null` means the plant has no launch row at all — a different fact from a
   * launch being planned with no day named, which the countdown fields collapse
   * together but this one does not.
   */
  status?: LaunchStatus | null;
  /** The day happened and the planter recorded it (`status = 'completed'`). */
  isCompleted?: boolean;
  /** The day was committed to and then moved (LS-009). */
  isPostponed?: boolean;
  /** An outcome record exists (`outcome_recorded_at is not null`). */
  outcomeRecorded?: boolean;
  /**
   * People present on the day. `null` = not recorded, which is NOT `0` — zero
   * is a real answer and the judge must not be told nobody came when nobody
   * counted.
   */
  attendanceCount?: number | null;
  /** Decisions/responses on the day. `null` = not recorded, never `0`. */
  decisionsCount?: number | null;
  /** Playbook readiness milestones seeded for this launch (LS-003). */
  readinessTotalCount?: number;
  /** How many of them are complete. */
  readinessCompletedCount?: number;
  /**
   * Completed ÷ total, 0..1. `null` when nothing has been seeded — a plant with
   * no readiness list is not 0% ready, it has no list.
   */
  readinessCompletionRate?: number | null;
}

/** One manual self-attestation merged in from `plant_signals` (PE-005). */
export interface ManualAttestation {
  signalKey: string;
  value: unknown;
  attestedAt: string;
  /**
   * Whole days since the planter last answered this (#474, C21).
   *
   * FRESHNESS IS METADATA, NOT A THIRD QUESTION. Bryan asked whether the prayer
   * rhythm "has actually happened in the last 30 days"; `plant_signals` already
   * stamps `attested_at` on every write, including a reaffirm of the same
   * value, so the answer was already in the row. Asking it as a second toggle
   * would have turned `/phase` into a questionnaire to learn something the
   * database knew.
   */
  attestedDaysAgo: number;
}

/**
 * Manual attestations the system cannot observe (PE-005). These are the ONLY
 * facts read from `plant_signals`; no computed fact is stored there.
 */
export interface ManualSignals {
  attestations: ManualAttestation[];
  /** Lookup by signal key for convenience. */
  byKey: Record<string, unknown>;
  /**
   * How long a perishable attestation stays fresh, in days (#474 D2). A fact
   * rather than a number in the prompt text, for the same reason every other
   * threshold is: a threshold the judge cites has to be one it was handed.
   */
  reaffirmWindowDays: number;
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
  cohesion: CohesionSignals;
  manual: ManualSignals;
  /**
   * WHAT EACH LENS ACTUALLY KNOWS (#483, C17) — measured / attested / unknown
   * per CSF lens, derived from the blocks above.
   *
   * OPTIONAL, because a snapshot persisted before #483 does not carry it and
   * every reader recomputes it with `buildEvidenceProfile(snapshot)` anyway.
   * It is written on every new snapshot so that it FLATTENS INTO THE JUDGE'S
   * FACT LEDGER — the judge has to be handed what each lens knows, or "unknown
   * is not healthy" is a rule it cannot apply.
   *
   * Derived and never a stored verdict (D1): there is no `evidence_quality`
   * column to drift from the facts it describes.
   */
  evidence?: EvidenceProfile;
}

/** Options controlling the snapshot computation (kept deterministic). */
export interface BuildFactSnapshotOptions {
  /**
   * Reference time for all time-relative facts. Defaults to "now" at call time.
   * Passing a fixed value makes the snapshot fully reproducible (AC-PE-2).
   */
  asOf?: Date;
}
