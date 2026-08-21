/**
 * Phase Engine — Eval Seed Script
 *
 * Builds an EXTENSIVE, deterministic eval corpus for the EveryField "Plant
 * Intelligence" Phase Engine: 12 church plants spanning every lifecycle phase
 * (0–6) with healthy / stalled / critical / edge-case variants. The data is
 * designed to populate exactly the inputs the deterministic Signal layer reads
 * (src/lib/phase-engine/signals), so the rubric and evals can be stress-tested
 * against a rich, reproducible spectrum.
 *
 * Hard guarantees:
 *   - Determinism: every relative date derives from a single fixed `NOW`
 *     constant. No Math.random — any variation is index-derived. Same run →
 *     identical DB state.
 *   - Namespacing: ALL eval data lives under one network ("EVAL — Phase
 *     Engine") and every eval row is reachable from an eval church, whose ids
 *     are collected for scoped cleanup. Identifiers are prefixed `EVAL-`.
 *   - Idempotent: `--clean` removes only eval-namespaced rows (child-first to
 *     respect FKs). A default run cleans-then-reseeds, so re-running never
 *     duplicates.
 *   - Verification: after seeding, buildFactSnapshot() runs for every church at
 *     the fixed `NOW`, and a summary table is printed so the intended profile
 *     can be confirmed against what the Signal layer actually computes.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-phase-engine-eval.ts            # clean + reseed
 *   pnpm exec tsx scripts/seed-phase-engine-eval.ts --clean    # clean only
 *   pnpm exec tsx scripts/seed-phase-engine-eval.ts --privacy-only
 *                       # apply oversight sharing postures to an EXISTING
 *                       # corpus without touching anything else. Use this when
 *                       # assessments have already been generated: a default
 *                       # run cleans first and would discard them.
 */

