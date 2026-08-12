// ============================================================================
// Phase Engine — Signal layer queries
//
// Every read here is church_id-scoped (NFR-PE-6) and returns ONLY raw, countable
// rows. There is no interpretation in the SNAPSHOT half of this file: the builder
// (build-fact-snapshot) assembles the deterministic snapshot from these
// primitives. Keeping the SQL isolated makes the determinism easy to audit
// (AC-PE-2) and the queries easy to reason about for tenant isolation.
//
// The file has a second half, from "PE-026" down: the trend and milestone-timeline
// READ LAYER. Those are pure PROJECTIONS over rows read here — the same division
// of labour `buildCsfScorecard` follows in assessment/queries.ts, and for the same
// reason: a projection that recomputes nothing is testable without a database and
// cannot disagree with the snapshot it was projected from. The rule that half is
// written against is stated at its own header — every number is read out of a
// persisted `fact_snapshot`, and every badge is a relabelled persisted severity.
// ============================================================================

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  commitments,
  launches,
  launchMilestones,
  meetingAttendance,
  ministryTeams,
  persons,
  phaseTransitions,
  plantAssessments,
  plantSignals,
  teamMemberships,
  trainingCompletions,
  trainingPrograms,
  type InsightAudience,
  type InsightSeverity,
  type PhaseTransitionKind,
  type PlantInsight,
} from "@/db/schema";
import type { LaunchMilestoneArea, LaunchStatus } from "@/db/schema/launch";
import { PHASES, type PhaseNumber } from "@/lib/constants";
// The one launch-countdown implementation (invariants.md → Hierarchical Access
// Control, the day-vs-instant rule). The timeline needs to know whether the
// launch day is behind or ahead of `asOf`; it asks THIS, and never subtracts
// two dates itself.
import { daysUntilTarget, parseTargetDate } from "@/lib/launch/countdown";
// The severity scale the CSF scorecard and the exit criteria already read the
// judge's output through. Imported rather than re-declared: an alert badge on a
// trend must be the SAME relabelling of the SAME persisted severity, or the page
// would carry two urgency vocabularies that drift apart.
import {
  csfStandingUrgency,
  standingForSeverity,
  type CsfStanding,
  type LatestAssessment,
} from "../assessment/queries";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

/** Statuses that count as "open" follow-up (warm, pre-commitment) contacts. */
export const FOLLOW_UP_STATUSES = [
  "attendee",
  "following_up",
  "interviewed",
] as const;

/** Statuses that make a person a leadership-readiness candidate. */
export const LEADERSHIP_CANDIDATE_STATUSES = [
  "core_group",
  "launch_team",
  "leader",
] as const;

// ----------------------------------------------------------------------------
// Church
// ----------------------------------------------------------------------------

export interface ChurchRow {
  id: string;
  currentPhase: number;
}

/**
 * Loads the church row. `null` when the church is absent.
 *
 * NO LAUNCH DATE HERE. It used to be `churches.launch_date`; migration 0032
 * dropped that column and Launch Sunday is an entity now (LS-001), so the
 * countdown signal reads `getLaunch()` below. Adding it back to this row — even
 * as a join — would re-create the two-owners state the entity exists to end.
 */
