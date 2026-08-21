import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { inList } from "./sql";
import { users } from "./user";

// ============================================================================
// Phase Engine (Plant Intelligence) — feature-owned schema
//
// Two non-negotiable layers (FRD §1 "facts vs. judgment"):
//   - Signal layer  : deterministic facts computed from the DB at assessment
//                     time. NOT stored here — derived on the fly. The only
//                     facts persisted are the manual attestations the system
//                     cannot observe (`plantSignals`).
//   - Judgment layer: each LLM-as-judge run is persisted as an immutable
//                     point-in-time snapshot (`plantAssessments` + its
//                     `plantInsights`). UI reads the latest snapshot — never
//                     an LLM call on page load.
//
// Tenant isolation (NFR-PE-6): every table is church_id-scoped.
// Auditability (NFR-PE-5): transitions + assessments record the rubric
//   version, fact snapshot, and (for assessments) the model id.
// ============================================================================

// ----------------------------------------------------------------------------
// Enums
// ----------------------------------------------------------------------------

/**
 * Lifecycle of a judge run snapshot.
 *
 * `deferred` AND `failed` ARE BOTH "THE RUN ENDED WITHOUT A JUDGEMENT", AND
 * TELLING THEM APART IS THE POINT (#36 → #376). A plant whose call was refused
 * by the provider for every attempt (`RateLimitDeferralError`) says NOTHING
 * about the health of the judge: the run was throttled, the plant keeps its
 * last good `complete` snapshot, stays dirty and is re-selected on the next
 * run. A plant whose judge answered with something broken is a defect somebody
 * has to look at. `/api/phase-engine/assess` already reports the two apart in
 * its log lines and its run summary (`deferred` vs `failed`, #372); this column
 * is the surface an operator queries AFTERWARDS, when the run's own output is
 * gone, and while both wrote `failed` it was the one place the distinction was
 * lost — which is what made #36 hard to diagnose in the first place.
 *
 * NOTHING TREATS "NOT COMPLETE" AS "FAILED", and nothing may start: every read
 * path selects `status = 'complete'` POSITIVELY (`getLatestAssessment`,
 * `getLatestCompleteSnapshot`, `selectPlantsForAssessment`,
 * `readSnapshotHistory`), so a fourth value changes no selection and no count.
 * A read that wants failures must name `failed`, never `<> 'complete'`.
 */
export const assessmentStatuses = [
  "pending", // selected/queued, judge not yet run
  "complete", // judge run succeeded, insights written
  "failed", // the judge answered and the answer was broken
  "deferred", // throttled out of this run; retried next run, NOT a failure
] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];

/** How a run that produced no judgement ended — the two terminal non-`complete` states. */
export type AssessmentFailureStatus = Extract<
  AssessmentStatus,
  "failed" | "deferred"
>;

/** Who an insight is written for. Network insights are privacy-gated (PE-012). */
export const insightAudiences = ["planter", "network"] as const;
export type InsightAudience = (typeof insightAudiences)[number];

/** Urgency/severity of an insight, used for prioritization + capping. */
export const insightSeverities = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type InsightSeverity = (typeof insightSeverities)[number];

/** Per-insight feedback from planters/coaches — the rubric-tuning signal (PE-014). */
export const insightFeedbackRatings = ["useful", "not_useful"] as const;
export type InsightFeedbackRating = (typeof insightFeedbackRatings)[number];

/**
 * What a phase-history row RECORDS (OB-005).
 *
 *   `transition`          — a move the planter made inside this product.
 *   `initial_declaration` — the planter's own read of where the plant ALREADY
 *                           was when it joined. Exactly one per church, ever,
 *                           enforced by `phase_transitions_initial_declaration_unique_idx`.
 *
 * A STORED DISCRIMINATOR, not a reason string. The first cut of OB-005 marked
 * the declaration by writing a reserved sentence into `reason` and read it back
 * with `reason = '<that sentence>'`. That works right up to the moment the TS
 * constant and a SQL literal drift, and it cannot be indexed safely for the
 * same reason. `kind` is a closed set, defaulted to `transition` so every row
 * that existed before this column says what it always meant, and the partial
 * unique index below is written against it.
 */