import { neon, neonConfig } from "@neondatabase/serverless";
import { config } from "dotenv";
// `sql` is aliased: the neon client below already owns that name here, and
// drizzle's tagged template is a different thing entirely.
import { and, eq, inArray, sql as rawSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import {
  assessments,
  associationEvents,
  churches,
  churchMeetings,
  churchPrivacySettings,
  generatedDocuments,
  commitments,
  insightFeedback,
  interviews,
  launches,
  meetingAttendance,
  ministryTeams,
  organizationInvitations,
  persons,
  phaseTransitions,
  planterCheckins,
  plantAssessments,
  plantInsights,
  plantSignals,
  sendingChurches,
  sendingNetworks,
  tasks,
  teamMemberships,
  teamRoles,
  trainingCompletions,
  trainingPrograms,
  users,
  type InterviewResult,
  type PersonSource,
  type PlanterCheckinLevel,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
// THE ATTESTATION VOCABULARY, BOUND AT COMPILE TIME (#474, `manual-signals.ts`).
//
// Import-free by design, so naming it here cannot drag `@/db` in front of the
// `config()` call below. It is imported for the TYPE, and that type is what
// retires the bug this seeder shipped with: every profile wrote
// `financial_base`, a key NO reader matches (the gate and the citation both
// read `financial_base_established`), so Generosity read `unknown` across the
// whole corpus while the rows sat in `plant_signals` looking correct. A
// `Partial<Record<ManualSignalKey, …>>` makes the misspelling a type error
// instead of a silent hole in the eval.
import type { ManualSignalKey } from "../src/lib/phase-engine/manual-signals";

// ============================================================================
// Bootstrapping
//
// Load DATABASE_URL BEFORE anything that evaluates `@/db` (the app DB module
// reads process.env at import time). The Signal layer (`buildFactSnapshot`),
// which transitively imports `@/db`, is therefore loaded via a dynamic import
// in `verify()`, after this config() call has run.
// ============================================================================

config({ path: ".env.local" });

const cleanOnly = process.argv.includes("--clean");
/**
 * Apply ONLY the oversight sharing postures to churches that are already
 * seeded, leaving every other row untouched. A default run cleans-then-reseeds,
 * which would discard any generated `plant_assessments` (real LLM spend), so
 * this flag exists to opt an existing corpus into oversight sharing in place.
 */
const privacyOnly = process.argv.includes("--privacy-only");
/**
 * Re-run the v1 signal assertions against the corpus already in the database,
 * touching nothing. Separate from a full run because a default run CLEANS
 * first, which would discard any assessments generated against the corpus —
 * and re-checking after an assessment pass is exactly when you want this.
 */
const verifyOnly = process.argv.includes("--verify-v1");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

// This script builds its own client instead of importing `@/db` (see the
// bootstrapping note above), and neon-http cannot speak to a plain Postgres over
// TCP. To seed a LOCAL database, run this with `NEON_HTTP_PROXY_URL` naming the
// `local-neon-http-proxy` in front of it (`http://localhost:4444/sql`) — the
// same move `pnpm test:live` makes through `scripts/live-db-endpoint.ts`.
// Deliberate and explicit: the caller knows which database this is, so nothing
// here guesses from the hostname. Unset is correct for a real Neon instance.
if (process.env.NEON_HTTP_PROXY_URL) {
  neonConfig.fetchEndpoint = process.env.NEON_HTTP_PROXY_URL;
}

const sql = neon(connectionString);
const db = drizzle(sql);

// ----------------------------------------------------------------------------
// Eval namespace markers (used for scoped cleanup)
// ----------------------------------------------------------------------------

const EVAL_NETWORK_NAME = "EVAL — Phase Engine";
const EVAL_SENDING_CHURCH_NAME = "EVAL — Sending Church";
/**
 * Domain every eval account is CREATED on. `everyfield.app` is the product
 * domain (ruled 2026-07-31), replacing the retired placeholder.
 */
const EVAL_EMAIL_DOMAIN = "eval.phase-engine.everyfield.app";
/**
 * ...and the marker cleanup MATCHES on, which is deliberately the subdomain and
 * not the full domain. An eval address is `<who>@eval.phase-engine.<domain>`,
 * so matching the subdomain alone identifies every eval account this script has
 * ever created — including ones seeded before the domain retirement. Match on
 * `EVAL_EMAIL_DOMAIN` instead and a database seeded on the old domain keeps its
 * eval network admin forever: that user has no `church_id`, so the church-scoped
 * sweep below cannot see it either, and the `sending_networks` delete then fails
 * on `users_sending_network_id_sending_networks_id_fk`.
 */
const EVAL_EMAIL_MARKER = "@eval.phase-engine.";
const EVAL_PASSWORD = "eval-password-123";

// ----------------------------------------------------------------------------
// Fixed reference clock — the single source of truth for ALL relative dates.
// `buildFactSnapshot` is later called with `asOf: NOW` so the printed signals
// line up exactly with how the seed was constructed.
// ----------------------------------------------------------------------------

const NOW = new Date("2026-06-22T12:00:00.000Z");
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** A timestamp `days` before NOW (negative `days` → future). */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

/** A `date`-column value (yyyy-mm-dd, UTC) `days` before NOW. */
function dateOnlyAgo(days: number): string {
  return daysAgo(days).toISOString().slice(0, 10);
}

/** A launch `date` value `days` after NOW (negative → already launched). */
function launchInDays(days: number): string {
  return new Date(NOW.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The `onboarding_completed_at` stamp every eval church carries (#326, F12 /
 * OB-001).
 *
 * A null stamp means the onboarding flow owns the planter's dashboard
 * (`shouldShowOnboarding`, `src/lib/onboarding/steps.ts`). An eval planter who
 * lands in the wizard is looking at a DIFFERENT SCREEN from the one this corpus
 * was built to grade, and nothing about that is loud — the eval simply starts
 * scoring a different product. Every profile here is a plant with history, so
 * "onboarding is finished" is what the corpus has always meant.
 *
 * Not `daysAgo(...)`, and deliberately not derived from NOW: `now()` is
 * evaluated inside the same INSERT that fills `created_at` from `DEFAULT now()`,
 * so the stamp is exactly the row's creation moment. It is also not a Signal
 * layer input — nothing in `src/lib/phase-engine/signals` reads this column — so
 * a wall-clock value cannot move the corpus's deterministic facts.
 */
function onboardingCompletedAtSeedStamp() {
  return rawSql`now()`;
}

// ============================================================================
// Eval matrix — declarative church profiles
//
// Each profile is a pure description of the spectrum point we want. The seeder
// translates it into rows whose Signal-layer readout matches `intended`.
// ============================================================================

/** The 8 canonical ministry roles, with a name the Signal-layer matcher will
 *  bucket into the intended key (substring match, canonical order). */
const ROLE_TEAM_NAMES: { key: string; teamName: string }[] = [
  { key: "worship", teamName: "Worship Team" },
  { key: "childrens", teamName: "Children's Ministry" },
  { key: "assimilation", teamName: "Assimilation & Welcome" },
  { key: "small_groups", teamName: "Small Groups" },
  { key: "admin_finance", teamName: "Admin & Finance" },
  { key: "facilities", teamName: "Facilities & Setup" },
  { key: "promotion", teamName: "Promotion & Outreach" },
  { key: "technology", teamName: "Technology & AV" },
];

// ----------------------------------------------------------------------------
// The v1 lens vocabulary — one declarative shape per signal rubric v1 added.
//
// EVERY NEW LENS IS DATA, NOT A BRANCH. The seeding functions below read these
// shapes and write rows; the verifier (`scripts/verify-eval-v1-signals.ts`)
// reads the SAME shapes through the `expected*` derivations at the bottom of
// this section and asserts the Signal layer computed them. That is the whole
// design: a matrix with two spellings is a matrix that can lie, and the
// `financial_base` bug is what that looks like in practice.
// ----------------------------------------------------------------------------

/**
 * One manual attestation: the planter's answer AND how old it is (#474 D2).
 *
 * The age is per-signal per-church rather than a uniform stamp because the
 * 30-day reaffirm window is the whole point of the prayer lens — an answer
 * given six weeks ago is a different fact from the same answer given on Monday,
 * and a corpus that stamps them all at 10 days can never exercise the
 * difference.
 */
interface AttestationSpec {
  value: boolean;
  attestedDaysAgo: number;
}

/** `count` committed people recorded with this source. `null` = nobody said. */
interface SourceSlice {
  source: PersonSource | null;
  count: number;
}

/**
 * How the open follow-up TASKS are held (#470).
 *
 * `null` means ownership is NOT MEASURED in this plant — no follow-up task
 * exists at all — which is a different instruction to the judge from "nobody
 * owns them": it may name no cause.
 */
interface FollowUpOwnershipSpec {
  /** Open follow-up tasks. Each names one contact, taken from the front. */
  taskCount: number;
  /** …of which this many are held by the planter's own account. */
  planterOwnedTaskCount: number;
  /** Distinct member accounts sharing the rest, round-robin. */
  memberOwnerCount: number;
  /**
   * The LAST member owner is demoted out of the committed set, so every task
   * they hold reads as unowned. `isOwned` resolves the owner's CURRENT status,
   * and this is the only way to exercise that.
   */
  demoteOneOwner: boolean;
}

/** `count` follow-up contacts, this warm, untouched for this many days. */
interface FollowUpSlice {
  /** Attended a vision meeting inside the warm window (the newest, 7d ago). */
  warm: boolean;
  /** Whole days since `persons.updated_at` — what staleness is measured from. */
  idleDays: number;
  count: number;
}

/** Who has gone quiet (#486, C22). */
interface DisengagementSpec {
  /**
   * Committed people who attended in the 28–56d band and nothing since. They
   * are taken from the TAIL of the committed list, and the vision-meeting
   * attendee count is capped so the tail never turns up at a recent meeting.
   */
  disengagedCount: number;
  /** One of them leads a ministry team → `disengagedIncludesLeader`. */
  includesLeader: boolean;
}

/** One recorded 5-criteria interview (#476). */
interface InterviewSpec {
  result: InterviewResult;
  daysAgo: number;
}

/** One recorded 4 C's assessment: committed, compelled, contagious, courageous. */
interface FourCsSpec {
  /** Each 1–5 (`assessmentCreateSchema`); `total_score` is their sum. */
  scores: [number, number, number, number];
  daysAgo: number;
}

/**
 * One weekly planter check-in (#484, C19).
 *
 * SEEDED ONLY TO PROVE A NEGATIVE. Nothing in the engine reads
 * `planter_checkins` and nothing may: the verifier asserts these rows exist AND
 * that no trace of them reaches the fact snapshot (rubric §5c). A fixture that
 * only ever asserts presence cannot prove an absence.
 */
interface CheckinSpec {
  weeksAgo: number;
  spiritually: PlanterCheckinLevel;
  marriageFamily: PlanterCheckinLevel;
  financially: PlanterCheckinLevel;
  pace: PlanterCheckinLevel;
}

interface ChurchProfile {
  /** Stable key used in identifiers / emails. */
  key: string;
  name: string;
  currentPhase: number;
  /** Launch date offset from NOW in days; null = unset (no countdown). */
  launchOffsetDays: number | null;
  /** lastMaterialEventAt offset (days ago); null = never (very quiet). */
  lastMaterialEventDaysAgo: number | null;

  // ---- core group ----
  /** Distinct people with a core_group commitment. */
  coreGroupCount: number;
  /** Distinct people with a launch_team commitment (subset overlap allowed). */
  launchTeamCount: number;
  /**
   * Desired net growth delta over the trailing 28d window vs the prior 28d
   * window. The seeder lands `max(delta,0)+base` first-commitments in-window
   * and `base` in the prior window to realize the signed delta.
   */
  growthDelta: number;
  /**
   * THE STALL CLOCK (#471): whole days since the newest FIRST core-group
   * commitment. `null` only when nobody has committed.
   *
   * IT CONSTRAINS `growthDelta`, and the seeder asserts the pair is coherent.
   * A value of 28 or more puts the newest first-commitment inside the PRIOR
   * window, which empties the trailing one by construction — so the delta is
   * exactly minus the prior count and cannot be zero or positive. The three
   * stalled profiles carry a negative delta for that reason, not by taste.
   */
  daysSinceLastCommitment: number | null;
  /**
   * WHERE THE COMMITTED CAME FROM (#487, C26). Counts MUST sum to
   * `coreGroupCount` — asserted at seed time, because a mix that does not is a
   * `sourceComposition` nobody can predict and therefore nobody can verify.
   */
  sourceMix: SourceSlice[];

  // ---- vision meetings ----
  /**
   * Completed-meeting attendance series, OLDEST → NEWEST. The Signal layer
   * reads the last two (newest vs previous) for the trend, and gaps for
   * cadence. Empty = no completed vision meetings.
   */
  attendanceSeries: number[];
  /** Gap in days between consecutive meetings (cadence). */
  meetingCadenceDays: number;

  // ---- follow-up contacts ----
  followUpCount: number;
  /**
   * The follow-up cohort split by WARMTH and idle age (#486, C22). Counts MUST
   * sum to `followUpCount`.
   *
   * This replaced a single `followUpsStale` boolean, which could only ever
   * produce one of two fleet-wide shapes and left `warmCount` at zero
   * everywhere: warmth is attendance at a recent vision meeting, and the old
   * seeder attached attendance to committed people only.
   */
  followUpMix: FollowUpSlice[];
  /** Who holds the open follow-up tasks (#470). `null` = not measured at all. */
  followUpOwnership: FollowUpOwnershipSpec | null;

  // ---- ministry roles ----
  /** How many of the 8 canonical roles should read as "filled" (leader set). */
  rolesFilled: number;
  /**
   * Extra teams with NO leader (present but unfilled). Used by post-launch
   * "vacated leader" cases — but the simplest lever is rolesFilled.
   */
  rolesPresentUnfilled: number;

  // ---- training ----
  /** Approx required-completion rate (0..1). Seeder picks completions to hit. */
  trainingRate: number | null;

  // ---- leadership candidates ----
  /** Number of "strong" leadership candidates (long tenure, leads a team). */
  strongLeaders: number;

  // ---- cohesion ----
  disengagement: DisengagementSpec;

  // ---- recorded human judgments (#476) ----
  /** One per person, applied to the head of the committed list. */
  interviews: InterviewSpec[];
  /** Ditto — a person may hold both, and several profiles do. */
  fourCs: FourCsSpec[];

  // ---- manual attestations ----
  /** Keyed by the ONE vocabulary, so a misspelled key cannot compile. */
  signals: Partial<Record<ManualSignalKey, AttestationSpec>>;

  // ---- planter check-ins (#484) — seeded to be PROVEN ABSENT downstream ----
  checkins: CheckinSpec[];

  /** Human note explaining the spectrum point (for the summary). */
  note: string;
}

/**
 * The profile's `sourceMix` flattened to one entry per committed person, in
 * insert order. `null` entries are people nobody recorded a source for.
 */
function expandSourceMix(profile: ChurchProfile): (PersonSource | null)[] {
  return profile.sourceMix.flatMap((slice) =>
    Array.from({ length: slice.count }, () => slice.source)
  );
}

/** The Monday (UTC) of the week `weeksAgo` before NOW — the check-in's key. */
function mondayOfWeeksAgo(weeksAgo: number): string {
  const d = new Date(NOW.getTime() - weeksAgo * 7 * MS_PER_DAY);
  // getUTCDay(): 0 = Sunday, so Monday is 1 and Sunday walks back 6 days.
  const shift = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - shift * MS_PER_DAY);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}

/**
 * Refuse a profile whose parts cannot all be true at once.
 *
 * Every check here is a fixture that would otherwise seed cleanly and then
 * assert something the Signal layer never computed — the failure mode this
 * whole pass exists to close, and the one `financial_base` shipped in.
 */
function assertProfileCoherence(profile: ChurchProfile): void {
  const fail = (why: string) => {
    throw new Error(`Profile "${profile.key}": ${why}`);
  };

  const sourceTotal = profile.sourceMix.reduce((n, s) => n + s.count, 0);
  if (sourceTotal !== profile.coreGroupCount) {
    fail(
      `sourceMix sums to ${sourceTotal} but coreGroupCount is ${profile.coreGroupCount} — sourceComposition would be unpredictable.`
    );
  }

  const followUpTotal = profile.followUpMix.reduce((n, s) => n + s.count, 0);
  if (followUpTotal !== profile.followUpCount) {
    fail(
      `followUpMix sums to ${followUpTotal} but followUpCount is ${profile.followUpCount}.`
    );
  }

  // The stall clock is the age of the newest FIRST commitment, so it and the
  // sign of the delta are one fact seen twice.
  const stall = profile.daysSinceLastCommitment;
  if (stall === null) {
    if (profile.coreGroupCount > 0) {
      fail(
        "daysSinceLastCommitment is null but the plant has committed people."
      );
    }
  } else {
    const priorBase = Math.max(2, -profile.growthDelta);
    const inWindow = priorBase + profile.growthDelta;
    if (stall >= 28 && inWindow !== 0) {
      fail(
        `daysSinceLastCommitment ${stall} puts the newest commitment outside the trailing window, so growthDelta must be −${priorBase}, not ${profile.growthDelta}.`
      );
    }
    if (stall < 28 && inWindow === 0) {
      fail(
        `daysSinceLastCommitment ${stall} needs a trailing-window commitment, but growthDelta ${profile.growthDelta} empties that window.`
      );
    }
    if (stall >= 56) {
      fail(
        `daysSinceLastCommitment ${stall} falls outside the 56-day horizon.`
      );
    }
  }

  if (profile.disengagement.disengagedCount > profile.coreGroupCount) {
    fail("more disengaged people than committed people.");
  }
  if (
    profile.disengagement.includesLeader &&
    profile.disengagement.disengagedCount === 0
  ) {
    fail("includesLeader is true but nobody is disengaged.");
  }

  const ownership = profile.followUpOwnership;
  if (ownership) {
    if (ownership.planterOwnedTaskCount > ownership.taskCount) {
      fail("more planter-owned tasks than tasks.");
    }
    if (ownership.demoteOneOwner && ownership.memberOwnerCount === 0) {
      fail("demoteOneOwner is true but there are no member owners to demote.");
    }
    if (profile.followUpCount === 0) {
      fail("follow-up ownership specified with no follow-up contacts.");
    }
  }
}

const PROFILES: ChurchProfile[] = [
  // ----- Phase 0 — Discovery -----
  {
    key: "genesis",
    name: "EVAL-01 Genesis (cold-start)",
    currentPhase: 0,
    launchOffsetDays: null,
    lastMaterialEventDaysAgo: null,
    coreGroupCount: 0,
    launchTeamCount: 0,
    growthDelta: 0,
    daysSinceLastCommitment: null,
    sourceMix: [],
    attendanceSeries: [],
    meetingCadenceDays: 0,
    followUpCount: 0,
    followUpMix: [],
    followUpOwnership: null,
    rolesFilled: 0,
    rolesPresentUnfilled: 0,
    trainingRate: null,
    strongLeaders: 0,
    disengagement: { disengagedCount: 0, includesLeader: false },
    interviews: [],
    fourCs: [],
    signals: {},
    checkins: [],
    note: "PE-018 cold-start: only the planter exists, no activity anywhere. The fleet's UNKNOWN pole for every v1 lens at once.",
  },

  // ----- Phase 1 — Core Group Development -----
  {
    key: "cornerstone",
    name: "EVAL-02 Cornerstone (healthy early)",
    currentPhase: 1,
    launchOffsetDays: 300,
    lastMaterialEventDaysAgo: 1,
    coreGroupCount: 14,
    launchTeamCount: 0,
    growthDelta: 5,
    daysSinceLastCommitment: 6,
    sourceMix: [
      { source: "vision_meeting", count: 5 },
      { source: "personal_referral", count: 3 },
      { source: "social_media", count: 2 },
      { source: "website", count: 1 },
      { source: "event", count: 1 },
      { source: null, count: 2 },
    ],
    attendanceSeries: [8, 12, 15, 18],
    meetingCadenceDays: 21,
    followUpCount: 12,
    followUpMix: [
      { warm: true, idleDays: 2, count: 6 },
      { warm: false, idleDays: 4, count: 6 },
    ],
    followUpOwnership: {
      taskCount: 9,
      planterOwnedTaskCount: 2,
      memberOwnerCount: 3,
      demoteOneOwner: false,
    },
    rolesFilled: 1,
    rolesPresentUnfilled: 0,
    trainingRate: 0.15,
    strongLeaders: 1,
    disengagement: { disengagedCount: 0, includesLeader: false },
    interviews: [{ result: "qualified", daysAgo: 30 }],
    fourCs: [],
    signals: {
      values_documented: { value: true, attestedDaysAgo: 12 },
      prayer_rhythm_established: { value: true, attestedDaysAgo: 5 },
      prayer_in_gatherings: { value: true, attestedDaysAgo: 5 },
      // Giving answered, solvency NOT — the split's first direction.
      core_group_giving: { value: true, attestedDaysAgo: 5 },
    },
    checkins: [
      {
        weeksAgo: 1,
        spiritually: "steady",
        marriageFamily: "steady",
        financially: "steady",
        pace: "strained",
      },
    ],
    note: "Healthy early growth. Ownership spread across 3 members, prayer fresh, giving attested while solvency is unanswered.",
  },
  {
    key: "wanderer",
    name: "EVAL-03 Wanderer (stalled early)",
    currentPhase: 1,
    launchOffsetDays: 500,
    lastMaterialEventDaysAgo: 45,
    coreGroupCount: 7,
    launchTeamCount: 0,
    // STALLED: the newest first-commitment sits in the PRIOR window, so the
    // trailing window is empty by construction and the delta is exactly
    // −PRIOR_BASE. See `daysSinceLastCommitment` on ChurchProfile.
    growthDelta: -2,
    daysSinceLastCommitment: 31,
    sourceMix: [
      { source: "vision_meeting", count: 2 },
      { source: null, count: 5 },
    ],
    attendanceSeries: [20, 11],
    meetingCadenceDays: 30,
    followUpCount: 8,
    followUpMix: [
      // Warm AND stale — attended a vision meeting inside the 14d window, then
      // nobody touched the record for 9 days. The case the warmth split exists
      // for, and the one a universal 14-day rule was a week late on.
      { warm: true, idleDays: 9, count: 3 },
      { warm: true, idleDays: 16, count: 2 },
      { warm: false, idleDays: 30, count: 3 },
    ],
    followUpOwnership: null,
    rolesFilled: 0,
    rolesPresentUnfilled: 0,
    trainingRate: null,
    strongLeaders: 0,
    disengagement: { disengagedCount: 3, includesLeader: true },
    interviews: [],
    fourCs: [],
    signals: {
      // Answered once, six weeks ago. Stale is cited with its age, never
      // silently read as current and never as false.
      prayer_rhythm_established: { value: true, attestedDaysAgo: 45 },
    },
    checkins: [],
    note: "Watch case: growth STALLED at 31d, attendance crash, ownership NOT MEASURED, warm follow-ups going cold, cluster disengagement including a team leader, prayer attestation stale.",
  },

  // ----- Phase 2 — Launch Team Formation -----
  {
    key: "beacon",
    name: "EVAL-04 Beacon (on-track)",
    currentPhase: 2,
    launchOffsetDays: 150,
    lastMaterialEventDaysAgo: 2,
    coreGroupCount: 28,
    launchTeamCount: 6,
    growthDelta: 3,
    daysSinceLastCommitment: 9,
    sourceMix: [
      { source: "vision_meeting", count: 11 },
      { source: "personal_referral", count: 8 },
      { source: "event", count: 5 },
      { source: "website", count: 3 },
      { source: null, count: 1 },
    ],
    attendanceSeries: [34, 35, 35, 36],
    meetingCadenceDays: 21,
    followUpCount: 10,
    followUpMix: [
      { warm: false, idleDays: 20, count: 4 },
      { warm: false, idleDays: 3, count: 6 },
    ],
    followUpOwnership: {
      // Planter-heavy: the measured version of the line v0 used to GUESS.
      taskCount: 9,
      planterOwnedTaskCount: 6,
      memberOwnerCount: 2,
      demoteOneOwner: false,
    },
    rolesFilled: 5,
    rolesPresentUnfilled: 0,
    trainingRate: 0.4,
    strongLeaders: 4,
    // Below the minimum of 3 — present, and deliberately NOT nameable.
    disengagement: { disengagedCount: 1, includesLeader: false },
    interviews: [
      { result: "qualified", daysAgo: 45 },
      { result: "qualified_with_notes", daysAgo: 20 },
    ],
    fourCs: [{ scores: [4, 4, 3, 4], daysAgo: 25 }],
    signals: {
      values_documented: { value: true, attestedDaysAgo: 15 },
      prayer_rhythm_established: { value: true, attestedDaysAgo: 8 },
      prayer_in_gatherings: { value: true, attestedDaysAgo: 8 },
      // Solvent, with the giving question unanswered — the split's OTHER
      // direction from Cornerstone, and neither may be read from the other.
      financial_base_established: { value: true, attestedDaysAgo: 14 },
    },
    checkins: [],
    note: "On-track. Planter carries 6 of 9 follow-ups (MEASURED, not inferred); disengagement present but below the 3-person floor; solvent with giving unanswered.",
  },
  {
    key: "drift",
    name: "EVAL-05 Drift (mixed)",
    currentPhase: 2,
    launchOffsetDays: 180,
    lastMaterialEventDaysAgo: 18,
    coreGroupCount: 22,
    launchTeamCount: 3,
    growthDelta: 0,
    // SLOWED but not stalled — the 21–27 band the two-level rule exists to
    // separate, and the one v0 would have called "stalled".
    daysSinceLastCommitment: 23,
    sourceMix: [
      // Predominantly a partner church: the exact conversation C26 asked for,
      // and one the engine could not previously start.
      { source: "partner_church", count: 13 },
      { source: "vision_meeting", count: 5 },
      { source: "personal_referral", count: 2 },
      { source: null, count: 2 },
    ],
    attendanceSeries: [30, 28, 25, 22],
    meetingCadenceDays: 24,
    followUpCount: 9,
    followUpMix: [
      { warm: true, idleDays: 8, count: 3 },
      { warm: false, idleDays: 18, count: 3 },
      { warm: false, idleDays: 2, count: 3 },
    ],
    followUpOwnership: {
      taskCount: 9,
      planterOwnedTaskCount: 3,
      memberOwnerCount: 2,
      demoteOneOwner: false,
    },
    rolesFilled: 4,
    rolesPresentUnfilled: 0,
    trainingRate: 0.2,
    strongLeaders: 2,
    // Over the 20% share AND over the 3-person floor, with no leader among
    // them — so the language must NOT take the leader escalation.
    disengagement: { disengagedCount: 5, includesLeader: false },
    interviews: [{ result: "follow_up", daysAgo: 12 }],
    fourCs: [],
    signals: {
      values_documented: { value: true, attestedDaysAgo: 20 },
      prayer_in_gatherings: { value: true, attestedDaysAgo: 6 },
      prayer_rhythm_established: { value: false, attestedDaysAgo: 6 },
      // Solvent while the core does NOT give. Bryan's year-two case inverted,
      // and the pair that must never collapse into one verdict.
      financial_base_established: { value: true, attestedDaysAgo: 11 },
      core_group_giving: { value: false, attestedDaysAgo: 11 },
    },
    checkins: [],
    note: "Mixed. Growth SLOWED (23d, not stalled); growth is predominantly partner-church transfer; solvent but the core is not giving; cluster disengagement over threshold WITHOUT a leader.",
  },

  // ----- Phase 3 — Training & Preparation -----
  {
    key: "summit",
    name: "EVAL-06 Summit (strong)",
    currentPhase: 3,
    launchOffsetDays: 90,
    lastMaterialEventDaysAgo: 3,
    coreGroupCount: 42,
    launchTeamCount: 14,
    growthDelta: 4,
    daysSinceLastCommitment: 5,
    sourceMix: [
      { source: "vision_meeting", count: 14 },
      { source: "personal_referral", count: 10 },
      { source: "event", count: 7 },
      { source: "social_media", count: 5 },
      { source: "website", count: 4 },
      { source: "partner_church", count: 2 },
    ],
    attendanceSeries: [48, 50, 52, 55],
    meetingCadenceDays: 18,
    followUpCount: 8,
    followUpMix: [
      { warm: true, idleDays: 1, count: 4 },
      { warm: false, idleDays: 5, count: 4 },
    ],
    followUpOwnership: {
      taskCount: 8,
      planterOwnedTaskCount: 1,
      memberOwnerCount: 4,
      demoteOneOwner: false,
    },
    rolesFilled: 7,
    rolesPresentUnfilled: 0,
    trainingRate: 0.78,
    strongLeaders: 6,
    disengagement: { disengagedCount: 0, includesLeader: false },
    interviews: [],
    fourCs: [
      { scores: [5, 5, 4, 5], daysAgo: 18 },
      { scores: [4, 5, 5, 4], daysAgo: 22 },
      { scores: [5, 4, 4, 5], daysAgo: 40 },
    ],
    signals: {
      values_documented: { value: true, attestedDaysAgo: 9 },
      financial_base_established: { value: true, attestedDaysAgo: 7 },
      core_group_giving: { value: true, attestedDaysAgo: 4 },
      prayer_rhythm_established: { value: true, attestedDaysAgo: 4 },
      prayer_in_gatherings: { value: true, attestedDaysAgo: 4 },
      systems_tested: { value: false, attestedDaysAgo: 9 },
    },
    checkins: [],
    note: "Strong across the board: 7/8 roles, ownership spread over 4 members, the broadest source mix in the fleet, 4 C's recorded, every attestation fresh.",
  },
  {
    key: "hollow",
    name: "EVAL-07 Hollow (claims ahead of reality)",
    currentPhase: 3,
    launchOffsetDays: 100,
    lastMaterialEventDaysAgo: 20,
    coreGroupCount: 11,
    launchTeamCount: 1,
    growthDelta: -2,
    daysSinceLastCommitment: 40,
    sourceMix: [
      // Nobody recorded a source for anyone. "We cannot see where your growth
      // is coming from yet" — never a quiet gap.
      { source: null, count: 11 },
    ],
    attendanceSeries: [14, 12],
    meetingCadenceDays: 40,
    followUpCount: 5,
    followUpMix: [{ warm: false, idleDays: 25, count: 5 }],
    followUpOwnership: null,
    rolesFilled: 2,
    rolesPresentUnfilled: 0,
    trainingRate: 0.1,
    strongLeaders: 1,
    disengagement: { disengagedCount: 3, includesLeader: false },
    interviews: [],
    fourCs: [],
    signals: {},
    checkins: [],
    note: "Phase-vs-reality mismatch, and the fleet's second UNKNOWN pole: Phase 3 with prayer and generosity unanswered, no recorded sources at all, growth stalled at 40d, ownership not measured.",
  },

  // ----- Phase 4 — Pre-Launch -----
  {
    key: "lighthouse",
    name: "EVAL-08 Lighthouse (launch-ready exemplar)",
    currentPhase: 4,
    launchOffsetDays: 18,
    lastMaterialEventDaysAgo: 2,
    coreGroupCount: 64,
    launchTeamCount: 40,
    growthDelta: 6,
    daysSinceLastCommitment: 3,
    sourceMix: [
      { source: "vision_meeting", count: 24 },
      { source: "personal_referral", count: 16 },
      { source: "event", count: 10 },
      { source: "social_media", count: 8 },
      { source: "website", count: 6 },
    ],
    attendanceSeries: [70, 74, 78, 82],
    meetingCadenceDays: 14,
    followUpCount: 7,
    followUpMix: [
      { warm: true, idleDays: 1, count: 4 },
      { warm: false, idleDays: 3, count: 3 },
    ],
    followUpOwnership: {
      taskCount: 7,
      planterOwnedTaskCount: 1,
      memberOwnerCount: 5,
      demoteOneOwner: false,
    },
    rolesFilled: 8,
    rolesPresentUnfilled: 0,
    trainingRate: 0.95,
    strongLeaders: 8,
    disengagement: { disengagedCount: 0, includesLeader: false },
    interviews: [
      { result: "qualified", daysAgo: 60 },
      { result: "qualified", daysAgo: 35 },
      { result: "qualified_with_notes", daysAgo: 10 },
    ],
    fourCs: [
      { scores: [5, 5, 5, 5], daysAgo: 30 },
      { scores: [4, 5, 4, 5], daysAgo: 28 },
      { scores: [5, 4, 5, 4], daysAgo: 15 },
    ],
    signals: {
      values_documented: { value: true, attestedDaysAgo: 10 },
      financial_base_established: { value: true, attestedDaysAgo: 6 },
      core_group_giving: { value: true, attestedDaysAgo: 3 },
      prayer_rhythm_established: { value: true, attestedDaysAgo: 3 },
      prayer_in_gatherings: { value: true, attestedDaysAgo: 3 },
      systems_tested: { value: true, attestedDaysAgo: 6 },
    },
    checkins: [],
    note: "Exemplar: 8/8 roles, 18d countdown with NOTHING unresolved — the case that must NOT escalate, because time alone is never sufficient.",
  },
  {
    key: "freefall",
    name: "EVAL-09 Freefall (under-prepared, imminent)",
    currentPhase: 4,
    launchOffsetDays: 12,
    lastMaterialEventDaysAgo: 1,
    coreGroupCount: 19,
    launchTeamCount: 4,
    growthDelta: -2,
    daysSinceLastCommitment: 29,
    sourceMix: [
      { source: "vision_meeting", count: 7 },
      { source: "partner_church", count: 5 },
      { source: "personal_referral", count: 3 },
      { source: null, count: 4 },
    ],
    attendanceSeries: [40, 34, 28, 22],
    meetingCadenceDays: 28,
    followUpCount: 11,
    followUpMix: [
      { warm: true, idleDays: 10, count: 4 },
      { warm: false, idleDays: 22, count: 7 },
    ],
    followUpOwnership: {
      // Every open follow-up on the planter. Now a measured fact rather than
      // the inference v0 made from staleness alone.
      taskCount: 8,
      planterOwnedTaskCount: 8,
      memberOwnerCount: 0,
      demoteOneOwner: false,
    },
    rolesFilled: 3,
    rolesPresentUnfilled: 0,
    trainingRate: 0.35,
    strongLeaders: 2,
    disengagement: { disengagedCount: 4, includesLeader: true },
    interviews: [{ result: "not_qualified", daysAgo: 50 }],
    fourCs: [],
    signals: {
      prayer_rhythm_established: { value: true, attestedDaysAgo: 38 },
      prayer_in_gatherings: { value: false, attestedDaysAgo: 38 },
      financial_base_established: { value: false, attestedDaysAgo: 16 },
      core_group_giving: { value: false, attestedDaysAgo: 16 },
    },
    checkins: [
      {
        weeksAgo: 1,
        spiritually: "struggling",
        marriageFamily: "strained",
        financially: "struggling",
        pace: "struggling",
      },
      {
        weeksAgo: 2,
        spiritually: "strained",
        marriageFamily: "strained",
        financially: "struggling",
        pace: "struggling",
      },
    ],
    note: "The compound escalation: 12d out AND roles unfilled AND training incomplete. Growth stalled, planter owns every follow-up, disengagement includes a leader, both money questions answered NO. Carries the fleet's most concerning check-ins — which the engine must never see.",
  },

  // ----- Phase 5 — Launch Sunday -----
  {
    key: "dayspring",
    name: "EVAL-10 Dayspring (just launched)",
    currentPhase: 5,
    launchOffsetDays: -5,
    lastMaterialEventDaysAgo: 2,
    coreGroupCount: 82,
    launchTeamCount: 50,
    growthDelta: 4,
    daysSinceLastCommitment: 4,
    sourceMix: [
      { source: "vision_meeting", count: 30 },
      { source: "personal_referral", count: 20 },
      { source: "event", count: 14 },
      { source: "social_media", count: 10 },
      { source: "website", count: 8 },
    ],
    attendanceSeries: [88, 90, 92, 95],
    meetingCadenceDays: 14,
    followUpCount: 9,
    followUpMix: [
      { warm: true, idleDays: 2, count: 5 },
      { warm: false, idleDays: 4, count: 4 },
    ],
    followUpOwnership: {
      taskCount: 9,
      planterOwnedTaskCount: 1,
      memberOwnerCount: 4,
      demoteOneOwner: false,
    },
    rolesFilled: 8,
    rolesPresentUnfilled: 0,
    trainingRate: 1.0,
    strongLeaders: 8,
    disengagement: { disengagedCount: 0, includesLeader: false },
    interviews: [
      { result: "qualified_with_notes", daysAgo: 25 },
      { result: "qualified_with_notes", daysAgo: 14 },
    ],
    fourCs: [{ scores: [5, 4, 5, 5], daysAgo: 20 }],
    signals: {
      values_documented: { value: true, attestedDaysAgo: 8 },
      financial_base_established: { value: true, attestedDaysAgo: 5 },
      core_group_giving: { value: true, attestedDaysAgo: 2 },
      prayer_rhythm_established: { value: true, attestedDaysAgo: 2 },
      prayer_in_gatherings: { value: true, attestedDaysAgo: 2 },
      systems_tested: { value: true, attestedDaysAgo: 5 },
    },
    checkins: [],
    note: "Just launched (launchDate −5d): full roles, training 100%, everything fresh.",
  },

  // ----- Phase 6 — Post-Launch -----
  {
    key: "evergreen",
    name: "EVAL-11 Evergreen (thriving)",
    currentPhase: 6,
    launchOffsetDays: -120,
    lastMaterialEventDaysAgo: 3,
    coreGroupCount: 70,
    launchTeamCount: 40,
    growthDelta: 3,
    daysSinceLastCommitment: 8,
    sourceMix: [
      { source: "vision_meeting", count: 22 },
      { source: "personal_referral", count: 16 },
      { source: "event", count: 12 },
      { source: "social_media", count: 9 },
      { source: "website", count: 6 },
      { source: "partner_church", count: 5 },
    ],
    attendanceSeries: [82, 86, 88, 90],
    meetingCadenceDays: 14,
    followUpCount: 10,
    followUpMix: [
      { warm: true, idleDays: 2, count: 5 },
      { warm: false, idleDays: 6, count: 5 },
    ],
    followUpOwnership: {
      taskCount: 10,
      planterOwnedTaskCount: 2,
      memberOwnerCount: 5,
      demoteOneOwner: false,
    },
    rolesFilled: 8,
    rolesPresentUnfilled: 0,
    trainingRate: 0.85,
    strongLeaders: 8,
    disengagement: { disengagedCount: 2, includesLeader: false },
    interviews: [],
    fourCs: [
      { scores: [5, 5, 4, 5], daysAgo: 45 },
      { scores: [4, 4, 5, 4], daysAgo: 33 },
    ],
    signals: {
      values_documented: { value: true, attestedDaysAgo: 20 },
      financial_base_established: { value: true, attestedDaysAgo: 4 },
      // Attested, and PERISHED — a giving culture is a claim about the present
      // tense, so 35 days is reported with its age rather than as a pass.
      core_group_giving: { value: true, attestedDaysAgo: 35 },
      prayer_rhythm_established: { value: true, attestedDaysAgo: 9 },
      prayer_in_gatherings: { value: true, attestedDaysAgo: 32 },
    },
    checkins: [],
    note: "Thriving post-launch. Carries the fleet's split-freshness case: solvency fresh while the GIVING attestation has gone stale, and one prayer attestation stale beside a fresh one.",
  },
  {
    key: "ember",
    name: "EVAL-12 Ember (struggling post-launch)",
    currentPhase: 6,
    launchOffsetDays: -100,
    lastMaterialEventDaysAgo: 25,
    coreGroupCount: 60,
    launchTeamCount: 30,
    // −1, not −3: SLOWED means the newest commitment is still inside the
    // trailing window, and a delta of −3 would empty that window entirely and
    // put the plant in STALLED territory instead. The two facts are one row.
    growthDelta: -1,
    daysSinceLastCommitment: 26,
    sourceMix: [
      { source: "vision_meeting", count: 20 },
      { source: "personal_referral", count: 14 },
      { source: "partner_church", count: 12 },
      { source: "event", count: 6 },
      { source: null, count: 8 },
    ],
    attendanceSeries: [90, 55, 40],
    meetingCadenceDays: 21,
    followUpCount: 9,
    followUpMix: [
      { warm: false, idleDays: 26, count: 5 },
      { warm: false, idleDays: 4, count: 4 },
    ],
    followUpOwnership: {
      // An owner who left the committed set. Their tasks read UNOWNED again
      // instead of hiding behind a name — the only way to exercise that the
      // owner's CURRENT status is what counts.
      taskCount: 9,
      planterOwnedTaskCount: 2,
      memberOwnerCount: 3,
      demoteOneOwner: true,
    },
    // 2 of the would-be-filled roles are vacated (leaderId nulled), so the
    // intended filled count is reduced by 2 from a 6-role baseline → 4.
    rolesFilled: 4,
    rolesPresentUnfilled: 2,
    trainingRate: 0.6,
    strongLeaders: 4,
    disengagement: { disengagedCount: 6, includesLeader: true },
    interviews: [
      { result: "qualified", daysAgo: 70 },
      { result: "not_qualified", daysAgo: 21 },
    ],
    fourCs: [{ scores: [3, 3, 2, 3], daysAgo: 26 }],
    signals: {
      financial_base_established: { value: true, attestedDaysAgo: 13 },
      core_group_giving: { value: false, attestedDaysAgo: 13 },
      prayer_in_gatherings: { value: false, attestedDaysAgo: 18 },
    },
    checkins: [
      {
        weeksAgo: 1,
        spiritually: "strained",
        marriageFamily: "steady",
        financially: "strained",
        pace: "struggling",
      },
    ],
    note: "Post-launch decline: attendance crash, 2 vacated leaders, growth SLOWED at 26d, a demoted follow-up owner, disengagement including a leader, prayer unanswered on one key and false on the other.",
  },
];

// ============================================================================
// Cleanup — scoped strictly to eval-namespaced rows (child-first)
// ============================================================================

/** Resolve the eval network id (if it exists) so we can scope every delete. */
async function findEvalNetworkId(): Promise<string | null> {
  const rows = await db
    .select({ id: sendingNetworks.id })
    .from(sendingNetworks)
    .where(eq(sendingNetworks.name, EVAL_NETWORK_NAME))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Delete every eval-scoped row from every table carrying a `church_id`, in
 * whatever order the foreign keys turn out to allow.
 *
 * The tables are read from `information_schema` rather than listed, and a
 * delete that trips a foreign key is retried on the next lap once its children
 * are gone. The loop ends when a full lap deletes nothing new — either because
 * everything is clear, or because something genuinely cannot be removed, which
 * is then reported rather than swallowed.
 *
 * `users` is excluded: it is scoped by eval email domain and by `church_id`
 * separately, and sweeping it here would delete accounts this script did not
 * create.
 */
async function sweepChurchScopedRows(churchIds: string[]): Promise<void> {
  const tables = (await sql`
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'church_id'
      AND table_name NOT IN ('churches', 'users')
    ORDER BY table_name
  `) as { table_name: string }[];

  let remaining = tables.map((t) => t.table_name);
  const idList = churchIds;

  while (remaining.length > 0) {
    const stillBlocked: string[] = [];
    for (const table of remaining) {
      try {
        await sql.query(
          `DELETE FROM "${table}" WHERE church_id = ANY($1::uuid[])`,
          [idList]
        );
      } catch (error) {
        // 23503 = foreign_key_violation: a child in another table still points
        // here. It may be deletable on the next lap.
        if ((error as { code?: string }).code === "23503") {
          stillBlocked.push(table);
          continue;
        }
        throw error;
      }
    }
    if (stillBlocked.length === remaining.length) {
      throw new Error(
        `Eval cleanup stalled — these tables still hold blocked rows: ${stillBlocked.join(", ")}`
      );
    }
    remaining = stillBlocked;
  }
}

async function cleanEvalData(): Promise<void> {
  console.log("🧹 Cleaning eval data (scoped to the eval network)…");

  const networkId = await findEvalNetworkId();
  if (!networkId) {
    console.log("   No eval network present — nothing to clean.\n");
    return;
  }

  // All eval churches hang off the eval network (directly via sending_network_id
  // and indirectly via the eval sending church). Resolve their ids first; every
  // child table is church-scoped, so we delete by churchId set.
  const evalSendingChurches = await db
    .select({ id: sendingChurches.id })
    .from(sendingChurches)
    .where(eq(sendingChurches.sendingNetworkId, networkId));
  const sendingChurchIds = evalSendingChurches.map((r) => r.id);

  const evalChurchRows = await db
    .select({ id: churches.id })
    .from(churches)
    .where(eq(churches.sendingNetworkId, networkId));
  const churchIds = evalChurchRows.map((r) => r.id);

  if (churchIds.length > 0) {
    // Child tables first (respect FKs). meetingAttendance & teamMemberships
    // cascade from their parents, but deleting explicitly by churchId is safe
    // and keeps the cleanup self-contained.
    // Phase-engine output rows. Their `church_id` FKs do NOT cascade, so a
    // church delete fails once any assessment has been generated — these must
    // go first. (Insight feedback cascades from insights, but is explicit here
    // to keep the cleanup self-describing.)
    await db
      .delete(insightFeedback)
      .where(inArray(insightFeedback.churchId, churchIds));
    await db
      .delete(plantInsights)
      .where(inArray(plantInsights.churchId, churchIds));
    await db
      .delete(plantAssessments)
      .where(inArray(plantAssessments.churchId, churchIds));
    await db
      .delete(phaseTransitions)
      .where(inArray(phaseTransitions.churchId, churchIds));
    await db
      .delete(churchPrivacySettings)
      .where(inArray(churchPrivacySettings.churchId, churchIds));

    // The launch entity (#305/LS-001) — where the countdown fact comes from now
    // that `churches.launch_date` is gone. Journal, milestones and milestone
    // links cascade from it; the launch itself must go before `users` (its
    // journal names an actor) and before `churches`.
    await db.delete(launches).where(inArray(launches.churchId, churchIds));

    // The v1 signal tables. All four hold person or user FKs, so they go before
    // `persons` and before the eval users are removed below.
    await db.delete(tasks).where(inArray(tasks.churchId, churchIds));
    await db.delete(interviews).where(inArray(interviews.churchId, churchIds));
    await db
      .delete(assessments)
      .where(inArray(assessments.churchId, churchIds));
    await db
      .delete(planterCheckins)
      .where(inArray(planterCheckins.churchId, churchIds));

    await db
      .delete(meetingAttendance)
      .where(inArray(meetingAttendance.churchId, churchIds));
    await db
      .delete(trainingCompletions)
      .where(inArray(trainingCompletions.churchId, churchIds));
    await db
      .delete(teamMemberships)
      .where(inArray(teamMemberships.churchId, churchIds));
    await db
      .delete(commitments)
      .where(inArray(commitments.churchId, churchIds));
    await db
      .delete(plantSignals)
      .where(inArray(plantSignals.churchId, churchIds));
    await db
      .delete(churchMeetings)
      .where(inArray(churchMeetings.churchId, churchIds));
    await db
      .delete(trainingPrograms)
      .where(inArray(trainingPrograms.churchId, churchIds));
    await db.delete(teamRoles).where(inArray(teamRoles.churchId, churchIds));
    // ministryTeams.leaderId → persons; persons must outlive the team delete,
    // so drop teams (and their leader FK) before persons.
    await db
      .delete(ministryTeams)
      .where(inArray(ministryTeams.churchId, churchIds));
    await db.delete(persons).where(inArray(persons.churchId, churchIds));
  }

  // Eval users (planter per church + network admin) — matched by the eval
  // SUBDOMAIN, not the full domain, so accounts seeded before the everyfield.app
  // retirement are swept by the same pass that sweeps today's. See
  // `EVAL_EMAIL_MARKER`.
  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      sendingNetworkId: users.sendingNetworkId,
      sendingChurchId: users.sendingChurchId,
    })
    .from(users);
  const evalUserIds = allUsers
    .filter(
      (u) =>
        u.email.includes(EVAL_EMAIL_MARKER) ||
        // Belt-and-braces for a user that points INTO the eval org but carries
        // an ordinary address (someone who registered against the corpus): the
        // network/sending-church deletes at the end would otherwise fail on
        // their FK, and neither cascades.
        u.sendingNetworkId === networkId ||
        (u.sendingChurchId !== null &&
          sendingChurchIds.includes(u.sendingChurchId))
    )
    .map((u) => u.id);
  // Oversight associations and the invitations behind them (#23/#303). Not
  // seeded here — they are created by USING the product against the eval
  // corpus — but they FK into these users and churches and neither FK cascades,
  // so without this sweep the `users` delete fails on
  // `organization_invitations_inviter_user_id_users_id_fk`. Audit rows first:
  // `association_events.source_invitation_id` points at an invitation.
  if (churchIds.length > 0) {
    await db
      .delete(associationEvents)
      .where(inArray(associationEvents.churchId, churchIds));
  }
  if (evalUserIds.length > 0) {
    await db
      .delete(associationEvents)
      .where(inArray(associationEvents.actorUserId, evalUserIds));
    // Documents generated by USING the product against the eval corpus. Same
    // shape as the invitations below: never seeded, FK into eval users, and
    // `generated_documents_user_id_users_id_fk` does not cascade.
    await db
      .delete(generatedDocuments)
      .where(inArray(generatedDocuments.userId, evalUserIds));
  }
  if (churchIds.length > 0) {
    await db
      .delete(generatedDocuments)
      .where(inArray(generatedDocuments.churchId, churchIds));
  }

  // THE AUDIT ROW IS CLEARED BY THE INVITATION IT NAMES, not by the church or
  // actor it happens to carry. Deleting `association_events` by `church_id` and
  // `actor_user_id` alone leaves any event whose OWN church is outside the eval
  // set while `source_invitation_id` points into it — and the invitation delete
  // then fails on `association_events_source_invitation_id_organization_
  // invitation`, which is what made a plain re-run of this seeder impossible.
  // Resolve the invitations in scope first, then sweep their audit rows.
  {
    const scoped: { id: string }[] = [];
    if (evalUserIds.length > 0) {
      scoped.push(
        ...(await db
          .select({ id: organizationInvitations.id })
          .from(organizationInvitations)
          .where(inArray(organizationInvitations.inviterUserId, evalUserIds))),
        ...(await db
          .select({ id: organizationInvitations.id })
          .from(organizationInvitations)
          .where(inArray(organizationInvitations.respondedBy, evalUserIds)))
      );
    }
    if (churchIds.length > 0) {
      scoped.push(
        ...(await db
          .select({ id: organizationInvitations.id })
          .from(organizationInvitations)
          .where(inArray(organizationInvitations.targetChurchId, churchIds)))
      );
    }

    const invitationIds = [...new Set(scoped.map((r) => r.id))];
    if (invitationIds.length > 0) {
      await db
        .delete(associationEvents)
        .where(inArray(associationEvents.sourceInvitationId, invitationIds));
      await db
        .delete(organizationInvitations)
        .where(inArray(organizationInvitations.id, invitationIds));
    }
  }
  await db
    .delete(organizationInvitations)
    .where(eq(organizationInvitations.sendingNetworkId, networkId));

  if (evalUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, evalUserIds));
  }

  if (churchIds.length > 0) {
    // THE SWEEP THAT DOES NOT NEED MAINTAINING.
    //
    // Everything above deletes the tables this script SEEDS, in a hand-written
    // order. What kept breaking the re-run is the other kind of row: the ones
    // created by USING the product against the corpus — a location, a
    // notification, a generated document, a wiki bookmark — each of which FKs
    // into an eval church and none of which this script has ever heard of. Two
    // of those were found the hard way today, and the schema will keep growing.
    //
    // So the tail is generic: find every table carrying a `church_id`, delete
    // the eval rows, and retry the ones that fail on a foreign key until the
    // set stops shrinking. Deleting a child unblocks its parent on the next
    // lap, so a dependency chain of any depth drains without anybody encoding
    // its order — and a table added next month is swept without a code change.
    await sweepChurchScopedRows(churchIds);

    // A user pointing INTO an eval church but not carrying an eval email —
    // anyone who registered against the corpus — blocks the church delete on
    // `users_church_id_churches_id_fk`. The email-domain scope above cannot see
    // them, so they are cleared here rather than left to fail the run.
    await db.delete(users).where(inArray(users.churchId, churchIds));
    await db.delete(churches).where(inArray(churches.id, churchIds));
  }
  if (sendingChurchIds.length > 0) {
    await db
      .delete(sendingChurches)
      .where(inArray(sendingChurches.id, sendingChurchIds));
  }
  await db.delete(sendingNetworks).where(eq(sendingNetworks.id, networkId));

  console.log(
    `   Removed ${churchIds.length} eval churches, ${evalUserIds.length} eval users, and the eval network.\n`
  );
}

