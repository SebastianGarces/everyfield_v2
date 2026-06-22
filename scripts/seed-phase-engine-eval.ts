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
 */

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import {
  churches,
  churchMeetings,
  commitments,
  meetingAttendance,
  ministryTeams,
  persons,
  plantSignals,
  sendingChurches,
  sendingNetworks,
  teamMemberships,
  teamRoles,
  trainingCompletions,
  trainingPrograms,
  users,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(connectionString);
const db = drizzle(sql);

// ----------------------------------------------------------------------------
// Eval namespace markers (used for scoped cleanup)
// ----------------------------------------------------------------------------

const EVAL_NETWORK_NAME = "EVAL — Phase Engine";
const EVAL_SENDING_CHURCH_NAME = "EVAL — Sending Church";
const EVAL_EMAIL_DOMAIN = "eval.phase-engine.everyfield.dev";
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
  /** true → all follow-ups backdated past the 14d stale threshold. */
  followUpsStale: boolean;

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

  // ---- manual attestations ----
  signals: Record<string, boolean>;

  /** Human note explaining the spectrum point (for the summary). */
  note: string;
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
    attendanceSeries: [],
    meetingCadenceDays: 0,
    followUpCount: 0,
    followUpsStale: false,
    rolesFilled: 0,
    rolesPresentUnfilled: 0,
    trainingRate: null,
    strongLeaders: 0,
    signals: {},
    note: "PE-018 cold-start: only the planter exists, no activity anywhere.",
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
    attendanceSeries: [8, 12, 15, 18],
    meetingCadenceDays: 21,
    followUpCount: 12,
    followUpsStale: false,
    rolesFilled: 1,
    rolesPresentUnfilled: 0,
    trainingRate: 0.15,
    strongLeaders: 1,
    signals: { values_documented: true },
    note: "Healthy early growth, rising attendance, fresh follow-ups, dirty.",
  },
  {
    key: "wanderer",
    name: "EVAL-03 Wanderer (stalled early)",
    currentPhase: 1,
    launchOffsetDays: 500,
    lastMaterialEventDaysAgo: 45,
    coreGroupCount: 7,
    launchTeamCount: 0,
    growthDelta: 0,
    attendanceSeries: [20, 11],
    meetingCadenceDays: 30,
    followUpCount: 8,
    followUpsStale: true,
    rolesFilled: 0,
    rolesPresentUnfilled: 0,
    trainingRate: null,
    strongLeaders: 0,
    signals: {},
    note: "Watch case: flat growth, attendance crash, all follow-ups stale, quiet.",
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
    attendanceSeries: [34, 35, 35, 36],
    meetingCadenceDays: 21,
    followUpCount: 10,
    followUpsStale: false,
    rolesFilled: 5,
    rolesPresentUnfilled: 0,
    trainingRate: 0.4,
    strongLeaders: 4,
    signals: { financial_base: true, values_documented: true },
    note: "On-track: steady cadence, flat-high attendance, 5/8 roles, dirty.",
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
    attendanceSeries: [30, 28, 25, 22],
    meetingCadenceDays: 24,
    followUpCount: 9,
    followUpsStale: true,
    rolesFilled: 4,
    rolesPresentUnfilled: 0,
    trainingRate: 0.2,
    strongLeaders: 2,
    signals: { values_documented: true },
    note: "Mixed: flat growth, attendance sliding, moderate follow-up staleness.",
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
    attendanceSeries: [48, 50, 52, 55],
    meetingCadenceDays: 18,
    followUpCount: 8,
    followUpsStale: false,
    rolesFilled: 7,
    rolesPresentUnfilled: 0,
    trainingRate: 0.78,
    strongLeaders: 6,
    signals: { financial_base: true, systems_tested: false },
    note: "Strong: 7/8 roles, training ~78%, good cadence, low staleness.",
  },
  {
    key: "hollow",
    name: "EVAL-07 Hollow (claims ahead of reality)",
    currentPhase: 3,
    launchOffsetDays: 100,
    lastMaterialEventDaysAgo: 20,
    coreGroupCount: 11,
    launchTeamCount: 1,
    growthDelta: 0,
    attendanceSeries: [14, 12],
    meetingCadenceDays: 40,
    followUpCount: 5,
    followUpsStale: true,
    rolesFilled: 2,
    rolesPresentUnfilled: 0,
    trainingRate: 0.1,
    strongLeaders: 1,
    signals: {},
    note: "Phase-vs-reality mismatch: phase 3 but thin data the judge should flag.",
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
    attendanceSeries: [70, 74, 78, 82],
    meetingCadenceDays: 14,
    followUpCount: 7,
    followUpsStale: false,
    rolesFilled: 8,
    rolesPresentUnfilled: 0,
    trainingRate: 0.95,
    strongLeaders: 8,
    signals: {
      values_documented: true,
      financial_base: true,
      systems_tested: true,
    },
    note: "Exemplar: 8/8 roles, training ~95%, tight 18d countdown, all signals true.",
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
    attendanceSeries: [40, 34, 28, 22],
    meetingCadenceDays: 28,
    followUpCount: 11,
    followUpsStale: true,
    rolesFilled: 3,
    rolesPresentUnfilled: 0,
    trainingRate: 0.35,
    strongLeaders: 2,
    signals: { financial_base: false },
    note: "CRITICAL readiness gap: 12d out but thin core, 3/8 roles, attendance dropping.",
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
    attendanceSeries: [88, 90, 92, 95],
    meetingCadenceDays: 14,
    followUpCount: 9,
    followUpsStale: false,
    rolesFilled: 8,
    rolesPresentUnfilled: 0,
    trainingRate: 1.0,
    strongLeaders: 8,
    signals: {
      values_documented: true,
      financial_base: true,
      systems_tested: true,
    },
    note: "Just launched (launchDate -5d): full roles, training 100%.",
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
    attendanceSeries: [82, 86, 88, 90],
    meetingCadenceDays: 14,
    followUpCount: 10,
    followUpsStale: false,
    rolesFilled: 8,
    rolesPresentUnfilled: 0,
    trainingRate: 0.85,
    strongLeaders: 8,
    signals: {
      values_documented: true,
      financial_base: true,
      systems_tested: true,
    },
    note: "Thriving post-launch (launched 120d ago): sustained high attendance.",
  },
  {
    key: "ember",
    name: "EVAL-12 Ember (struggling post-launch)",
    currentPhase: 6,
    launchOffsetDays: -100,
    lastMaterialEventDaysAgo: 25,
    coreGroupCount: 60,
    launchTeamCount: 30,
    growthDelta: -3,
    attendanceSeries: [90, 55, 40],
    meetingCadenceDays: 21,
    followUpCount: 9,
    followUpsStale: true,
    // 2 of the would-be-filled roles are vacated (leaderId nulled), so the
    // intended filled count is reduced by 2 from a 6-role baseline → 4.
    rolesFilled: 4,
    rolesPresentUnfilled: 2,
    trainingRate: 0.6,
    strongLeaders: 4,
    signals: { financial_base: true },
    note: "Post-launch decline: attendance crash, 2 vacated leaders, stale follow-ups.",
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

  // Eval users (planter per church + network admin) — matched by email domain.
  const evalUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users);
  const evalUserIds = evalUsers
    .filter((u) => u.email.endsWith(`@${EVAL_EMAIL_DOMAIN}`))
    .map((u) => u.id);
  if (evalUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, evalUserIds));
  }

  if (churchIds.length > 0) {
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
      launchDate:
        profile.launchOffsetDays === null
          ? null
          : launchInDays(profile.launchOffsetDays),
      lastMaterialEventAt:
        profile.lastMaterialEventDaysAgo === null
          ? null
          : daysAgo(profile.lastMaterialEventDaysAgo),
    })
    .returning({ id: churches.id });

  const churchId = church.id;

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
  // ------------------------------------------------------------------
  const committedPersonIds: string[] = [];
  if (profile.coreGroupCount > 0) {
    // PRIOR_BASE is the count of first-commitments landing in the prior 28d
    // window. It must be large enough that `inWindow = PRIOR_BASE + delta` is
    // non-negative even for negative deltas, so the SIGNED delta is realized
    // exactly (inWindow − PRIOR_BASE === growthDelta).
    const PRIOR_BASE = Math.max(2, -profile.growthDelta);
    const inWindow = PRIOR_BASE + profile.growthDelta; // ≥ 0 by construction
    const total = profile.coreGroupCount;

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
        source: "vision_meeting",
        createdBy: ownerUserId,
        createdAt: daysAgo(signedDaysAgo + 30),
        updatedAt: daysAgo(signedDaysAgo),
      });
      // person id assigned after insert; we re-link below via index.
    };

    // Prior-window first-commitments (≈ 42 days ago: inside [28,56)).
    for (let i = 0; i < PRIOR_BASE; i++) addCommitted(42);
    // In-window first-commitments (≈ 10 days ago: inside (0,28]).
    for (let i = 0; i < inWindow; i++) addCommitted(10);
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
        ...Array(PRIOR_BASE).fill(42),
        ...Array(inWindow).fill(10),
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
  if (profile.followUpCount > 0) {
    const FOLLOW_STATUSES = [
      "attendee",
      "following_up",
      "interviewed",
    ] as const;
    const rows: (typeof persons.$inferInsert)[] = [];
    for (let i = 0; i < profile.followUpCount; i++) {
      const updatedDaysAgo = profile.followUpsStale ? 30 + i : 3;
      rows.push({
        churchId,
        firstName: "Lead",
        lastName: `${profile.key}-${i}`,
        status: FOLLOW_STATUSES[i % FOLLOW_STATUSES.length],
        source: "personal_referral",
        createdBy: ownerUserId,
        createdAt: daysAgo(updatedDaysAgo + 20),
        updatedAt: daysAgo(updatedDaysAgo),
      });
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
      const attendeeCount = Math.min(
        committedPersonIds.length,
        Math.max(0, Math.min(profile.attendanceSeries[m], 6))
      );
      if (attendeeCount > 0) {
        const attendanceRows: (typeof meetingAttendance.$inferInsert)[] = [];
        for (let a = 0; a < attendeeCount; a++) {
          attendanceRows.push({
            churchId,
            meetingId: meeting.id,
            personId: committedPersonIds[a],
            attendanceType: "core_group",
            status: "attended",
            createdBy: ownerUserId,
          });
        }
        await db.insert(meetingAttendance).values(attendanceRows);
      }
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

    const [role] = await db
      .insert(teamRoles)
      .values({
        churchId,
        teamId: hostTeam.id,
        name: "Core Leader",
        isLeadershipRole: true,
        status: "filled",
        createdBy: ownerUserId,
      })
      .returning({ id: teamRoles.id });

    const membershipRows: (typeof teamMemberships.$inferInsert)[] = [];
    for (
      let i = 0;
      i < Math.min(profile.strongLeaders, committedPersonIds.length);
      i++
    ) {
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
  const signalEntries = Object.entries(profile.signals);
  if (signalEntries.length > 0) {
    await db.insert(plantSignals).values(
      signalEntries.map(([signalKey, value]) => ({
        churchId,
        signalKey,
        value,
        attestedById: ownerUserId,
        attestedAt: daysAgo(10),
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
    role: "network_admin",
    passwordHash,
    sendingNetworkId: network.id,
  });

  const seeded: SeededChurch[] = [];

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
        role: "planter",
        passwordHash,
        sendingNetworkId: network.id,
        sendingChurchId: sendingChurch.id,
      })
      .returning({ id: users.id });

    const churchId = await seedChurch(profile, owner.id);

    await db.update(users).set({ churchId }).where(eq(users.id, owner.id));

    seeded.push({ profile, churchId });
    console.log(`   [Phase ${profile.currentPhase}] ${profile.name}`);
  }

  console.log("\n✅ Seed complete.\n");
  return seeded;
}

// ============================================================================
// Verification — run the Signal layer for every church and print the spectrum
// ============================================================================

function pad(value: string | number, width: number): string {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
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

async function main(): Promise<void> {
  try {
    await cleanEvalData();

    if (cleanOnly) {
      console.log("✅ Clean-only run complete.");
      process.exit(0);
    }

    const seeded = await seedAll();
    await verify(seeded);

    console.log("✅ Phase Engine eval seed finished.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