export async function getChurch(churchId: string): Promise<ChurchRow | null> {
  const rows = await db
    .select({
      id: churches.id,
      currentPhase: churches.currentPhase,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  return rows[0] ?? null;
}

// ----------------------------------------------------------------------------
// Launch (LS-001 / PE-004)
// ----------------------------------------------------------------------------

export interface LaunchRow {
  /** yyyy-mm-dd, or `null` while the launch is still `planning`. */
  targetDate: string | null;
  status: LaunchStatus;
  /**
   * OUTCOME FACTS (LS-006/LS-008). Non-null `outcomeRecordedAt` is the marker
   * that the day happened AND was written down; the counts are nullable because
   * "not recorded" and "nobody came" are different answers and the snapshot must
   * not flatten them into `0`.
   */
  outcomeRecordedAt: Date | null;
  attendanceCount: number | null;
  decisionsCount: number | null;
}

/**
 * The plant's launch, or `null` when it has none yet.
 *
 * `null` and `{ targetDate: null }` are DIFFERENT facts — "no launch record at
 * all" vs "a launch being planned with no day named" — and the builder collapses
 * them to the same empty countdown deliberately, because the countdown's
 * question is only ever "which day". Anything that wants to tell them apart
 * (the `/launch` page, the outcome facts) reads the row.
 */
export async function getLaunch(churchId: string): Promise<LaunchRow | null> {
  const rows = await db
    .select({
      targetDate: launches.targetDate,
      status: launches.status,
      outcomeRecordedAt: launches.outcomeRecordedAt,
      attendanceCount: launches.attendanceCount,
      decisionsCount: launches.decisionsCount,
    })
    .from(launches)
    .where(eq(launches.churchId, churchId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * One readiness milestone, reduced to what the snapshot counts (LS-003/LS-008).
 *
 * Rows, not counts, because this file returns raw countable primitives and the
 * builder does the arithmetic — the same division of labour every other signal
 * here follows, and what makes the assembler independently testable without a
 * database.
 */
export interface LaunchMilestoneRow {
  id: string;
  /** Non-null = complete. */
  completedAt: Date | null;
}

/**
 * The plant's launch readiness milestones (LS-003).
 *
 * Scoped by `church_id`, which `launch_milestones` carries denormalised for
 * exactly this reason (invariants → Multi-Tenancy): the tenancy filter is never
 * one JOIN away from being forgotten. A plant with no launch — or a launch whose
 * milestones have not been seeded — returns `[]`, which the builder reads as
 * "no readiness structure yet" rather than "0% ready".
 */
export async function getLaunchMilestoneRows(
  churchId: string
): Promise<LaunchMilestoneRow[]> {
  return db
    .select({
      id: launchMilestones.id,
      completedAt: launchMilestones.completedAt,
    })
    .from(launchMilestones)
    .where(eq(launchMilestones.churchId, churchId));
}

// ----------------------------------------------------------------------------
// Commitments (core group / launch team)
// ----------------------------------------------------------------------------

export interface CommitmentRow {
  personId: string;
  commitmentType: string;
  signedDate: string;
}

/**
 * All commitments for the plant, ordered deterministically by signed date then
 * id, so window/delta math is reproducible.
 */
export async function getCommitments(
  churchId: string
): Promise<CommitmentRow[]> {
  return db
    .select({
      personId: commitments.personId,
      commitmentType: commitments.commitmentType,
      signedDate: commitments.signedDate,
    })
    .from(commitments)
    .where(eq(commitments.churchId, churchId))
    .orderBy(commitments.signedDate, commitments.id);
}

// ----------------------------------------------------------------------------
// Vision meetings (completed) + attendance
// ----------------------------------------------------------------------------

export interface VisionMeetingRow {
  id: string;
  datetime: Date;
  actualAttendance: number | null;
}

/**
 * Completed vision meetings, most-recent first. Cadence/attendance trend is
 * derived from this ordered list by the builder.
 */
export async function getCompletedVisionMeetings(
  churchId: string
): Promise<VisionMeetingRow[]> {
  return db
    .select({
      id: churchMeetings.id,
      datetime: churchMeetings.datetime,
      actualAttendance: churchMeetings.actualAttendance,
    })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.type, "vision_meeting"),
        eq(churchMeetings.status, "completed")
      )
    )
    .orderBy(sql`${churchMeetings.datetime} desc`, churchMeetings.id);
}

// ----------------------------------------------------------------------------
// Follow-up contacts (open, pre-commitment)
// ----------------------------------------------------------------------------

export interface FollowUpRow {
  id: string;
  status: string;
  updatedAt: Date;
}

/** Non-deleted persons in an open follow-up status, church-scoped. */
export async function getOpenFollowUpContacts(
  churchId: string
): Promise<FollowUpRow[]> {
  return db
    .select({
      id: persons.id,
      status: persons.status,
      updatedAt: persons.updatedAt,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        inArray(persons.status, [...FOLLOW_UP_STATUSES])
      )
    )
    .orderBy(persons.id);
}

// ----------------------------------------------------------------------------
// Ministry teams (for role coverage) — team + whether a leader is assigned
// ----------------------------------------------------------------------------

export interface MinistryTeamRow {
  id: string;
  name: string;
  leaderId: string | null;
}

/** All ministry teams for the plant, church-scoped, ordered for determinism. */
export async function getMinistryTeams(
  churchId: string
): Promise<MinistryTeamRow[]> {
  return db
    .select({
      id: ministryTeams.id,
      name: ministryTeams.name,
      leaderId: ministryTeams.leaderId,
    })
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId))
    .orderBy(ministryTeams.name, ministryTeams.id);
}

// ----------------------------------------------------------------------------
// Leadership readiness — per-person aggregated countable inputs
// ----------------------------------------------------------------------------

export interface LeadershipPersonRow {
  id: string;
  status: string;
  createdAt: Date;
}

/** Candidate persons (committed / core-group / launch-team / leader). */
export async function getLeadershipCandidates(
  churchId: string
): Promise<LeadershipPersonRow[]> {
  return db
    .select({
      id: persons.id,
      status: persons.status,
      createdAt: persons.createdAt,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        inArray(persons.status, [...LEADERSHIP_CANDIDATE_STATUSES])
      )
    )
    .orderBy(persons.id);
}

export interface PersonCountRow {
  personId: string;
  count: number;
}

/** Completed-vision-meeting attendance counts per person, church-scoped. */
export async function getMeetingsAttendedByPerson(
  churchId: string
): Promise<PersonCountRow[]> {
  return db
    .select({
      personId: meetingAttendance.personId,
      count: sql<number>`count(*)::int`,
    })
    .from(meetingAttendance)
    .innerJoin(
      churchMeetings,
      eq(meetingAttendance.meetingId, churchMeetings.id)
    )
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.status, "attended"),
        eq(churchMeetings.type, "vision_meeting"),
        eq(churchMeetings.status, "completed")
      )
    )
    .groupBy(meetingAttendance.personId);
}

/** Active ministry-team membership counts per person, church-scoped. */
export async function getActiveMembershipsByPerson(
  churchId: string
): Promise<PersonCountRow[]> {
  return db
    .select({
      personId: teamMemberships.personId,
      count: sql<number>`count(*)::int`,
    })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.status, "active")
      )
    )
    .groupBy(teamMemberships.personId);
}