// ============================================================================
// Seeding
// ============================================================================

interface SeededChurch {
  profile: ChurchProfile;
  churchId: string;
}

async function seedChurch(
  profile: ChurchProfile,
  ownerUserId: string
): Promise<string> {
  const [church] = await db
    .insert(churches)
    .values({
      name: profile.name,
      currentPhase: profile.currentPhase,
      sendingNetworkId: EVAL_IDS.networkId,
      sendingChurchId: EVAL_IDS.sendingChurchId,
      onboardingCompletedAt: onboardingCompletedAtSeedStamp(),
      lastMaterialEventAt:
        profile.lastMaterialEventDaysAgo === null
          ? null
          : daysAgo(profile.lastMaterialEventDaysAgo),
    })
    .returning({ id: churches.id });

  const churchId = church.id;

  // The countdown fact's source (#305/LS-001). It used to be a column on the
  // insert above; the eval corpus's `launchOffsetDays` is unchanged, so every
  // profile produces the SAME `launch.launchDate` / `daysUntilLaunch` fact it
  // did before — which is the point: the corpus is a fixed input, and a schema
  // migration must not move the baseline the judge is graded against.
  //
  // `launchOffsetDays === null` means "no date", and that is seeded as NO LAUNCH
  // ROW rather than a `planning` launch with a null date. Both produce an empty
  // countdown; a plant that has not begun planning is the truer fixture, and the
  // eval corpus predates the entity having a status at all.
  if (profile.launchOffsetDays !== null) {
    await db.insert(launches).values({
      churchId,
      targetDate: launchInDays(profile.launchOffsetDays),
      // Past-dated profiles (EVAL-10 at −5d, EVAL-11 at −120d) stay `scheduled`
      // rather than `completed`: no outcome was ever recorded for them, and
      // `completed` with empty outcome fields would be a fixture asserting
      // something the corpus never said.
      status: "scheduled",
    });
  }

  // ---- The planter (created_by for all rows, and a person record exists) ----
  // Persons need a created_by user; we reuse the church owner for everything.

  // ------------------------------------------------------------------
  // 1. Core-group + launch-team commitments.
  //
  // growthDelta is computed by the Signal layer from each person's FIRST
  // core_group commitment landing in the trailing 28d window vs the prior 28d
  // window. We deliberately place `base` first-commitments in the prior window
  // and `base + max(delta,0) + max(-delta,0)`-adjusted counts in the in-window
  // bucket so the signed delta is exactly `growthDelta`. Remaining committed
  // people get older commitments (outside both windows) so they count toward
  // committedCount without disturbing the delta.
  //
  // THE STALL CLOCK RIDES THE SAME ROWS (#471). It is the age of the NEWEST
  // first commitment, so it is not a free parameter beside `growthDelta` — the
  // newest row is either inside the trailing window or it is not, and that is
  // the sign of the delta. `assertProfileCoherence` refuses the pair rather
  // than letting the seeder quietly produce a fixture nobody predicted.
  // ------------------------------------------------------------------
  const committedPersonIds: string[] = [];
  const committedSources = expandSourceMix(profile);
  if (profile.coreGroupCount > 0) {
    // PRIOR_BASE is the count of first-commitments landing in the prior 28d
    // window. It must be large enough that `inWindow = PRIOR_BASE + delta` is
    // non-negative even for negative deltas, so the SIGNED delta is realized
    // exactly (inWindow − PRIOR_BASE === growthDelta).
    const PRIOR_BASE = Math.max(2, -profile.growthDelta);
    const inWindow = PRIOR_BASE + profile.growthDelta; // ≥ 0 by construction
    const total = profile.coreGroupCount;

    // Where the newest first-commitment lands. Below 28 days it is the
    // trailing-window cohort's date; at or above it, the trailing window is
    // empty and the PRIOR cohort carries the newest date instead.
    const stall = profile.daysSinceLastCommitment ?? 42;
    const recentDaysAgo = inWindow > 0 ? stall : 10;
    const priorDaysAgo = inWindow > 0 ? 42 : stall;

    // Windowed commitments must fit inside the total; the rest are older
    // (outside both windows) and only affect committedCount, not the delta.
    const windowed = inWindow + PRIOR_BASE;
    const older = Math.max(0, total - windowed);

    const personRows: (typeof persons.$inferInsert)[] = [];
    const commitmentRows: (typeof commitments.$inferInsert)[] = [];

    let idx = 0;
    const addCommitted = (signedDaysAgo: number) => {
      const i = idx++;
      personRows.push({
        churchId,
        firstName: "Core",
        lastName: `${profile.key}-${i}`,
        status: "core_group",
        // WHERE THIS PERSON CAME FROM (#487). One draw from the profile's mix,
        // `null` included — a plant whose sources are mostly unrecorded is a
        // fixture the corpus needs, not an oversight.
        source: committedSources[i] ?? null,
        createdBy: ownerUserId,
        createdAt: daysAgo(signedDaysAgo + 30),
        updatedAt: daysAgo(signedDaysAgo),
      });
      // person id assigned after insert; we re-link below via index.
    };

    // Prior-window first-commitments (inside [28,56)).
    for (let i = 0; i < PRIOR_BASE; i++) addCommitted(priorDaysAgo);
    // In-window first-commitments (inside (0,28]).
    for (let i = 0; i < inWindow; i++) addCommitted(recentDaysAgo);
    // Older commitments (≈ 90 days ago: outside both windows).
    for (let i = 0; i < older; i++) addCommitted(90);

    if (personRows.length > 0) {
      const inserted = await db
        .insert(persons)
        .values(personRows)
        .returning({ id: persons.id });
      inserted.forEach((p) => committedPersonIds.push(p.id));

      // Re-derive the signedDate per row in the same order we built personRows.
      let j = 0;
      const signedFor: number[] = [
        ...Array(PRIOR_BASE).fill(priorDaysAgo),
        ...Array(inWindow).fill(recentDaysAgo),
        ...Array(older).fill(90),
      ];
      for (const personId of committedPersonIds) {
        commitmentRows.push({
          churchId,
          personId,
          commitmentType: "core_group",
          signedDate: dateOnlyAgo(signedFor[j]),
          witnessedBy: ownerUserId,
        });
        j++;
      }
      if (commitmentRows.length > 0) {
        await db.insert(commitments).values(commitmentRows);
      }
    }

    // Launch-team commitments: layered on the FIRST `launchTeamCount` committed
    // people (they hold both a core_group and launch_team commitment).
    const launchRows: (typeof commitments.$inferInsert)[] = [];
    for (
      let i = 0;
      i < Math.min(profile.launchTeamCount, committedPersonIds.length);
      i++
    ) {
      launchRows.push({
        churchId,
        personId: committedPersonIds[i],
        commitmentType: "launch_team",
        signedDate: dateOnlyAgo(20),
        witnessedBy: ownerUserId,
      });
    }
    if (launchRows.length > 0) {
      await db.insert(commitments).values(launchRows);
    }
  }

  // ------------------------------------------------------------------
  // 2. Open follow-up contacts (attendee / following_up / interviewed).
  //    Staleness is driven by persons.updatedAt vs NOW (14d threshold).
  // ------------------------------------------------------------------
  const followUpPersonIds: string[] = [];
  // Parallel to `followUpPersonIds`: whether that contact should read WARM,
  // i.e. be sat in the newest vision meeting's attendance below. Warmth is not
  // a column — it is "they turned up recently" — so it is realized in step 4.
  const followUpIsWarm: boolean[] = [];
  if (profile.followUpCount > 0) {
    const FOLLOW_STATUSES = [
      "attendee",
      "following_up",
      "interviewed",
    ] as const;
    const rows: (typeof persons.$inferInsert)[] = [];
    // The cohort, flattened from the profile's warmth/idle slices. Idle age is
    // `persons.updated_at`, which is INDEPENDENT of warmth: the pair that
    // matters most is warm AND idle — somebody who came to a vision meeting on
    // Tuesday and has been untouched for nine days — and it is only
    // representable because the two are separate facts.
    const cohort = profile.followUpMix.flatMap((slice) =>
      Array.from({ length: slice.count }, () => slice)
    );
    for (let i = 0; i < cohort.length; i++) {
      const { warm, idleDays } = cohort[i];
      rows.push({
        churchId,
        firstName: "Lead",
        lastName: `${profile.key}-${i}`,
        status: FOLLOW_STATUSES[i % FOLLOW_STATUSES.length],
        source: "personal_referral",
        createdBy: ownerUserId,
        createdAt: daysAgo(idleDays + 20),
        updatedAt: daysAgo(idleDays),
      });
      followUpIsWarm.push(warm);
    }
    const inserted = await db
      .insert(persons)
      .values(rows)
      .returning({ id: persons.id });
    inserted.forEach((p) => followUpPersonIds.push(p.id));
  }

  // ------------------------------------------------------------------
  // 3. Ministry teams + leaders → role coverage.
  //    A role reads "filled" when a name-matched team has a non-null leaderId.
  //    We create the first `rolesFilled` canonical teams WITH a leader, then
  //    `rolesPresentUnfilled` further canonical teams WITHOUT a leader.
  // ------------------------------------------------------------------
  {
    const totalTeams = Math.min(
      ROLE_TEAM_NAMES.length,
      profile.rolesFilled + profile.rolesPresentUnfilled
    );

    // Leaders are dedicated persons (core_group status so they also surface as
    // leadership candidates with leadsTeam = true).
    for (let t = 0; t < totalTeams; t++) {
      const filled = t < profile.rolesFilled;
      let leaderId: string | null = null;

      if (filled) {
        const [leader] = await db
          .insert(persons)
          .values({
            churchId,
            firstName: "Lead",
            lastName: `${profile.key}-team-${t}`,
            status: "leader",
            source: "vision_meeting",
            createdBy: ownerUserId,
            createdAt: daysAgo(200),
            updatedAt: daysAgo(5),
          })
          .returning({ id: persons.id });
        leaderId = leader.id;
      }

      await db.insert(ministryTeams).values({
        churchId,
        name: ROLE_TEAM_NAMES[t].teamName,
        type: "predefined",
        leaderId,
        status: "active",
        createdBy: ownerUserId,
      });
    }
  }

  // ------------------------------------------------------------------
  // 4. Completed vision meetings + per-meeting attendance.
  //    attendanceSeries is OLDEST → NEWEST; the Signal layer reads newest vs
  //    previous for the trend and gaps for cadence. We attach attendance rows
  //    (status 'attended') from committed people so meetingsAttended is > 0 for
  //    leadership readiness.
  // ------------------------------------------------------------------
  if (profile.attendanceSeries.length > 0) {
    const n = profile.attendanceSeries.length;
    for (let m = 0; m < n; m++) {
      // Oldest meeting is the furthest back; spacing = cadence.
      const meetingDaysAgo = (n - 1 - m) * profile.meetingCadenceDays + 7;
      const [meeting] = await db
        .insert(churchMeetings)
        .values({
          churchId,
          type: "vision_meeting",
          title: `Vision Meeting ${m + 1}`,
          datetime: daysAgo(meetingDaysAgo),
          status: "completed",
          meetingNumber: m + 1,
          actualAttendance: profile.attendanceSeries[m],
          createdBy: ownerUserId,
        })
        .returning({ id: churchMeetings.id });

      // Mark a handful of committed people as attended (capped at attendance).
      //
      // THE DISENGAGED TAIL IS HELD OUT (#486, C22). `disengaged` is
      // `prior \ recent`, so anybody seated here is disqualified from ever
      // reading as disengaged — the old seeder sat the same six people at every
      // meeting, which is why the whole corpus reported zero. The tail attends
      // one older gathering instead, seeded below.
      const eligible = committedPersonIds.slice(
        0,
        Math.max(
          0,
          committedPersonIds.length - profile.disengagement.disengagedCount
        )
      );
      const attendeeCount = Math.min(
        eligible.length,
        Math.max(0, Math.min(profile.attendanceSeries[m], 6))
      );
      const attendanceRows: (typeof meetingAttendance.$inferInsert)[] = [];
      for (let a = 0; a < attendeeCount; a++) {
        attendanceRows.push({
          churchId,
          meetingId: meeting.id,
          personId: eligible[a],
          attendanceType: "core_group",
          status: "attended",
          createdBy: ownerUserId,
        });
      }

      // WARMTH IS ATTENDANCE AT THE NEWEST VISION MEETING (#486). It sits 7
      // days back, inside the 14-day warm window, so seating a follow-up
      // contact here is what makes them warm. The old seeder attached
      // attendance to committed people only, so `warmCount` was 0 fleet-wide
      // and the warm/cold split could never fire.
      if (m === n - 1) {
        for (let f = 0; f < followUpPersonIds.length; f++) {
          if (!followUpIsWarm[f]) continue;
          attendanceRows.push({
            churchId,
            meetingId: meeting.id,
            personId: followUpPersonIds[f],
            attendanceType: "first_time",
            status: "attended",
            createdBy: ownerUserId,
          });
        }
      }

      if (attendanceRows.length > 0) {
        await db.insert(meetingAttendance).values(attendanceRows);
      }
    }
  }

  // ------------------------------------------------------------------
  // 4b. The disengaged: one gathering in the 28–56d band and nothing since.
  //
  // A DEDICATED MEETING, not a reused vision meeting, because the band has to
  // hold whatever each profile's cadence happens to be — Wanderer's meetings
  // are 30 days apart and Lighthouse's are 14, and a fixture that depends on
  // that arithmetic breaks the first time somebody retunes a cadence. Cohesion
  // counts ANY completed meeting type, so a core-group gathering qualifies.
  // ------------------------------------------------------------------
  const disengagedPersonIds = committedPersonIds.slice(
    Math.max(
      0,
      committedPersonIds.length - profile.disengagement.disengagedCount
    )
  );
  if (disengagedPersonIds.length > 0) {
    const [gathering] = await db
      .insert(churchMeetings)
      .values({
        churchId,
        // `team_meeting`, not `vision_meeting`: cohesion counts any completed
        // meeting, while warmth and cadence read vision meetings only — so this
        // gathering moves the disengagement facts and touches nothing else.
        type: "team_meeting",
        title: "Core Group Gathering",
        datetime: daysAgo(35),
        status: "completed",
        createdBy: ownerUserId,
      })
      .returning({ id: churchMeetings.id });

    await db.insert(meetingAttendance).values(
      disengagedPersonIds.map((personId) => ({
        churchId,
        meetingId: gathering.id,
        personId,
        attendanceType: "core_group" as const,
        status: "attended" as const,
        createdBy: ownerUserId,
      }))
    );

    // A MINISTRY-TEAM LEADER AMONG THE QUIET IS A DIFFERENT FACT, and it takes
    // one level more directness in the copy. The team is deliberately
    // custom-named: role coverage is matched by canonical team NAME, so a
    // canonical name here would silently move `rolesFilled` and change what the
    // profile is testing.
    if (profile.disengagement.includesLeader) {
      await db.insert(ministryTeams).values({
        churchId,
        name: "Hospitality Crew",
        type: "custom",
        leaderId: disengagedPersonIds[disengagedPersonIds.length - 1],
        status: "active",
        createdBy: ownerUserId,
      });
    }
  }

  // ------------------------------------------------------------------
  // 5. Training program + completions.
  //    requiredCompletionRate = completed (committed × required program) slots
  //    / (requiredPrograms × committedCount). We use ONE required program, so
  //    rate ≈ completionsAmongCommitted / committedCount.
  // ------------------------------------------------------------------
  if (profile.trainingRate !== null) {
    const [program] = await db
      .insert(trainingPrograms)
      .values({
        churchId,
        name: "Core Team Orientation",
        description: "Required onboarding for all committed members.",
        isRequired: true,
        createdBy: ownerUserId,
      })
      .returning({ id: trainingPrograms.id });

    const targetCompletions = Math.round(
      profile.trainingRate * committedPersonIds.length
    );
    const completionRows: (typeof trainingCompletions.$inferInsert)[] = [];
    for (
      let i = 0;
      i < Math.min(targetCompletions, committedPersonIds.length);
      i++
    ) {
      completionRows.push({
        churchId,
        personId: committedPersonIds[i],
        trainingProgramId: program.id,
        completedAt: daysAgo(15 + i),
        createdBy: ownerUserId,
      });
    }
    if (completionRows.length > 0) {
      await db.insert(trainingCompletions).values(completionRows);
    }
  }

  // ------------------------------------------------------------------
  // 6. Active team memberships for "strong" leadership candidates.
  //    Gives the first `strongLeaders` committed people an active membership so
  //    LeadershipReadinessSignal.activeMemberships > 0. Requires a team + role.
  //
  //    ONE ROLE PER MEMBER, because a seat holds ONE person (#409 D1,
  //    migration 0038): `team_memberships_role_active_unique_idx` is partial on
  //    `role_id` where `status = 'active'`. This block used to mint a single
  //    "Core Leader" role and hang the whole core group off it in one
  //    multi-row INSERT, which is the shape that index refuses outright —
  //    Postgres answers the second row with `duplicate key value violates
  //    unique constraint "team_memberships_role_active_unique_idx"` and the
  //    whole fixture fails to regenerate. Fixture data is not exempt from the
  //    invariant: what it produced was a role with N occupants, which the
  //    roles tab cannot render and `removeMember` cannot undo.
  // ------------------------------------------------------------------
  if (profile.strongLeaders > 0 && committedPersonIds.length > 0) {
    const [hostTeam] = await db
      .insert(ministryTeams)
      .values({
        churchId,
        name: "Leadership Core",
        type: "custom",
        status: "active",
        createdBy: ownerUserId,
      })
      .returning({ id: ministryTeams.id });

    const leaderCount = Math.min(
      profile.strongLeaders,
      committedPersonIds.length
    );

    const membershipRows: (typeof teamMemberships.$inferInsert)[] = [];
    for (let i = 0; i < leaderCount; i++) {
      const [role] = await db
        .insert(teamRoles)
        .values({
          churchId,
          teamId: hostTeam.id,
          name: `Core Leader ${i + 1}`,
          isLeadershipRole: true,
          status: "filled",
          createdBy: ownerUserId,
        })
        .returning({ id: teamRoles.id });

      membershipRows.push({
        churchId,
        teamId: hostTeam.id,
        personId: committedPersonIds[i],
        roleId: role.id,
        status: "active",
        createdBy: ownerUserId,
      });
    }
    if (membershipRows.length > 0) {
      await db.insert(teamMemberships).values(membershipRows);
    }
  }

  // ------------------------------------------------------------------
  // 7. Manual attestations (plant_signals).
  // ------------------------------------------------------------------
  // EACH ANSWER CARRIES ITS OWN AGE (#474 D2). The old seeder stamped every
  // attestation at a uniform 10 days, which put the whole corpus on the same
  // side of the 30-day reaffirm window — so "you confirmed this 45 days ago,
  // is it still happening?" was a rule no fixture could ever exercise.
  const signalEntries = Object.entries(profile.signals) as [
    ManualSignalKey,
    AttestationSpec,
  ][];
  if (signalEntries.length > 0) {
    await db.insert(plantSignals).values(
      signalEntries.map(([signalKey, spec]) => ({
        churchId,
        signalKey,
        value: spec.value,
        attestedById: ownerUserId,
        attestedAt: daysAgo(spec.attestedDaysAgo),
      }))
    );
  }

  // ------------------------------------------------------------------
  // 7b. Follow-up task ownership (#470).
  //
  // The lens Bryan objected to hardest, and the one the corpus could not
  // exercise at all: the seeder wrote no `tasks` rows, so `distinctOwnerCount`
  // and `planterOwnedCount` were 0 everywhere and "who carries follow-up" had
  // no measured answer to give — exactly the state in which v0 guessed.
  //
  // An owner counts only if their user has a linked person row whose CURRENT
  // status is committed. So each owner needs a person, and that person must be
  // a SEPARATE row from the core group: linking `persons.user_id` excludes
  // somebody from `getPersonSources` and `getLeadershipCandidates`, both of
  // which read recruited contacts only.
  // ------------------------------------------------------------------
  if (profile.followUpOwnership && followUpPersonIds.length > 0) {
    const spec = profile.followUpOwnership;

    // The planter's own account needs a committed person to be a valid owner —
    // the planter PERSON row seeded in step 8 is a `prospect` on purpose and
    // must stay one, or Genesis stops being a cold start.
    await db.insert(persons).values({
      churchId,
      firstName: "Planter",
      lastName: `${profile.key}-account`,
      status: "core_group",
      userId: ownerUserId,
      createdBy: ownerUserId,
      createdAt: daysAgo(365),
      updatedAt: daysAgo(2),
    });

    const memberOwnerIds: string[] = [];
    for (let i = 0; i < spec.memberOwnerCount; i++) {
      const [member] = await db
        .insert(users)
        .values({
          email: `member-${i}-${profile.key}@${EVAL_EMAIL_DOMAIN}`,
          name: `EVAL Member ${i + 1} (${profile.key})`,
          seat: "member",
          passwordHash: await hashPassword(EVAL_PASSWORD),
          churchId,
        })
        .returning({ id: users.id });

      // The LAST member is demoted out of the committed set when the profile
      // asks for it, so the tasks they hold read unowned again.
      const demoted = spec.demoteOneOwner && i === spec.memberOwnerCount - 1;
      await db.insert(persons).values({
        churchId,
        firstName: "Member",
        lastName: `${profile.key}-${i}`,
        status: demoted ? "attendee" : "core_group",
        userId: member.id,
        createdBy: ownerUserId,
        createdAt: daysAgo(180),
        updatedAt: daysAgo(4),
      });
      memberOwnerIds.push(member.id);
    }

    const taskRows: (typeof tasks.$inferInsert)[] = [];
    for (let t = 0; t < spec.taskCount; t++) {
      const contactId = followUpPersonIds[t % followUpPersonIds.length];
      const assignedToId =
        t < spec.planterOwnedTaskCount
          ? ownerUserId
          : memberOwnerIds.length > 0
            ? memberOwnerIds[
                (t - spec.planterOwnedTaskCount) % memberOwnerIds.length
              ]
            : null;
      taskRows.push({
        churchId,
        title: `Follow up with lead ${t + 1}`,
        status: "not_started",
        category: "follow_up",
        relatedType: "person",
        relatedId: contactId,
        assignedToId,
        createdById: ownerUserId,
      });
    }
    if (taskRows.length > 0) {
      await db.insert(tasks).values(taskRows);
    }
  }

  // ------------------------------------------------------------------
  // 7c. Recorded human judgments — interviews and 4 C's (#476).
  //
  // The engine may CITE these and may never make one. With none recorded the
  // only honest line is "no interview recorded yet — the next step", so the
  // corpus needs both states, and it had only the empty one.
  // ------------------------------------------------------------------
  if (committedPersonIds.length > 0) {
    if (profile.interviews.length > 0) {
      await db.insert(interviews).values(
        profile.interviews.map((spec, i) => ({
          churchId,
          personId: committedPersonIds[i % committedPersonIds.length],
          interviewedBy: ownerUserId,
          interviewDate: dateOnlyAgo(spec.daysAgo),
          maturityStatus: "pass" as const,
          giftedStatus: "pass" as const,
          chemistryStatus: "pass" as const,
          rightReasonsStatus:
            spec.result === "not_qualified"
              ? ("fail" as const)
              : ("pass" as const),
          seasonStatus:
            spec.result === "follow_up"
              ? ("concern" as const)
              : ("pass" as const),
          overallResult: spec.result,
        }))
      );
    }

    if (profile.fourCs.length > 0) {
      await db.insert(assessments).values(
        profile.fourCs.map((spec, i) => {
          const [committedScore, compelled, contagious, courageous] =
            spec.scores;
          return {
            churchId,
            personId: committedPersonIds[i % committedPersonIds.length],
            assessedBy: ownerUserId,
            committedScore,
            compelledScore: compelled,
            contagiousScore: contagious,
            courageousScore: courageous,
            totalScore: spec.scores.reduce((a, b) => a + b, 0),
            assessmentDate: dateOnlyAgo(spec.daysAgo),
          };
        })
      );
    }
  }

  // ------------------------------------------------------------------
  // 7d. Weekly planter check-ins (#484) — SEEDED TO BE PROVEN ABSENT.
  //
  // Nothing in the assessment pipeline reads `planter_checkins` and nothing
  // may: a plant can hit every launch metric while the planter is falling
  // apart, and the engine is barred from claiming either direction. Freefall
  // deliberately carries the fleet's most concerning answers WHILE reading as
  // a launch-readiness problem, so the verifier's negative assertion has
  // something real to fail on.
  // ------------------------------------------------------------------
  if (profile.checkins.length > 0) {
    await db.insert(planterCheckins).values(
      profile.checkins.map((spec) => ({
        churchId,
        weekStart: mondayOfWeeksAgo(spec.weeksAgo),
        spiritually: spec.spiritually,
        marriageFamily: spec.marriageFamily,
        financially: spec.financially,
        pace: spec.pace,
        answeredById: ownerUserId,
      }))
    );
  }

  // ------------------------------------------------------------------
  // 8. The planter person (always present, even for cold-start Genesis).
  //    Status is `prospect` deliberately: prospect is neither a follow-up nor a
  //    leadership-candidate status, so the planter never perturbs any signal —
  //    critical for Genesis, whose isColdStart must stay true.
  // ------------------------------------------------------------------
  await db.insert(persons).values({
    churchId,
    firstName: "Planter",
    lastName: profile.key,
    status: "prospect",
    source: "other",
    createdBy: ownerUserId,
    createdAt: daysAgo(365),
    updatedAt: daysAgo(2),
  });

  return churchId;
}

