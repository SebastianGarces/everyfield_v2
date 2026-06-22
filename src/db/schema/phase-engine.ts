import {
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

/** Lifecycle of a judge run snapshot. */
export const assessmentStatuses = [
  "pending", // selected/queued, judge not yet run
  "complete", // judge run succeeded, insights written
  "failed", // judge run errored; retained for observability
] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];

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