/** Distinct person ids that lead at least one ministry team, church-scoped. */
export async function getTeamLeaderPersonIds(
  churchId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ leaderId: ministryTeams.leaderId })
    .from(ministryTeams)
    .where(
      and(
        eq(ministryTeams.churchId, churchId),
        isNotNull(ministryTeams.leaderId)
      )
    );

  return rows.map((r) => r.leaderId).filter((id): id is string => id !== null);
}

// ----------------------------------------------------------------------------
// Training
// ----------------------------------------------------------------------------

export interface TrainingProgramRow {
  id: string;
  isRequired: boolean;
}

/** Training programs defined for the plant, church-scoped. */
export async function getTrainingPrograms(
  churchId: string
): Promise<TrainingProgramRow[]> {
  return db
    .select({
      id: trainingPrograms.id,
      isRequired: trainingPrograms.isRequired,
    })
    .from(trainingPrograms)
    .where(eq(trainingPrograms.churchId, churchId))
    .orderBy(trainingPrograms.id);
}

export interface TrainingCompletionRow {
  personId: string;
  trainingProgramId: string;
}

/** Training completion records for the plant, church-scoped. */
export async function getTrainingCompletions(
  churchId: string
): Promise<TrainingCompletionRow[]> {
  return db
    .select({
      personId: trainingCompletions.personId,
      trainingProgramId: trainingCompletions.trainingProgramId,
    })
    .from(trainingCompletions)
    .where(eq(trainingCompletions.churchId, churchId))
    .orderBy(trainingCompletions.id);
}

// ----------------------------------------------------------------------------
// Manual attestations (the ONLY facts read from plant_signals) — PE-005
// ----------------------------------------------------------------------------

export interface PlantSignalRow {
  signalKey: string;
  value: unknown;
  attestedAt: Date;
}

/** Manual self-attestations for the plant, church-scoped, ordered by key. */
export async function getPlantSignals(
  churchId: string
): Promise<PlantSignalRow[]> {
  return db
    .select({
      signalKey: plantSignals.signalKey,
      value: plantSignals.value,
      attestedAt: plantSignals.attestedAt,
    })
    .from(plantSignals)
    .where(eq(plantSignals.churchId, churchId))
    .orderBy(plantSignals.signalKey);
}

// ============================================================================
// PE-026 — trends and velocity, read out of the PERSISTED fact snapshots.
//
// Four trends a planter asks for by name: core-group growth, vision-meeting
// attendance, follow-up completion, ministry-team readiness (D-010…D-013).
//
// WHERE THE HISTORY COMES FROM, AND WHY IT IS NOT RE-DERIVED FROM FEATURE DATA.
// Every assessment persists the exact `PlantFactSnapshot` the judge reasoned
// over (`plant_assessments.fact_snapshot`, NFR-PE-5). That column is therefore
// already a dated series of deterministic readings, and reading the series out
// of it — rather than recomputing four metrics from `commitments`,
// `church_meetings`, `persons` and `ministry_teams` — is what makes "every value
// is SQL-derived from the fact snapshot" true by construction:
//
//   - each point on each trend is one `#>>` extraction from one stored snapshot,
//     taken by the SAME dotted path build-fact-snapshot.ts wrote it at, so a
//     value on a chart can be traced to the line of the builder that produced it
//     (`TREND_SNAPSHOT_PATHS`, and `TrendMetric.factPaths` carries the paths to
//     the UI so the trace survives into the surface);
//   - a plant with one assessment has one point, and a one-point metric reports
//     a VALUE with no delta and no direction. A trend line through a single
//     reading is a fabricated claim about change nobody measured;
//   - a snapshot written before a field existed yields SQL NULL at that path,
//     which drops the point rather than pinning the series to zero.
//
// AND WHY NO METRIC IS RECOMPUTED HERE EITHER. The two ratios (follow-up
// completion, team readiness) are divisions of two counts read out of the same
// snapshot, and nothing else. There is no scoring pass, no weighting, and — the
// point of the whole section — NO THRESHOLD. Nothing in this file, or in the
// components that render it, decides that a number is "low" or "bad".
//
// ALERT BADGES ARE THE JUDGE'S, RELABELLED (PE-027). A badge is the severity the
// judge already assigned to a persisted insight in the assessment's own
// category, passed through `standingForSeverity` — the SAME function the CSF
// scorecard and the exit criteria read severities through. `EngineAlert` carries
// the insight id and the raw severity it came from, so a badge on screen can be
// traced to the `plant_insights` row that set it. A second threshold system —
// "attendance below N is a warning" written into a component — is the specific
// failure this shape exists to make impossible: there is no number for a
// component to threshold, only a standing it was handed.
// ============================================================================

// ----------------------------------------------------------------------------
// The snapshot fields a trend is read from.
// ----------------------------------------------------------------------------

/**
 * Dotted paths into `PlantFactSnapshot`, as the segments the SQL `#>>` operator
 * takes. ONE table drives both the SQL and the `factPaths` reported to the UI,
 * so the path a chart claims its numbers came from is literally the path the
 * query read. Every key here is written by `assembleFactSnapshot`
 * (build-fact-snapshot.ts); `queries.test.ts` asserts that against a real
 * assembled snapshot rather than trusting this comment.
 */