// ============================================================================
// Oversight sharing postures (church_privacy_settings)
//
// The oversight read path (lib/phase-engine/oversight/read.ts) gates every
// NETWORK-audience insight on the church's `share_*` toggle for the feature the
// insight's rubric category derives from. A church with NO settings row shares
// nothing — so without this, the whole Plant Health surface renders as
// "has not shared detailed data" and no insight is ever exercised.
//
// The postures are deliberately a SPREAD, not all-on: the interesting property
// to review is the gradient, including that withheld content genuinely stays
// withheld. Assignments are chosen so each posture is observable:
//   - full    : `wanderer` (a high-severity people insight → flips the plant to
//               "Readiness focus") and `cornerstone` (medium → "Worth a look",
//               the posture no plant currently exercises).
//   - partial : `hollow` shares people but NOT ministry_teams, so its
//               critical_mass observation shows while its training one stays
//               hidden — the clearest proof the per-category gate works.
//   - none    : `genesis` shares nothing yet its only network insight is
//               `phase_progress` (an ungated category), so it must STILL render
//               — the regression the read-layer fix addresses.
// ============================================================================

type SharingPosture = "full" | "partial" | "none";

/** Column values per posture. `partial` = people-derived data only. */
const POSTURE_TOGGLES: Record<
  SharingPosture,
  {
    sharePeople: boolean;
    shareMeetings: boolean;
    shareTasks: boolean;
    shareFinancials: boolean;
    shareMinistryTeams: boolean;
    shareFacilities: boolean;
  }
