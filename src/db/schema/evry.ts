import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { churches } from "./church";
import { inList } from "./sql";
import { users } from "./user";

export const evryPlanStatuses = [
  "draft",
  "awaiting_confirmation",
  "approved",
  "executing",
  "completed",
  "partially_failed",
  "failed",
  "cancelled",
  "superseded",
  "expired",
] as const;

export type EvryPlanStatus = (typeof evryPlanStatuses)[number];

export const evryAuditEventTypes = [
  "request_read_completed",
  "request_refused",
  "request_failed",
  "plan_proposed",
  "plan_approved",
  "plan_cancelled",
  "plan_expired",
  "plan_superseded",
] as const;
export const evryRequestAuditResultCodes = [
  "read_completed",
  "policy_refused",
  "request_invalid",
  "request_failed",
] as const;

export const evryExecutionOutcomeSubjects = ["attempt", "step"] as const;
export const evryExecutionOutcomeStatuses = [
  "completed",
  "partially_failed",
  "failed",
  "refused",
  "skipped",
] as const;
export const evryExecutionResultCodes = [
  "noop_completed",
  "precondition_refused",
  "effect_failed",
  "dependency_skipped",
] as const;

/**
 * The exact plan a person may approve.
 *
 * This row is append-only. An edit inserts a successor and changes only the
 * predecessor's row in `evry_action_plan_states`. Keeping mutable lifecycle
 * data in another table means no ordinary state transition can accidentally
 * rewrite the document whose fingerprint the person reviewed.
 */