const TREND_SNAPSHOT_PATHS = {
  coreGroupCommittedCount: ["coreGroup", "committedCount"],
  visionMeetingLatestAttendance: ["visionMeetings", "latestAttendance"],
  followUpOpenCount: ["followUp", "openCount"],
  followUpStaleCount: ["followUp", "staleCount"],
  followUpStaleThresholdDays: ["followUp", "staleThresholdDays"],
  ministryRolesFilledCount: ["ministryRoles", "filledCount"],
  ministryRolesTotalRoles: ["ministryRoles", "totalRoles"],
} as const satisfies Record<string, readonly string[]>;

/** A snapshot field a trend may be read from. */
export type TrendSnapshotField = keyof typeof TREND_SNAPSHOT_PATHS;

/** `coreGroup.committedCount` — the form `readSnapshotFact` and the UI speak. */
export function trendSnapshotPath(field: TrendSnapshotField): string {
  return TREND_SNAPSHOT_PATHS[field].join(".");
}

/**
 * One integer read out of the stored snapshot JSON, by path.
 *
 * `#>>` returns text (SQL NULL when the path is absent or stores JSON null), so
 * the cast yields `null` for both "this snapshot predates the field" and "the
 * builder recorded no reading" — which the series treats identically, because
 * neither is a measurement. The path literal is built from the table above and
 * contains only fixed camelCase identifiers; no value from a caller reaches it.
 */
function snapshotInteger(field: TrendSnapshotField) {
  const jsonPath = sql.raw(`'{${TREND_SNAPSHOT_PATHS[field].join(",")}}'`);
  return sql<
    number | null
  >`(${plantAssessments.factSnapshot} #>> ${jsonPath})::int`;
}

/** One persisted snapshot, reduced to the fields the four trends read. */
export interface SnapshotHistoryRow {
  assessmentId: string;
  generatedAt: Date;
  coreGroupCommittedCount: number | null;
  visionMeetingLatestAttendance: number | null;
  followUpOpenCount: number | null;
  followUpStaleCount: number | null;
  followUpStaleThresholdDays: number | null;
  ministryRolesFilledCount: number | null;
  ministryRolesTotalRoles: number | null;
}

/**
 * How many assessments a trend looks back over. Twelve is the stat-tile
 * sparkline's own point budget — enough to show a shape, few enough that the
 * oldest point is still the same plant.
 */
export const TREND_HISTORY_LIMIT = 12;

/**
 * The most recent COMPLETE assessments' fact snapshots, OLDEST FIRST.
 *
 * `complete` only, and church-scoped: this is the same population every other
 * read layer surface projects (`getLatestAssessment`), so the newest point of a
 * trend is by construction the snapshot the CSF scorecard and the exit criteria
 * are showing. A pending or failed run has no snapshot worth plotting.
 */
export async function getSnapshotTrendHistory(
  churchId: string,
  limit: number = TREND_HISTORY_LIMIT
): Promise<SnapshotHistoryRow[]> {
  const rows = await db
    .select({
      assessmentId: plantAssessments.id,
      generatedAt: plantAssessments.generatedAt,
      coreGroupCommittedCount: snapshotInteger("coreGroupCommittedCount"),
      visionMeetingLatestAttendance: snapshotInteger(
        "visionMeetingLatestAttendance"
      ),
      followUpOpenCount: snapshotInteger("followUpOpenCount"),
      followUpStaleCount: snapshotInteger("followUpStaleCount"),
      followUpStaleThresholdDays: snapshotInteger("followUpStaleThresholdDays"),
      ministryRolesFilledCount: snapshotInteger("ministryRolesFilledCount"),
      ministryRolesTotalRoles: snapshotInteger("ministryRolesTotalRoles"),
    })
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.churchId, churchId),
        eq(plantAssessments.status, "complete")
      )
    )
    // Newest-first is what the index serves and what `limit` must cut from; the
    // series is chronological, so it is reversed once, here.
    .orderBy(desc(plantAssessments.generatedAt))
    .limit(limit);

  return rows.reverse();
}

// ----------------------------------------------------------------------------
// Alert badges — the judge's severity, relabelled. Never a threshold.
// ----------------------------------------------------------------------------

/**
 * What the engine said about the thing this badge sits on.
 *
 * `standing` is `standingForSeverity(severity)` and nothing else; `severity`,
 * `insightId` and `insightTitle` are kept beside it so the badge is traceable
 * back to the persisted `plant_insights` row that produced it. `not_raised`
 * (with a null severity) means the assessment did not speak to this — which is
 * neither good nor bad, and must never render as either.
 */
export interface EngineAlert {
  standing: CsfStanding;
  severity: InsightSeverity | null;
  insightId: string | null;
  insightTitle: string | null;
  /** How many insights in the badge's categories the assessment raised. */
  insightCount: number;
}

/** The badge for "the assessment said nothing about this". */
export const NO_ENGINE_ALERT: EngineAlert = {
  standing: "not_raised",
  severity: null,
  insightId: null,
  insightTitle: null,
  insightCount: 0,
};

/**
 * The most urgent insight in `categories`, as a badge.
 *
 * Ordering is `csfStandingUrgency(standingForSeverity(...))` then the judge's own
 * `rank` — the two exported primitives the scorecard's comparator is built from,
 * so the badge and the tile can never disagree about which finding is the
 * headline for the same insight set.
 *
 * Callers hand in insights they have already gated: an oversight caller must
 * pass privacy-gated rows, exactly as `buildCsfScorecard` requires, or a badge
 * becomes a one-argument bypass of the `share_*` toggles.
 */