> = {
  full: {
    sharePeople: true,
    shareMeetings: true,
    shareTasks: true,
    shareFinancials: true,
    shareMinistryTeams: true,
    shareFacilities: true,
  },
  partial: {
    sharePeople: true,
    shareMeetings: false,
    shareTasks: false,
    shareFinancials: false,
    shareMinistryTeams: false,
    shareFacilities: false,
  },
  none: {
    sharePeople: false,
    shareMeetings: false,
    shareTasks: false,
    shareFinancials: false,
    shareMinistryTeams: false,
    shareFacilities: false,
  },
};

/** Posture per profile key. Every profile MUST appear (asserted at seed time). */
const SHARING_POSTURE: Record<string, SharingPosture> = {
  cornerstone: "full",
  wanderer: "full",
  lighthouse: "full",
  ember: "full",

  beacon: "partial",
  drift: "partial",
  hollow: "partial",
  evergreen: "partial",

  genesis: "none",
  summit: "none",
  freefall: "none",
  dayspring: "none",
};

/**
 * Upsert the sharing posture for each seeded church. Idempotent via the
 * `church_privacy_settings_church_id_unique` constraint, so this is safe to
 * re-run over an existing corpus (`--privacy-only`).
 */
async function seedPrivacySettings(
  seeded: { profileKey: string; churchId: string }[]
): Promise<void> {
  console.log("🔒 Applying oversight sharing postures…");

  const missing = seeded.filter((s) => !(s.profileKey in SHARING_POSTURE));
  if (missing.length > 0) {
    throw new Error(
      `No sharing posture defined for: ${missing.map((m) => m.profileKey).join(", ")}`
    );
  }

  const counts: Record<SharingPosture, number> = {
    full: 0,
    partial: 0,
    none: 0,
  };

  for (const { profileKey, churchId } of seeded) {
    const posture = SHARING_POSTURE[profileKey];
    counts[posture] += 1;

    await db
      .insert(churchPrivacySettings)
      .values({ churchId, ...POSTURE_TOGGLES[posture], updatedAt: daysAgo(3) })
      .onConflictDoUpdate({
        target: churchPrivacySettings.churchId,
        set: { ...POSTURE_TOGGLES[posture], updatedAt: daysAgo(3) },
      });
  }

  console.log(
    `   ${counts.full} share all · ${counts.partial} share people only · ${counts.none} share nothing\n`
  );
}