export const phaseTransitionKinds = [
  "transition",
  "initial_declaration",
] as const;
export type PhaseTransitionKind = (typeof phaseTransitionKinds)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// PhaseTransition — append-only audit log of phase changes (PE-001/002/003).
//
// Soft-gated: transitions may go forward, backward, or skip, and are never
// blocked. Each row is immutable and captures the fact snapshot + rubric
// version at the moment of transition, so any change can be explained later.
// ----------------------------------------------------------------------------
export const phaseTransitions = pgTable(
  "phase_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    fromPhase: integer("from_phase").notNull(),
    toPhase: integer("to_phase").notNull(),
    initiatedById: uuid("initiated_by_id")
      .references(() => users.id)
      .notNull(),
    reason: text("reason").notNull(),
    /**
     * `transition` (the default) or `initial_declaration` — see
     * `phaseTransitionKinds`. This is the discriminator every reader asks; the
     * `reason` text beside it is display copy.
     */
    kind: varchar("kind", { length: 32 })
      .$type<PhaseTransitionKind>()
      .default("transition")
      .notNull(),
    // Deterministic fact snapshot at the moment of transition (Signal layer).
    factSnapshot: jsonb("fact_snapshot"),
    rubricVersion: varchar("rubric_version", { length: 50 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("phase_transitions_church_id_idx").on(table.churchId),
    index("phase_transitions_church_created_idx").on(
      table.churchId,
      table.createdAt
    ),
    index("phase_transitions_initiated_by_idx").on(table.initiatedById),
    // OB-005: at most ONE initial declaration per plant, ever. This index IS
    // the rule. The statement that writes the row locks the church row first
    // and used to gate the insert on `WHERE NOT EXISTS (… phase_transitions …)`
    // — but that predicate is a SNAPSHOT read of a DIFFERENT table than the one
    // the lock protects, so under READ COMMITTED EvalPlanQual re-checks only
    // `churches` when the waiter unblocks and both submitters pass the check
    // (`memory/invariants/transactions-atomicity.md` → the subquery trap; raced
    // live on #306, 2 of 3 runs wrote a second row claiming a 5 → 3 move the
    // planter never made). The application-side guard is now `ON CONFLICT DO
    // NOTHING` inferred against THIS index, so the loser writes nothing at all
    // — including no phase change.
    uniqueIndex("phase_transitions_initial_declaration_unique_idx")
      .on(table.churchId)
      .where(sql`${table.kind} = 'initial_declaration'`),
    check(
      "phase_transitions_kind_check",
      sql`${table.kind} in (${inList(phaseTransitionKinds)})`
    ),
  ]
);

export type PhaseTransition = typeof phaseTransitions.$inferSelect;
export type NewPhaseTransition = typeof phaseTransitions.$inferInsert;

// ----------------------------------------------------------------------------
// PlantSignal — manual self-attestations the system cannot observe (PE-005).
//
// e.g. "values documented", "financial base in place", "systems tested".
// Computed facts are NEVER stored here. One current value per (church,
// signal_key); upserted, with who/when recorded. Fed into the fact snapshot.
// ----------------------------------------------------------------------------
export const plantSignals = pgTable(
  "plant_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    signalKey: varchar("signal_key", { length: 100 }).notNull(),
    // Flexible attestation value (boolean toggle, string, number) as JSON.
    value: jsonb("value").notNull(),
    attestedById: uuid("attested_by_id")
      .references(() => users.id)
      .notNull(),
    attestedAt: timestamp("attested_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("plant_signals_church_key_idx").on(
      table.churchId,
      table.signalKey
    ),
    index("plant_signals_church_id_idx").on(table.churchId),
  ]
);

export type PlantSignal = typeof plantSignals.$inferSelect;
export type NewPlantSignal = typeof plantSignals.$inferInsert;