export function deriveEngineAlert(
  insights: PlantInsight[],
  categories: readonly string[]
): EngineAlert {
  const matching = insights
    .filter((insight) => categories.includes(insight.category))
    .sort((a, b) => {
      const byUrgency =
        csfStandingUrgency(standingForSeverity(a.severity)) -
        csfStandingUrgency(standingForSeverity(b.severity));
      return byUrgency !== 0 ? byUrgency : a.rank - b.rank;
    });

  const lead = matching[0];
  if (!lead) return NO_ENGINE_ALERT;

  return {
    standing: standingForSeverity(lead.severity),
    severity: lead.severity,
    insightId: lead.id,
    insightTitle: lead.title,
    insightCount: matching.length,
  };
}

// ----------------------------------------------------------------------------
// The four trends.
// ----------------------------------------------------------------------------

export const TREND_METRIC_KEYS = [
  "core_group_growth",
  "meeting_attendance",
  "follow_up_completion",
  "team_readiness",
] as const;

export type TrendMetricKey = (typeof TREND_METRIC_KEYS)[number];

/** `count` renders as a whole number; `rate` is 0..1 and renders as a percent. */
export type TrendUnit = "count" | "rate";

interface TrendMetricDefinition {
  key: TrendMetricKey;
  label: string;
  /** One line on what the number is, shown under the value. */
  description: string;
  unit: TrendUnit;
  /**
   * Whether a rising number is the good direction. All four are — but a metric
   * where it is not (staleness, say) must not silently inherit the delta's
   * colouring, so the answer is stated per metric rather than assumed.
   */
  higherIsBetter: boolean;
  /** The snapshot fields `read` may touch. Reported to the UI as `factPaths`. */
  fields: readonly TrendSnapshotField[];
  /** Insight categories whose severity may badge this metric. */
  categories: readonly string[];
  /** The reading, or null when this snapshot cannot answer. */
  read(row: SnapshotHistoryRow): number | null;
  /** A sentence fragment spelling out the counts behind a ratio. */
  reading(row: SnapshotHistoryRow): string | null;
}

const TREND_METRIC_DEFINITIONS: readonly TrendMetricDefinition[] = [
  {
    key: "core_group_growth",
    label: "Core group",
    description: "People with a signed core-group commitment.",
    unit: "count",
    higherIsBetter: true,
    fields: ["coreGroupCommittedCount"],
    // CSF-3 is the critical-mass lens; the judge files core-group trajectory
    // findings there (rubric-v0 Part A).
    categories: ["critical_mass"],
    read: (row) => row.coreGroupCommittedCount,
    reading: () => null,
  },
  {
    key: "meeting_attendance",
    label: "Vision meeting attendance",
    description: "People at your most recent completed vision meeting.",
    unit: "count",
    higherIsBetter: true,
    fields: ["visionMeetingLatestAttendance"],
    categories: ["vision_casting"],
    read: (row) => row.visionMeetingLatestAttendance,
    reading: () => null,
  },
  {
    key: "follow_up_completion",
    label: "Follow-up completion",
    description: "Open follow-up contacts reached inside the follow-up window.",
    unit: "rate",
    higherIsBetter: true,
    fields: [
      "followUpOpenCount",
      "followUpStaleCount",
      "followUpStaleThresholdDays",
    ],
    categories: ["follow_up", "shared_ownership"],
    read: (row) => {
      const { followUpOpenCount: open, followUpStaleCount: stale } = row;
      if (open === null || stale === null) return null;
      // A rate with a zero denominator is UNKNOWN, never 100% — the same rule
      // the communication figures are held to (invariants.md → Communication).
      // "No open follow-ups" is not "every follow-up completed".
      if (open <= 0) return null;
      return (open - stale) / open;
    },
    reading: (row) => {
      const { followUpOpenCount: open, followUpStaleCount: stale } = row;
      if (open === null || stale === null || open <= 0) return null;
      const days = row.followUpStaleThresholdDays;
      const window = days === null ? "the follow-up window" : `${days} days`;
      return `${open - stale} of ${open} open contacts touched within ${window}`;
    },
  },
  {
    key: "team_readiness",
    label: "Ministry team readiness",
    description: "The eight ministry roles with a leader assigned.",
    unit: "rate",
    higherIsBetter: true,
    fields: ["ministryRolesFilledCount", "ministryRolesTotalRoles"],
    // CSF-7 — leaders rising from within to fill the eight roles.
    categories: ["emerging_leadership"],
    read: (row) => {
      const {
        ministryRolesFilledCount: filled,
        ministryRolesTotalRoles: total,
      } = row;
      if (filled === null || total === null || total <= 0) return null;
      return filled / total;
    },
    reading: (row) => {
      const {
        ministryRolesFilledCount: filled,
        ministryRolesTotalRoles: total,
      } = row;
      if (filled === null || total === null || total <= 0) return null;
      return `${filled} of ${total} roles have a leader`;
    },
  },
];

/** One dated reading on a trend. */
export interface TrendPoint {
  /** The assessment's `generatedAt` — the moment the reading was taken. */
  at: Date;
  value: number;
}