// ----------------------------------------------------------------------------
// Shared eval ids (network + sending church), populated during seeding.
// ----------------------------------------------------------------------------

const EVAL_IDS: {
  networkId: string;
  sendingChurchId: string;
} = { networkId: "", sendingChurchId: "" };

async function seedAll(): Promise<SeededChurch[]> {
  console.log("🌱 Seeding Phase Engine eval corpus…\n");

  // Eval network + sending church.
  const [network] = await db
    .insert(sendingNetworks)
    .values({ name: EVAL_NETWORK_NAME })
    .returning({ id: sendingNetworks.id });
  EVAL_IDS.networkId = network.id;

  const [sendingChurch] = await db
    .insert(sendingChurches)
    .values({
      name: EVAL_SENDING_CHURCH_NAME,
      sendingNetworkId: network.id,
    })
    .returning({ id: sendingChurches.id });
  EVAL_IDS.sendingChurchId = sendingChurch.id;

  const passwordHash = await hashPassword(EVAL_PASSWORD);

  // A network admin (oversight) for the whole eval network.
  await db.insert(users).values({
    email: `network-admin@${EVAL_EMAIL_DOMAIN}`,
    name: "EVAL Network Admin",
    seat: "owner",
    passwordHash,
    sendingNetworkId: network.id,
  });

  const seeded: SeededChurch[] = [];

  // Refuse an incoherent fixture BEFORE writing a row, so a bad profile is a
  // startup error rather than a corpus that seeds green and lies afterwards.
  PROFILES.forEach(assertProfileCoherence);

  for (const profile of PROFILES) {
    // A planter/owner user per church (church_id set after church insert).
    // We create the church first inside seedChurch, then its owner — but the
    // owner is the created_by for church rows, so create the owner up-front
    // with churchId attached afterward. Simplest: create owner without church,
    // seed church (using owner id), then patch owner.churchId.
    const [owner] = await db
      .insert(users)
      .values({
        email: `planter-${profile.key}@${EVAL_EMAIL_DOMAIN}`,
        name: `EVAL Planter (${profile.key})`,
        seat: "owner",
        passwordHash,
        // NO TENANCY FKs BUT THE CHURCH'S (#185). A planter owns their PLANT;
        // they are not an owner of the sending network or the sending church.
        // Carrying `sending_network_id` here made all 12 planters owners of one
        // network, which `users_sending_network_owner_unique_idx` — the DB's
        // one-Owner-per-tenancy rule — refuses outright, so the corpus could
        // not be reseeded at all. The ASSOCIATION lives on `churches`, which is
        // what every oversight read actually follows.
      })
      .returning({ id: users.id });

    const churchId = await seedChurch(profile, owner.id);

    await db.update(users).set({ churchId }).where(eq(users.id, owner.id));

    seeded.push({ profile, churchId });
    console.log(`   [Phase ${profile.currentPhase}] ${profile.name}`);
  }

  console.log("");
  await seedPrivacySettings(
    seeded.map((s) => ({ profileKey: s.profile.key, churchId: s.churchId }))
  );

  console.log("✅ Seed complete.\n");
  return seeded;
}