// ----------------------------------------------------------------------------
// PlantAssessment — one LLM-as-judge snapshot (PE-007/009).
//
// The latest `complete` row per church drives all planter/oversight reads.
// Records the rubric version, model id, and the exact fact snapshot the judge
// reasoned over, for reproducibility (NFR-PE-5).
// ----------------------------------------------------------------------------
export const plantAssessments = pgTable(
  "plant_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    phase: integer("phase").notNull(),
    rubricVersion: varchar("rubric_version", { length: 50 }).notNull(),
    // The structured Signal-layer facts supplied to the judge.
    factSnapshot: jsonb("fact_snapshot").notNull(),
    // Identifier of the model that produced the judgment (e.g. "gpt-…").
    modelId: varchar("model_id", { length: 100 }),
    status: varchar("status", { length: 20 })
      .$type<AssessmentStatus>()
      .notNull()
      .default("pending"),
    /**
     * WHEN THE PLANTER FIRST OPENED THIS ASSESSMENT (#482, C16/C25).
     *
     * Bryan: "The planter should never discover the diagnosis through his
     * overseer. If the network is being told, 'Core-group momentum has
     * stalled,' the planter should already have been told, 'Your core-group
     * momentum has stalled.'"
     *
     * The rubric asks the judge to pair every network concern with a planter
     * one, which fixes the WORDING. This column fixes the ORDER: an assessment
     * is released to oversight once the planter has seen it — or once 72 hours
     * have passed, so the org that pays per plant is never blocked
     * indefinitely (ledger row 187).
     *
     * NULL means "not opened yet", which is not the same as "not released":
     * release is computed at read time from this column OR the age of
     * `generated_at`, so there is no scheduler and nothing to backfill.
     */
    planterSeenAt: timestamp("planter_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("plant_assessments_church_id_idx").on(table.churchId),
    // "latest snapshot per church" reads (PE-011).
    index("plant_assessments_church_generated_idx").on(
      table.churchId,
      table.generatedAt
    ),
    index("plant_assessments_status_idx").on(table.status),
    // The vocabulary, in the data (#376). `.$type<>()` on a varchar is a
    // compile-time brand and nothing else — same reasoning as 0024/0031/0032/
    // 0033 — so the status an operator queries this table by is closed here
    // rather than by convention. It is what makes `status = 'deferred'` mean
    // "throttled" and not "whatever the last writer happened to spell".
    check(
      "plant_assessments_status_check",
      sql`${table.status} in (${inList(assessmentStatuses)})`
    ),
  ]
);

export type PlantAssessment = typeof plantAssessments.$inferSelect;
export type NewPlantAssessment = typeof plantAssessments.$inferInsert;

// ----------------------------------------------------------------------------
// PlantInsight — one finding within an assessment (PE-009).
//
// Each insight cites the fact(s) that produced it (PE-007) and may link to
// methodology articles surfaced via RAG (PE-008). `audience` gates planter vs.
// network exposure (PE-012). `churchId` is denormalized for tenant-scoped
// queries and privacy gating.
// ----------------------------------------------------------------------------
export const plantInsights = pgTable(
  "plant_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .references(() => plantAssessments.id, { onDelete: "cascade" })
      .notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    audience: varchar("audience", { length: 20 })
      .$type<InsightAudience>()
      .notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    severity: varchar("severity", { length: 20 })
      .$type<InsightSeverity>()
      .notNull()
      .default("info"),
    title: varchar("title", { length: 500 }).notNull(),
    body: text("body").notNull(),
    // The fact(s) from the snapshot that drove this insight (PE-007 / AC-PE-5).
    citedFacts: jsonb("cited_facts"),
    relatedArticleSlugs: text("related_article_slugs").array(),
    // Prioritization rank within the assessment (lower = higher priority).
    rank: integer("rank").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("plant_insights_assessment_id_idx").on(table.assessmentId),
    index("plant_insights_church_id_idx").on(table.churchId),
    index("plant_insights_audience_idx").on(table.audience),
    index("plant_insights_assessment_audience_idx").on(
      table.assessmentId,
      table.audience
    ),
  ]
);

export type PlantInsight = typeof plantInsights.$inferSelect;
export type NewPlantInsight = typeof plantInsights.$inferInsert;