/** One trend: the latest reading, its series, and what the engine said about it. */
export interface TrendMetric {
  key: TrendMetricKey;
  label: string;
  description: string;
  unit: TrendUnit;
  higherIsBetter: boolean;
  /** The newest reading, or null when no snapshot in the window carries it. */
  value: number | null;
  /**
   * When `value` was taken. Null when nothing in the window answered the metric.
   *
   * NOT always `asOf`: `value` is the newest AVAILABLE reading, and a metric the
   * newest snapshot could not answer (`followUp.openCount` at zero makes the
   * follow-up rate unknown, not 100%) falls back to an earlier one. Carrying the
   * reading's own date is what keeps the card from showing that older number
   * under the header's single "As of <newest snapshot>".
   */
  valueAt: Date | null;
  /**
   * True when `valueAt` is older than the window's `asOf` — the latest
   * assessment did not record this metric and what is shown is an earlier
   * reading. The surface must SAY so; it must never silently pass a stale
   * reading off as current.
   */
  valueIsStale: boolean;
  /** The counts behind a ratio, spelled out. Null when there is nothing to add. */
  reading: string | null;
  /** Chronological readings, oldest first. Fewer than 2 = no trend to draw. */
  points: TrendPoint[];
  /** Newest minus oldest reading in the window; null with fewer than 2 points. */
  delta: number | null;
  direction: "up" | "down" | "flat" | null;
  /** When the comparison starts — the date `delta` is measured from. */
  since: Date | null;
  /** The snapshot paths every number above was read from. */
  factPaths: readonly string[];
  alert: EngineAlert;
}

/** The four trends plus the identity of the window they were read over. */
export interface PlantTrends {
  metrics: TrendMetric[];
  /** Complete assessments in the window. */
  snapshotCount: number;
  /** `generatedAt` of the newest snapshot in the window. */
  asOf: Date;
  /** `generatedAt` of the oldest snapshot in the window. */
  since: Date;
  /**
   * False when the plant has only ever completed one assessment. Nothing on the
   * card draws a line in that state — a value is still a fact, a trend is not.
   */
  hasHistory: boolean;
  /** Which audience's insights the alert badges were derived from. */
  audience: InsightAudience;
}

const DELTA_EPSILON = 1e-9;

function directionOf(delta: number): "up" | "down" | "flat" {
  if (delta > DELTA_EPSILON) return "up";
  if (delta < -DELTA_EPSILON) return "down";
  return "flat";
}

/**
 * Project persisted snapshots + persisted insights onto the four trends (PE-026).
 *
 * Pure — no DB, no LLM, no recomputation from feature tables. Returns null when
 * the plant has no complete assessment at all: four empty tiles would claim the
 * engine measured four things and found nothing, and it has measured nothing.
 *
 * @param history  snapshot rows in any order (sorted chronologically here, so a
 *                 caller passing newest-first cannot invert every delta)
 * @param latest   the latest complete assessment + insights, for the badges only
 * @param audience which audience's insights may badge a metric. A `"network"`
 *                 caller must hand in already privacy-gated insights.
 */
export function buildPlantTrends(
  history: SnapshotHistoryRow[],
  latest: LatestAssessment | null,
  audience: InsightAudience = "planter"
): PlantTrends | null {
  if (history.length === 0) return null;

  const ordered = [...history].sort(
    (a, b) => a.generatedAt.getTime() - b.generatedAt.getTime()
  );
  const newest = ordered[ordered.length - 1];
  const insights = (latest?.insights ?? []).filter(
    (insight) => insight.audience === audience
  );

  const metrics = TREND_METRIC_DEFINITIONS.map((definition) => {
    const points: TrendPoint[] = [];
    for (const row of ordered) {
      const value = definition.read(row);
      if (value !== null && Number.isFinite(value)) {
        points.push({ at: row.generatedAt, value });
      }
    }

    const last = points[points.length - 1] ?? null;
    // Two readings are the minimum a change can be claimed from. One reading is
    // a value; zero is silence. Neither gets a delta, a direction or a line.
    const comparable = points.length >= 2;
    const delta = comparable ? last!.value - points[0].value : null;

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      unit: definition.unit,
      higherIsBetter: definition.higherIsBetter,
      value: last?.value ?? null,
      valueAt: last?.at ?? null,
      // The newest snapshot could not answer this metric, so `value` is an
      // earlier reading. Stated here rather than left for the card to work out,
      // because the card carries ONE "as of" date and it is the window's.
      valueIsStale:
        last !== null && last.at.getTime() < newest.generatedAt.getTime(),
      reading: definition.reading(newest),
      points,
      delta,
      direction: delta === null ? null : directionOf(delta),
      since: comparable ? points[0].at : null,
      factPaths: definition.fields.map(trendSnapshotPath),
      alert: deriveEngineAlert(insights, definition.categories),
    } satisfies TrendMetric;
  });

  return {
    metrics,
    snapshotCount: ordered.length,
    asOf: newest.generatedAt,
    since: ordered[0].generatedAt,
    hasHistory: ordered.length >= 2,
    audience,
  };
}

/**
 * The PLANTER's trends for a church (PE-026).
 *
 * Takes the assessment the caller has ALREADY read rather than reading it again:
 * `/phase` loads `getLatestAssessment` once for the Focus panel, and the badges
 * here must come from that same row or the page could show two different
 * assessments' urgency side by side.
 */