// ============================================================================
// Verification — run the Signal layer for every church and print the spectrum
// ============================================================================

function pad(value: string | number, width: number): string {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

// ============================================================================
// The v1 signal verifier (#538)
//
// WHY THIS EXISTS, in one sentence: a seeded row no reader sees is invisible,
// and the corpus shipped for months with `financial_base` written into
// `plant_signals` while every reader looked for `financial_base_established` —
// so Generosity read "unknown" fleet-wide and the summary table above said
// nothing was wrong, because it never asked.
//
// Every expectation below is DERIVED FROM THE PROFILE, never restated, so the
// matrix has one spelling. And the fleet-level pass at the end is the part that
// catches the subtler failure: a signal that is uniformly non-trivial, or
// uniformly zero, is a signal the corpus cannot actually exercise.
// ============================================================================

interface Failure {
  church: string;
  what: string;
  expected: string;
  actual: string;
}

async function verifyV1Signals(seeded: SeededChurch[]): Promise<void> {
  console.log(
    "🔬 v1 signal verification — every new lens, against buildFactSnapshot(NOW):\n"
  );

  const { buildFactSnapshot } = await import("../src/lib/phase-engine/signals");
  const failures: Failure[] = [];
  const rows: string[] = [];

  // Fleet-level tallies: each signal must have BOTH a non-trivial church and a
  // trivial/unknown one, or the corpus has no gradient to test against.
  const nonTrivial: Record<string, string[]> = {};
  const trivial: Record<string, string[]> = {};
  const note = (bucket: Record<string, string[]>, key: string, who: string) => {
    (bucket[key] ??= []).push(who);
  };

  for (const { profile, churchId } of seeded) {
    const snap = await buildFactSnapshot(churchId, { asOf: NOW });
    // Key order is not part of the value: `sourceComposition` is a count per
    // source, and the order Postgres happens to return them in is not a fact
    // about the plant. Sorting before comparing keeps the check about counts.
    const stable = (v: unknown): string =>
      JSON.stringify(v, (_k, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).sort(
                ([a], [b]) => a.localeCompare(b)
              )
            )
          : value
      );
    const check = (what: string, expected: unknown, actual: unknown) => {
      if (stable(expected) !== stable(actual)) {
        failures.push({
          church: profile.key,
          what,
          expected: stable(expected),
          actual: stable(actual),
        });
      }
    };

    // ---- 1. The stall clock (#471) --------------------------------------
    check(
      "coreGroup.daysSinceLastNewCommitment",
      profile.daysSinceLastCommitment,
      snap.coreGroup.daysSinceLastNewCommitment
    );
    const stall = snap.coreGroup.daysSinceLastNewCommitment;
    note(
      stall !== null && stall >= 21 ? nonTrivial : trivial,
      "stall clock ≥21d",
      profile.key
    );

    // ---- 2. Source composition (#487) -----------------------------------
    const expectedComposition: Record<string, number> = {};
    let expectedUnknownSources = 0;
    for (const slice of profile.sourceMix) {
      if (slice.source === null) expectedUnknownSources += slice.count;
      else
        expectedComposition[slice.source] =
          (expectedComposition[slice.source] ?? 0) + slice.count;
    }
    check(
      "coreGroup.sourceComposition",
      expectedComposition,
      snap.coreGroup.sourceComposition
    );
    check(
      "coreGroup.unknownSourceCount",
      expectedUnknownSources,
      snap.coreGroup.unknownSourceCount
    );
    note(
      Object.keys(expectedComposition).length > 1 ? nonTrivial : trivial,
      "source mix >1 value",
      profile.key
    );
    note(
      expectedUnknownSources > 0 ? nonTrivial : trivial,
      "unrecorded sources",
      profile.key
    );

    // ---- 3. Follow-up warmth split (#486) -------------------------------
    const expectedWarm = profile.followUpMix
      .filter((s) => s.warm)
      .reduce((n, s) => n + s.count, 0);
    check("followUp.warmCount", expectedWarm, snap.followUp.warmCount);
    const expectedStaleWarm = profile.followUpMix
      .filter((s) => s.warm && s.idleDays >= 7)
      .reduce((n, s) => n + s.count, 0);
    check(
      "followUp.staleWarmCount",
      expectedStaleWarm,
      snap.followUp.staleWarmCount
    );
    const expectedStaleCold = profile.followUpMix
      .filter((s) => !s.warm && s.idleDays >= 14)
      .reduce((n, s) => n + s.count, 0);
    check(
      "followUp.staleColdCount",
      expectedStaleCold,
      snap.followUp.staleColdCount
    );
    note(
      expectedStaleWarm > 0 ? nonTrivial : trivial,
      "stale WARM",
      profile.key
    );
    note(
      expectedStaleCold > 0 ? nonTrivial : trivial,
      "stale COLD",
      profile.key
    );

    // ---- 4. Follow-up ownership (#470) ----------------------------------
    const own = profile.followUpOwnership;
    const expectedDistinctOwners = own
      ? (own.planterOwnedTaskCount > 0 ? 1 : 0) +
        Math.max(0, own.memberOwnerCount - (own.demoteOneOwner ? 1 : 0))
      : 0;
    check(
      "followUp.distinctOwnerCount",
      expectedDistinctOwners,
      snap.followUp.distinctOwnerCount
    );
    check(
      "followUp.planterOwnedCount",
      own?.planterOwnedTaskCount ?? 0,
      snap.followUp.planterOwnedCount
    );
    note(
      expectedDistinctOwners > 0 ? nonTrivial : trivial,
      "ownership measured",
      profile.key
    );

    // ---- 5. Cohesion / disengagement (#486) -----------------------------
    check(
      "cohesion.disengagedCount",
      profile.disengagement.disengagedCount,
      snap.cohesion.disengagedCount
    );
    check(
      "cohesion.disengagedIncludesLeader",
      profile.disengagement.includesLeader,
      snap.cohesion.disengagedIncludesLeader
    );
    note(
      profile.disengagement.disengagedCount > 0 ? nonTrivial : trivial,
      "disengagement",
      profile.key
    );
    note(
      profile.disengagement.includesLeader ? nonTrivial : trivial,
      "disengaged leader",
      profile.key
    );

    // ---- 6. Attestations, values AND ages (#474 / #475) -----------------
    for (const [key, spec] of Object.entries(profile.signals) as [
      ManualSignalKey,
      AttestationSpec,
    ][]) {
      check(`manual.byKey.${key}`, spec.value, snap.manual.byKey[key]);
      const attestation = snap.manual.attestations.find(
        (a) => a.signalKey === key
      );
      check(
        `manual.${key}.attestedDaysAgo`,
        spec.attestedDaysAgo,
        attestation?.attestedDaysAgo
      );
    }
    const staleAttestations = Object.values(profile.signals).filter(
      (s) => s.attestedDaysAgo > 30
    ).length;
    note(
      staleAttestations > 0 ? nonTrivial : trivial,
      "stale attestation",
      profile.key
    );

    // ---- 7. Evidence quality, incl. the unknown pole (#483) -------------
    const prayerAnswered =
      profile.signals.prayer_rhythm_established !== undefined ||
      profile.signals.prayer_in_gatherings !== undefined;
    check(
      "evidence.prayer.quality",
      prayerAnswered ? "attested" : "unknown",
      snap.evidence?.prayer.quality
    );
    const givingAnswered =
      profile.signals.core_group_giving !== undefined ||
      profile.signals.financial_base_established !== undefined;
    check(
      "evidence.generosity.quality",
      givingAnswered ? "attested" : "unknown",
      snap.evidence?.generosity.quality
    );
    note(prayerAnswered ? nonTrivial : trivial, "prayer attested", profile.key);
    note(givingAnswered ? nonTrivial : trivial, "giving attested", profile.key);

    // ---- 8. Recorded human judgments (#476) -----------------------------
    const candidatesWithInterview = snap.leadership.candidates.filter(
      (c) => c.interviewCount > 0
    ).length;
    const candidatesWithFourCs = snap.leadership.candidates.filter(
      (c) => c.assessmentCount > 0
    ).length;
    if (profile.interviews.length > 0 && candidatesWithInterview === 0) {
      failures.push({
        church: profile.key,
        what: "leadership interviews reach a candidate",
        expected: `${profile.interviews.length} recorded`,
        actual: "no candidate carries an interview",
      });
    }
    note(
      candidatesWithInterview > 0 ? nonTrivial : trivial,
      "interview recorded",
      profile.key
    );
    note(
      candidatesWithFourCs > 0 ? nonTrivial : trivial,
      "4 C's recorded",
      profile.key
    );

    // ---- 9. THE NEGATIVE: check-ins never reach the snapshot (§5c) ------
    // Freefall carries the fleet's most concerning answers. If any of this
    // leaks into the fact snapshot, the judge can read the planter's own state
    // off it — the one thing #484 exists to make impossible.
    const snapshotText = JSON.stringify(snap).toLowerCase();
    for (const needle of [
      "checkin",
      "check_in",
      "spiritually",
      "marriage",
      "struggling",
      "strained",
    ]) {
      if (snapshotText.includes(needle)) {
        failures.push({
          church: profile.key,
          what: `planter check-in leaked into the fact snapshot ("${needle}")`,
          expected: "absent",
          actual: "present",
        });
      }
    }

    rows.push(
      [
        pad(profile.key, 12),
        pad(snap.coreGroup.daysSinceLastNewCommitment ?? "—", 6),
        pad(
          `${Object.keys(snap.coreGroup.sourceComposition).length}src/${snap.coreGroup.unknownSourceCount}?`,
          10
        ),
        pad(
          `${snap.followUp.warmCount}w/${snap.followUp.staleWarmCount}sw/${snap.followUp.staleColdCount}sc`,
          14
        ),
        pad(
          `${snap.followUp.distinctOwnerCount}own/${snap.followUp.planterOwnedCount}pl`,
          12
        ),
        pad(
          `${snap.cohesion.disengagedCount}${snap.cohesion.disengagedIncludesLeader ? "+L" : ""}`,
          6
        ),
        pad(snap.evidence?.prayer.quality ?? "—", 10),
        pad(snap.evidence?.generosity.quality ?? "—", 10),
      ].join(" ")
    );
  }

  const header = [
    pad("Church", 12),
    pad("Stall", 6),
    pad("Sources", 10),
    pad("FollowUp", 14),
    pad("Ownership", 12),
    pad("Diseng", 6),
    pad("Prayer", 10),
    pad("Giving", 10),
  ].join(" ");
  console.log(header);
  console.log("─".repeat(header.length));
  rows.forEach((r) => console.log(r));
  console.log(
    "\nStall=days since last new commitment  Sources=distinct/unrecorded  " +
      "FollowUp=warm/staleWarm/staleCold\nOwnership=distinctOwners/planterOwned  " +
      "Diseng=disengaged(+L = includes a leader)  Prayer,Giving=evidence quality\n"
  );

  // ---- Fleet coverage: both poles must exist for every signal ------------
  console.log("Fleet coverage — each signal needs a plant at BOTH poles:\n");
  let coverageGaps = 0;
  for (const key of Object.keys({ ...nonTrivial, ...trivial }).sort()) {
    const hot = nonTrivial[key] ?? [];
    const cold = trivial[key] ?? [];
    const ok = hot.length > 0 && cold.length > 0;
    if (!ok) coverageGaps++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${pad(key, 22)} exercised by ${pad(hot.length, 3)} · absent in ${pad(cold.length, 3)}` +
        (ok
          ? ""
          : `   ← NO GRADIENT (${hot.length ? "never absent" : "never exercised"})`)
    );
  }

  if (failures.length > 0) {
    console.log(`\n❌ ${failures.length} signal mismatch(es):\n`);
    for (const f of failures) {
      console.log(`  ${f.church} · ${f.what}`);
      console.log(`      expected ${f.expected}`);
      console.log(`      actual   ${f.actual}`);
    }
  }

  if (failures.length > 0 || coverageGaps > 0) {
    console.log(
      `\n❌ v1 signal verification FAILED — ${failures.length} mismatch(es), ${coverageGaps} coverage gap(s).\n`
    );
    process.exit(1);
  }
  console.log("\n✅ v1 signal verification passed for all 12 churches.\n");
}

async function verify(seeded: SeededChurch[]): Promise<void> {
  console.log(
    "🔎 Verification — buildFactSnapshot(asOf = NOW) for every eval church:\n"
  );

  // Imported here (not at top) so `config()` has populated DATABASE_URL before
  // the transitively-imported `@/db` module initializes its connection.
  const { buildFactSnapshot } = await import("../src/lib/phase-engine/signals");

  const header = [
    pad("Church", 22),
    pad("Ph", 3),
    pad("Cold", 5),
    pad("Cmt", 4),
    pad("Δ", 4),
    pad("Roles", 6),
    pad("Train", 6),
    pad("Launch", 7),
    pad("Trend", 6),
  ].join(" ");
  console.log(header);
  console.log("─".repeat(header.length));

  for (const { profile, churchId } of seeded) {
    const snap = await buildFactSnapshot(churchId, { asOf: NOW });

    const trainPct =
      snap.training.requiredCompletionRate === null
        ? "—"
        : `${Math.round(snap.training.requiredCompletionRate * 100)}%`;

    const launch =
      snap.launch.daysUntilLaunch === null
        ? "—"
        : `${snap.launch.daysUntilLaunch}d`;

    const row = [
      pad(profile.name.slice(0, 22), 22),
      pad(snap.currentPhase, 3),
      pad(snap.isColdStart ? "yes" : "no", 5),
      pad(snap.coreGroup.committedCount, 4),
      pad(snap.coreGroup.growthDelta ?? "—", 4),
      pad(`${snap.ministryRoles.filledCount}/8`, 6),
      pad(trainPct, 6),
      pad(launch, 7),
      pad(snap.visionMeetings.attendanceTrend ?? "—", 6),
    ].join(" ");
    console.log(row);
  }

  console.log("\nLegend: Ph=phase  Cmt=committedCount  Δ=growthDelta  ");
  console.log(
    "Roles=rolesFilled/8  Train=requiredCompletionRate  Launch=daysUntilLaunch  Trend=attendanceTrend\n"
  );
}

// ============================================================================
// Main
// ============================================================================

/**
 * Resolve already-seeded eval churches by matching profile names, so sharing
 * postures can be applied without a destructive clean-and-reseed.
 */
async function applyPrivacyToExistingCorpus(): Promise<void> {
  const names = PROFILES.map((p) => p.name);
  const rows = await db
    .select({ id: churches.id, name: churches.name })
    .from(churches)
    .where(inArray(churches.name, names));

  const byName = new Map(rows.map((r) => [r.name, r.id]));
  const resolved = PROFILES.flatMap((p) => {
    const churchId = byName.get(p.name);
    return churchId ? [{ profileKey: p.key, churchId }] : [];
  });

  if (resolved.length === 0) {
    console.log("   No seeded eval churches found — run the seed first.\n");
    return;
  }
  if (resolved.length < PROFILES.length) {
    console.log(
      `   ⚠️  Only ${resolved.length}/${PROFILES.length} eval churches present.`
    );
  }

  await seedPrivacySettings(resolved);
}

async function main(): Promise<void> {
  try {
    if (privacyOnly) {
      await applyPrivacyToExistingCorpus();
      console.log("✅ Sharing postures applied (no other data touched).");
      process.exit(0);
    }

    if (verifyOnly) {
      // Re-attach the in-memory profiles to the churches already on disk, by
      // name, so the assertions read the same matrix without a reseed.
      const existing = await db
        .select({ id: churches.id, name: churches.name })
        .from(churches)
        .where(
          inArray(
            churches.name,
            PROFILES.map((p) => p.name)
          )
        );
      const byName = new Map(existing.map((c) => [c.name, c.id]));
      const missing = PROFILES.filter((p) => !byName.has(p.name));
      if (missing.length > 0) {
        console.error(
          `❌ ${missing.length} eval church(es) are not in the database — seed first.`
        );
        process.exit(1);
      }
      await verifyV1Signals(
        PROFILES.map((profile) => ({
          profile,
          churchId: byName.get(profile.name)!,
        }))
      );
      process.exit(0);
    }

    await cleanEvalData();

    if (cleanOnly) {
      console.log("✅ Clean-only run complete.");
      process.exit(0);
    }

    const seeded = await seedAll();
    await verify(seeded);
    await verifyV1Signals(seeded);

    console.log("✅ Phase Engine eval seed finished.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