// ----------------------------------------------------------------------------
// InsightFeedback — per-insight rating + optional comment (PE-014 / AC-PE-10).
//
// Retained from day one as the rubric-tuning signal. Denormalizes
// `assessmentId`, `churchId`, and `rubricVersion` so feedback is queryable by
// assessment and rubric version without a join. One current rating per
// (insight, user); upserted.
// ----------------------------------------------------------------------------
export const insightFeedback = pgTable(
  "insight_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .references(() => plantInsights.id, { onDelete: "cascade" })
      .notNull(),
    assessmentId: uuid("assessment_id")
      .references(() => plantAssessments.id, { onDelete: "cascade" })
      .notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    rubricVersion: varchar("rubric_version", { length: 50 }).notNull(),
    rating: varchar("rating", { length: 20 })
      .$type<InsightFeedbackRating>()
      .notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("insight_feedback_insight_user_idx").on(
      table.insightId,
      table.userId
    ),
    index("insight_feedback_insight_id_idx").on(table.insightId),
    index("insight_feedback_assessment_id_idx").on(table.assessmentId),
    index("insight_feedback_church_id_idx").on(table.churchId),
    index("insight_feedback_rubric_version_idx").on(table.rubricVersion),
  ]
);

export type InsightFeedback = typeof insightFeedback.$inferSelect;
export type NewInsightFeedback = typeof insightFeedback.$inferInsert;

// ----------------------------------------------------------------------------
// PlanterCheckin — the planter's own sustainability, weekly (#484, C19).
//
// Bryan: "A plant can hit every launch metric while the planter himself is
// falling apart. Is the planter spiritually healthy? Is his marriage/family
// surviving the process? Is he financially sustainable? Is he building at a
// pace he can actually maintain?"
//
// THIS TABLE IS DELIBERATELY OUTSIDE THE ENGINE. It feeds no signal, no fact
// snapshot, no judge prompt, no insight and no oversight read — and that is a
// structural claim, not a convention: `planter-checkin-privacy.test.ts` sweeps
// the phase-engine and oversight source for any reference to it and fails if
// one appears. The four questions are the most sensitive things this product
// will ever hold, and the answer to "who else sees this" has to be nobody
// rather than nobody-so-far.
//
// PLANTER-ONLY IN V1 (#484 D3). Coach and org sharing is a separate discovery
// issue (#535) with its own consent design. There is no `share_*` toggle for
// this and no oversight column, so there is nothing to turn on by accident.
// ----------------------------------------------------------------------------

/**
 * How a planter is doing on one dimension. Three levels, one tap each (D1) —
 * a five-point scale invites deliberation, and this is a question somebody
 * answers honestly in four seconds or not at all.
 */
export const planterCheckinLevels = [
  "steady",
  "strained",
  "struggling",
] as const;
export type PlanterCheckinLevel = (typeof planterCheckinLevels)[number];

export const planterCheckins = pgTable(
  "planter_checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    /** Monday of the week being answered for, as a date. */
    weekStart: timestamp("week_start", { mode: "string" }).notNull(),
    /** Bryan's four, verbatim and in his order. */
    spiritually: varchar("spiritually", { length: 20 })
      .$type<PlanterCheckinLevel>()
      .notNull(),
    marriageFamily: varchar("marriage_family", { length: 20 })
      .$type<PlanterCheckinLevel>()
      .notNull(),
    financially: varchar("financially", { length: 20 })
      .$type<PlanterCheckinLevel>()
      .notNull(),
    pace: varchar("pace", { length: 20 })
      .$type<PlanterCheckinLevel>()
      .notNull(),
    /** The planter's own words, for the planter's own eyes. */
    note: text("note"),
    answeredById: uuid("answered_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // ONE ROW PER WEEK, which is what makes answering idempotent: a second tap
    // on the same week updates rather than appending, so a planter changing
    // their mind on Thursday does not produce two contradictory weeks.
    uniqueIndex("planter_checkins_church_week_idx").on(
      table.churchId,
      table.weekStart
    ),
    index("planter_checkins_church_id_idx").on(table.churchId),
    // The vocabulary, in the data — same reasoning as
    // `plant_assessments_status_check`: a `$type<>()` brand is compile-time
    // only, so the levels a row can hold are closed here rather than by
    // convention.
    check(
      "planter_checkins_levels_check",
      sql`${table.spiritually} in (${inList(planterCheckinLevels)})
        and ${table.marriageFamily} in (${inList(planterCheckinLevels)})
        and ${table.financially} in (${inList(planterCheckinLevels)})
        and ${table.pace} in (${inList(planterCheckinLevels)})`
    ),
  ]
);

export type PlanterCheckin = typeof planterCheckins.$inferSelect;
export type NewPlanterCheckin = typeof planterCheckins.$inferInsert;