export async function getPlantTrends(
  churchId: string,
  latest: LatestAssessment | null,
  audience: InsightAudience = "planter",
  limit: number = TREND_HISTORY_LIMIT
): Promise<PlantTrends | null> {
  const history = await getSnapshotTrendHistory(churchId, limit);
  return buildPlantTrends(history, latest, audience);
}

// ============================================================================
// PE-027 — the milestone timeline.
//
// Key dates, in order, from the four places the product actually dates things:
// the plant's own phase history, its first vision meeting, its completed launch
// readiness milestones, and Launch Sunday itself.
//
// The launch date is read from the LAUNCH ENTITY (`launches.target_date`) — it
// is not a column on `churches` and has not been one since migration 0032
// (invariants.md → Phase History). "No launch date yet" is a real state the
// timeline says out loud rather than hiding, because a planter with no date has
// nothing to count down to and needs to be told where to set one.
//
// Unlike the trends, this needs no assessment: every event is a dated row. A
// plant that has never been assessed still has a timeline, and only the badges
// go quiet.
// ============================================================================

export interface PhaseTransitionRow {
  id: string;
  kind: PhaseTransitionKind;
  fromPhase: number;
  toPhase: number;
  createdAt: Date;
}

/**
 * The plant's phase history, oldest first.
 *
 * BOTH kinds, deliberately: the timeline is the one surface where the initial
 * declaration belongs beside the moves, because "this is where the plant already
 * was when it arrived" is exactly a key date. The `kind` discriminator is carried
 * through so the builder can label a declaration as a starting point and never as
 * an advance (invariants.md → Phase History — a declaration is NOT an advance).
 */
export async function getPhaseTransitionRows(
  churchId: string
): Promise<PhaseTransitionRow[]> {
  return db
    .select({
      id: phaseTransitions.id,
      kind: phaseTransitions.kind,
      fromPhase: phaseTransitions.fromPhase,
      toPhase: phaseTransitions.toPhase,
      createdAt: phaseTransitions.createdAt,
    })
    .from(phaseTransitions)
    .where(eq(phaseTransitions.churchId, churchId))
    .orderBy(phaseTransitions.createdAt, phaseTransitions.id);
}

export interface CompletedMilestoneRow {
  id: string;
  title: string;
  area: LaunchMilestoneArea;
  completedAt: Date;
}

/**
 * Completed launch readiness milestones (LS-003), oldest completion first.
 *
 * COMPLETED ONLY. An unfinished milestone has no date, and a timeline is a
 * sequence of dates — the readiness list's own progress lives on `/launch`,
 * where the incomplete ones can be acted on rather than merely looked at.
 */
export async function getCompletedLaunchMilestones(
  churchId: string
): Promise<CompletedMilestoneRow[]> {
  const rows = await db
    .select({
      id: launchMilestones.id,
      title: launchMilestones.title,
      area: launchMilestones.area,
      completedAt: launchMilestones.completedAt,
    })
    .from(launchMilestones)
    .where(
      and(
        eq(launchMilestones.churchId, churchId),
        isNotNull(launchMilestones.completedAt)
      )
    )
    .orderBy(launchMilestones.completedAt, launchMilestones.id);

  // `isNotNull` already guarantees this; the narrowing is for the type system.
  return rows.flatMap((row) =>
    row.completedAt ? [{ ...row, completedAt: row.completedAt }] : []
  );
}

export const MILESTONE_KINDS = [
  "phase_declared",
  "phase_change",
  "first_vision_meeting",
  "launch_readiness",
  "launch_day",
  "launch_recorded",
] as const;

export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

/** One dated event on the timeline. */
export interface MilestoneEvent {
  /** Stable key — the source row's id, or a fixed name for the singletons. */
  id: string;
  kind: MilestoneKind;
  /** The day the event sits on. Date-only facts are pinned to UTC midnight. */
  at: Date;
  label: string;
  detail: string | null;
  /**
   * `upcoming` is only ever a launch day still ahead of `asOf`. Everything else
   * is a row that records something that already happened.
   */
  state: "past" | "upcoming";
  alert: EngineAlert;
}

export interface MilestoneTimeline {
  /** Chronological, oldest first. */
  events: MilestoneEvent[];
  asOf: Date;
  /** yyyy-mm-dd, or null when no day has been named yet. */
  launchDate: string | null;
  /** Null when the plant has no launch row at all — a different fact from no day. */
  launchStatus: LaunchStatus | null;
  /** Whole days to launch, via the one countdown implementation. */
  daysUntilLaunch: number | null;
  audience: InsightAudience;
}

/** The methodology's own name for a phase, or a plain fallback. */
function phaseName(phase: number): string {
  return PHASES[phase as PhaseNumber] ?? `Phase ${phase}`;
}

const MILESTONE_AREA_LABELS: Record<LaunchMilestoneArea, string> = {
  operations: "Operations",
  launch_team: "Launch team",
  promotion: "Promotion",
};

/** Ties break by kind, so two events on one day always render in one order. */
const MILESTONE_KIND_ORDER: Record<MilestoneKind, number> = Object.fromEntries(
  MILESTONE_KINDS.map((kind, index) => [kind, index])
) as Record<MilestoneKind, number>;