export const evryActionPlans = pgTable(
  "evry_action_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    actorUserId: uuid("actor_user_id")
      .references(() => users.id)
      .notNull(),
    requestKey: uuid("request_key").notNull(),
    intentFingerprint: varchar("intent_fingerprint", { length: 64 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    // The database is an external boundary. Readers parse this unknown JSON
    // through `parseStoredEvryActionPlan` before trusting one field.
    document: jsonb("document").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    supersedesPlanId: uuid("supersedes_plan_id"),
  },
  (table) => [
    index("evry_action_plans_church_created_idx").on(
      table.churchId,
      table.createdAt
    ),
    uniqueIndex("evry_action_plans_actor_request_unique_idx").on(
      table.churchId,
      table.actorUserId,
      table.requestKey
    ),
    uniqueIndex("evry_action_plans_supersedes_unique_idx")
      .on(table.supersedesPlanId)
      .where(sql`${table.supersedesPlanId} is not null`),
    // Composite FKs below bind a state and a confirmation to the exact tenant,
    // actor, and fingerprint. `id` is already unique; these spell the tuples.
    uniqueIndex("evry_action_plans_id_church_unique_idx").on(
      table.id,
      table.churchId
    ),
    uniqueIndex("evry_action_plans_exact_identity_unique_idx").on(
      table.id,
      table.churchId,
      table.actorUserId,
      table.fingerprint
    ),
    foreignKey({
      name: "evry_action_plans_supersedes_fk",
      columns: [table.supersedesPlanId, table.churchId],
      foreignColumns: [table.id, table.churchId],
    }),
    check(
      "evry_action_plans_fingerprint_check",
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "evry_action_plans_intent_fingerprint_check",
      sql`${table.intentFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "evry_action_plans_document_object_check",
      sql`jsonb_typeof(${table.document}) = 'object'`
    ),
    check(
      "evry_action_plans_expiration_check",
      sql`${table.expiresAt} = ${table.createdAt} + interval '15 minutes'`
    ),
    check(
      "evry_action_plans_no_self_supersede_check",
      sql`${table.supersedesPlanId} is null or ${table.supersedesPlanId} <> ${table.id}`
    ),
  ]
);

export const evryActionPlanStates = pgTable(
  "evry_action_plan_states",
  {
    planId: uuid("plan_id").primaryKey(),
    churchId: uuid("church_id").notNull(),
    status: varchar("status", { length: 32 }).$type<EvryPlanStatus>().notNull(),
    version: integer("version").default(0).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("evry_action_plan_states_church_status_idx").on(
      table.churchId,
      table.status
    ),
    foreignKey({
      name: "evry_action_plan_states_plan_church_fk",
      columns: [table.planId, table.churchId],
      foreignColumns: [evryActionPlans.id, evryActionPlans.churchId],
    }),
    check(
      "evry_action_plan_states_status_check",
      sql`${table.status} in (${inList(evryPlanStatuses)})`
    ),
    check("evry_action_plan_states_version_check", sql`${table.version} >= 0`),
  ]
);

/** One immutable human approval, structurally tied to the exact plan tuple. */
export const evryPlanConfirmations = pgTable(
  "evry_plan_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    actorUserId: uuid("actor_user_id")
      .references(() => users.id)
      .notNull(),
    planFingerprint: varchar("plan_fingerprint", { length: 64 }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("evry_plan_confirmations_plan_unique_idx").on(table.planId),
    uniqueIndex("evry_plan_confirmations_exact_identity_unique_idx").on(
      table.id,
      table.planId,
      table.churchId,
      table.actorUserId,
      table.planFingerprint
    ),
    index("evry_plan_confirmations_church_decided_idx").on(
      table.churchId,
      table.decidedAt
    ),
    foreignKey({
      name: "evry_plan_confirmations_exact_plan_fk",
      columns: [
        table.planId,
        table.churchId,
        table.actorUserId,
        table.planFingerprint,
      ],
      foreignColumns: [
        evryActionPlans.id,
        evryActionPlans.churchId,
        evryActionPlans.actorUserId,
        evryActionPlans.fingerprint,
      ],
    }),
    check(
      "evry_plan_confirmations_fingerprint_check",
      sql`${table.planFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

/** Closed, append-only product events for one exact immutable plan. */
export const evryProductAuditEvents = pgTable(
  "evry_product_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id"),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    actorUserId: uuid("actor_user_id")
      .references(() => users.id)
      .notNull(),
    planFingerprint: varchar("plan_fingerprint", { length: 64 }),
    correlationId: uuid("correlation_id").notNull(),
    eventKey: varchar("event_key", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 32 })
      .$type<(typeof evryAuditEventTypes)[number]>()
      .notNull(),
    resultCode: varchar("result_code", { length: 32 }).$type<
      (typeof evryRequestAuditResultCodes)[number]
    >(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "evry_product_audit_events_exact_plan_fk",
      columns: [
        table.planId,
        table.churchId,
        table.actorUserId,
        table.planFingerprint,
      ],
      foreignColumns: [
        evryActionPlans.id,
        evryActionPlans.churchId,
        evryActionPlans.actorUserId,
        evryActionPlans.fingerprint,
      ],
    }),
    uniqueIndex("evry_product_audit_events_key_unique_idx").on(
      table.churchId,
      table.eventKey
    ),
    uniqueIndex("evry_product_audit_events_exact_identity_unique_idx").on(
      table.id,
      table.planId,
      table.churchId,
      table.actorUserId,
      table.planFingerprint,
      table.correlationId,
      table.eventType
    ),
    uniqueIndex("evry_product_audit_events_plan_type_unique_idx")
      .on(table.planId, table.eventType)
      .where(sql`${table.planId} is not null`),
    index("evry_product_audit_events_plan_time_idx").on(
      table.planId,
      table.occurredAt,
      table.id
    ),
    index("evry_product_audit_events_correlation_idx").on(
      table.correlationId,
      table.occurredAt
    ),
    check(
      "evry_product_audit_events_type_check",
      sql`${table.eventType} in (${inList(evryAuditEventTypes)})`
    ),
    check(
      "evry_product_audit_events_fingerprint_check",
      sql`${table.planFingerprint} is null or ${table.planFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "evry_product_audit_events_key_check",
      sql`${table.eventKey} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "evry_product_audit_events_shape_check",
      sql`(
        ${table.eventType} in ('request_read_completed', 'request_refused', 'request_failed')
        and ${table.planId} is null
        and ${table.planFingerprint} is null
        and (
          (${table.eventType} = 'request_read_completed' and ${table.resultCode} = 'read_completed')
          or (${table.eventType} = 'request_refused' and ${table.resultCode} in ('policy_refused', 'request_invalid'))
          or (${table.eventType} = 'request_failed' and ${table.resultCode} = 'request_failed')
        )
      ) or (
        ${table.eventType} in ('plan_proposed', 'plan_approved', 'plan_cancelled', 'plan_expired', 'plan_superseded')
        and ${table.planId} is not null
        and ${table.planFingerprint} is not null
        and ${table.resultCode} is null
      )`
    ),
  ]
);

/** One immutable attempt to execute an exactly confirmed plan. */
export const evryExecutionAttempts = pgTable(
  "evry_execution_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull(),
    churchId: uuid("church_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    planFingerprint: varchar("plan_fingerprint", { length: 64 }).notNull(),
    confirmationId: uuid("confirmation_id").notNull(),
    proposalEventId: uuid("proposal_event_id").notNull(),
    proposalEventType: varchar("proposal_event_type", { length: 32 })
      .$type<"plan_proposed">()
      .default("plan_proposed")
      .notNull(),
    correlationId: uuid("correlation_id").notNull(),
    attemptKey: varchar("attempt_key", { length: 64 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "evry_execution_attempts_exact_plan_fk",
      columns: [
        table.planId,
        table.churchId,
        table.actorUserId,
        table.planFingerprint,
      ],
      foreignColumns: [
        evryActionPlans.id,
        evryActionPlans.churchId,
        evryActionPlans.actorUserId,
        evryActionPlans.fingerprint,
      ],
    }),
    foreignKey({
      name: "evry_execution_attempts_exact_proposal_fk",
      columns: [
        table.proposalEventId,
        table.planId,
        table.churchId,
        table.actorUserId,
        table.planFingerprint,
        table.correlationId,
        table.proposalEventType,
      ],
      foreignColumns: [
        evryProductAuditEvents.id,
        evryProductAuditEvents.planId,
        evryProductAuditEvents.churchId,
        evryProductAuditEvents.actorUserId,
        evryProductAuditEvents.planFingerprint,
        evryProductAuditEvents.correlationId,
        evryProductAuditEvents.eventType,
      ],
    }),
    foreignKey({
      name: "evry_execution_attempts_exact_confirmation_fk",
      columns: [
        table.confirmationId,
        table.planId,
        table.churchId,
        table.actorUserId,
        table.planFingerprint,
      ],
      foreignColumns: [
        evryPlanConfirmations.id,
        evryPlanConfirmations.planId,
        evryPlanConfirmations.churchId,
        evryPlanConfirmations.actorUserId,
        evryPlanConfirmations.planFingerprint,
      ],
    }),
    uniqueIndex("evry_execution_attempts_key_unique_idx").on(
      table.churchId,
      table.attemptKey
    ),
    uniqueIndex("evry_execution_attempts_exact_identity_unique_idx").on(
      table.id,
      table.planId,
      table.churchId,
      table.actorUserId,
      table.planFingerprint,
      table.correlationId
    ),
    index("evry_execution_attempts_plan_time_idx").on(
      table.planId,
      table.startedAt,
      table.id
    ),
    index("evry_execution_attempts_correlation_idx").on(
      table.correlationId,
      table.startedAt
    ),
    check(
      "evry_execution_attempts_fingerprint_check",
      sql`${table.planFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "evry_execution_attempts_key_check",
      sql`${table.attemptKey} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "evry_execution_attempts_proposal_type_check",
      sql`${table.proposalEventType} = 'plan_proposed'`
    ),
  ]
);

/** A closed, redacted result for an attempt or one named plan step. */
export const evryExecutionOutcomes = pgTable(
  "evry_execution_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id").notNull(),
    planId: uuid("plan_id").notNull(),
    churchId: uuid("church_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    planFingerprint: varchar("plan_fingerprint", { length: 64 }).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    outcomeKey: varchar("outcome_key", { length: 64 }).notNull(),
    effectKey: varchar("effect_key", { length: 64 }),
    subject: varchar("subject", { length: 16 })
      .$type<(typeof evryExecutionOutcomeSubjects)[number]>()
      .notNull(),
    stepId: varchar("step_id", { length: 64 }),
    capabilityIdentity: varchar("capability_identity", { length: 160 }),
    status: varchar("status", { length: 32 })
      .$type<(typeof evryExecutionOutcomeStatuses)[number]>()
      .notNull(),
    resultCode: varchar("result_code", { length: 32 })
      .$type<(typeof evryExecutionResultCodes)[number]>()
      .notNull(),
    affectedCount: integer("affected_count").default(0).notNull(),
    excludedCount: integer("excluded_count").default(0).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "evry_execution_outcomes_exact_attempt_fk",
      columns: [
        table.attemptId,
        table.planId,
        table.churchId,
        table.actorUserId,
        table.planFingerprint,
        table.correlationId,
      ],
      foreignColumns: [
        evryExecutionAttempts.id,
        evryExecutionAttempts.planId,
        evryExecutionAttempts.churchId,
        evryExecutionAttempts.actorUserId,
        evryExecutionAttempts.planFingerprint,
        evryExecutionAttempts.correlationId,
      ],
    }),
    uniqueIndex("evry_execution_outcomes_key_unique_idx").on(
      table.churchId,
      table.outcomeKey
    ),
    uniqueIndex("evry_execution_outcomes_attempt_unique_idx")
      .on(table.attemptId)
      .where(sql`${table.subject} = 'attempt'`),
    uniqueIndex("evry_execution_outcomes_step_unique_idx")
      .on(table.attemptId, table.stepId)
      .where(sql`${table.subject} = 'step'`),
    uniqueIndex("evry_execution_outcomes_effect_unique_idx")
      .on(table.churchId, table.effectKey)
      .where(sql`${table.effectKey} is not null`),
    index("evry_execution_outcomes_plan_time_idx").on(
      table.planId,
      table.occurredAt,
      table.id
    ),
    check(
      "evry_execution_outcomes_subject_check",
      sql`${table.subject} in (${inList(evryExecutionOutcomeSubjects)})`
    ),
    check(
      "evry_execution_outcomes_status_check",
      sql`${table.status} in (${inList(evryExecutionOutcomeStatuses)})`
    ),
    check(
      "evry_execution_outcomes_result_code_check",
      sql`${table.resultCode} in (${inList(evryExecutionResultCodes)})`
    ),
    check(
      "evry_execution_outcomes_fingerprint_check",
      sql`${table.planFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "evry_execution_outcomes_keys_check",
      sql`${table.outcomeKey} ~ '^[0-9a-f]{64}$' and (${table.effectKey} is null or ${table.effectKey} ~ '^[0-9a-f]{64}$')`
    ),
    check(
      "evry_execution_outcomes_counts_check",
      sql`${table.affectedCount} >= 0 and ${table.excludedCount} >= 0`
    ),
    check(
      "evry_execution_outcomes_subject_fields_check",
      sql`(
        ${table.subject} = 'attempt'
        and ${table.stepId} is null
        and ${table.capabilityIdentity} is null
        and ${table.status} in ('completed', 'partially_failed', 'failed', 'refused')
      ) or (
        ${table.subject} = 'step'
        and ${table.stepId} is not null
        and ${table.stepId} ~ '^[a-z][a-z0-9_.-]{0,63}$'
        and ${table.capabilityIdentity} is not null
        and length(${table.capabilityIdentity}) > 0
        and ${table.status} in ('completed', 'failed', 'refused', 'skipped')
      )`
    ),
    check(
      "evry_execution_outcomes_effect_check",
      sql`(${table.status} = 'completed' and ${table.effectKey} is not null) or (${table.status} <> 'completed' and ${table.effectKey} is null)`
    ),
    check(
      "evry_execution_outcomes_status_result_check",
      sql`(${table.status} = 'completed' and ${table.resultCode} = 'noop_completed')
        or (${table.status} = 'refused' and ${table.resultCode} = 'precondition_refused')
        or (${table.status} in ('failed', 'partially_failed') and ${table.resultCode} = 'effect_failed')
        or (${table.status} = 'skipped' and ${table.resultCode} = 'dependency_skipped')`
    ),
  ]
);

export type EvryActionPlan = typeof evryActionPlans.$inferSelect;
export type NewEvryActionPlan = typeof evryActionPlans.$inferInsert;
export type EvryActionPlanState = typeof evryActionPlanStates.$inferSelect;
export type EvryPlanConfirmation = typeof evryPlanConfirmations.$inferSelect;
export type EvryProductAuditEvent = typeof evryProductAuditEvents.$inferSelect;
export type EvryExecutionAttempt = typeof evryExecutionAttempts.$inferSelect;
export type EvryExecutionOutcome = typeof evryExecutionOutcomes.$inferSelect;
