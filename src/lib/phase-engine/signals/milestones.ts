// ============================================================================
// Phase Engine — PE-027, the milestone timeline.
//
// Split out of `queries.ts` (#319, round 4) along that file's own section
// banner, beside `trends.ts`. The primitives stay in `queries.ts`; this module
// is the timeline projection and nothing else.
//
// It depends on `trends.ts` for ONE thing — `EngineAlert`, the judge's persisted
// severity relabelled. There is exactly one alert vocabulary on `/phase`, so the
// timeline borrows PE-026's rather than declaring a second one that could drift.
// ============================================================================

import { db } from "@/db";
import {
  launchMilestones,
  phaseTransitions,
  type InsightAudience,
  type PhaseTransitionKind,
} from "@/db/schema";
import type { LaunchMilestoneArea, LaunchStatus } from "@/db/schema/launch";
import { PHASES, type PhaseNumber } from "@/lib/constants";
// The one launch-countdown implementation (invariants.md → Hierarchical Access
// Control, the day-vs-instant rule). The timeline needs to know whether the
// launch day is behind or ahead of `asOf`; it asks THIS, and never subtracts
// two dates itself.
import { daysUntilTarget, parseTargetDate } from "@/lib/launch/countdown";
import type { LatestAssessment } from "../assessment/queries";
import {
  getCompletedVisionMeetings,
  getLaunch,
  type LaunchRow,
  type VisionMeetingRow,
} from "./queries";
import { deriveEngineAlert, NO_ENGINE_ALERT, type EngineAlert } from "./trends";
import { and, eq, isNotNull } from "drizzle-orm";

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