export interface MilestoneTimelineInputs {
  asOf: Date;
  launch: LaunchRow | null;
  transitions: PhaseTransitionRow[];
  milestones: CompletedMilestoneRow[];
  /** Completed vision meetings, newest first (as `getCompletedVisionMeetings` returns). */
  visionMeetings: VisionMeetingRow[];
  latest: LatestAssessment | null;
  audience?: InsightAudience;
}

/**
 * Project dated rows onto the timeline (PE-027). Pure; never throws on a sparse
 * plant — a plant with nothing dated yields an empty `events` list, which the
 * component renders as an empty state rather than as a plant with no history.
 */
export function buildMilestoneTimeline({
  asOf,
  launch,
  transitions,
  milestones,
  visionMeetings,
  latest,
  audience = "planter",
}: MilestoneTimelineInputs): MilestoneTimeline {
  const insights = (latest?.insights ?? []).filter(
    (insight) => insight.audience === audience
  );
  const phaseAlert = deriveEngineAlert(insights, ["phase_progress"]);
  const launchAlert = deriveEngineAlert(insights, ["launch_readiness"]);

  const events: MilestoneEvent[] = [];

  for (const transition of transitions) {
    const declaration = transition.kind === "initial_declaration";
    events.push({
      id: transition.id,
      kind: declaration ? "phase_declared" : "phase_change",
      at: transition.createdAt,
      // A declaration is where the plant already stood, never a move it made.
      label: declaration
        ? `Started in ${phaseName(transition.toPhase)}`
        : `Moved to ${phaseName(transition.toPhase)}`,
      detail: declaration
        ? "Where the plant stood when it joined EveryField."
        : `From ${phaseName(transition.fromPhase)}.`,
      state: "past",
      alert: declaration ? NO_ENGINE_ALERT : phaseAlert,
    });
  }

  // Oldest completed vision meeting — the moment the plant started casting
  // vision publicly. Only the first: every meeting since is the attendance
  // trend's business, not the timeline's.
  const firstMeeting = visionMeetings[visionMeetings.length - 1];
  if (firstMeeting) {
    events.push({
      id: firstMeeting.id,
      kind: "first_vision_meeting",
      at: firstMeeting.datetime,
      label: "First vision meeting",
      detail:
        firstMeeting.actualAttendance === null
          ? null
          : `${firstMeeting.actualAttendance} attended.`,
      state: "past",
      alert: NO_ENGINE_ALERT,
    });
  }

  for (const milestone of milestones) {
    events.push({
      id: milestone.id,
      kind: "launch_readiness",
      at: milestone.completedAt,
      label: milestone.title,
      detail: `${MILESTONE_AREA_LABELS[milestone.area]} readiness milestone.`,
      state: "past",
      alert: launchAlert,
    });
  }

  const daysUntilLaunch = daysUntilTarget(launch?.targetDate ?? null, asOf);

  if (launch?.targetDate) {
    events.push({
      id: "launch-day",
      kind: "launch_day",
      at: parseTargetDate(launch.targetDate),
      label: "Launch Sunday",
      detail:
        launch.status === "postponed"
          ? "Postponed to this day."
          : launch.status === "completed"
            ? "The day the plant launched."
            : null,
      // Day-vs-day, via the one countdown implementation. Launch day itself
      // (0) is not yet behind the plant.
      state:
        daysUntilLaunch !== null && daysUntilLaunch < 0 ? "past" : "upcoming",
      alert: launchAlert,
    });
  }

  if (launch?.outcomeRecordedAt) {
    events.push({
      id: "launch-recorded",
      kind: "launch_recorded",
      at: launch.outcomeRecordedAt,
      label: "Launch recorded",
      detail:
        launch.attendanceCount === null
          ? "The day is written down."
          : `${launch.attendanceCount} attended.`,
      state: "past",
      alert: NO_ENGINE_ALERT,
    });
  }

  events.sort((a, b) => {
    const byTime = a.at.getTime() - b.at.getTime();
    if (byTime !== 0) return byTime;
    const byKind = MILESTONE_KIND_ORDER[a.kind] - MILESTONE_KIND_ORDER[b.kind];
    return byKind !== 0 ? byKind : a.id.localeCompare(b.id);
  });

  return {
    events,
    asOf,
    launchDate: launch?.targetDate ?? null,
    launchStatus: launch?.status ?? null,
    daysUntilLaunch,
    audience,
  };
}

/**
 * The PLANTER's milestone timeline for a church (PE-027).
 *
 * Takes the already-read assessment for the same reason `getPlantTrends` does:
 * one assessment read per page, and the badges on the timeline are the badges on
 * the trends.
 */
export async function getMilestoneTimeline(
  churchId: string,
  latest: LatestAssessment | null,
  audience: InsightAudience = "planter",
  asOf: Date = new Date()
): Promise<MilestoneTimeline> {
  const [launch, transitions, milestones, visionMeetings] = await Promise.all([
    getLaunch(churchId),
    getPhaseTransitionRows(churchId),
    getCompletedLaunchMilestones(churchId),
    getCompletedVisionMeetings(churchId),
  ]);

  return buildMilestoneTimeline({
    asOf,
    launch,
    transitions,
    milestones,
    visionMeetings,
    latest,
    audience,
  });
}
