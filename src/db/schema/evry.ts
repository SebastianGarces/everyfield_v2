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
    churchId: uuid("church_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    planFingerprint: varchar("plan_fingerprint", { length: 64 }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("evry_plan_confirmations_plan_unique_idx").on(table.planId),
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

export type EvryActionPlan = typeof evryActionPlans.$inferSelect;
export type NewEvryActionPlan = typeof evryActionPlans.$inferInsert;
export type EvryActionPlanState = typeof evryActionPlanStates.$inferSelect;
export type EvryPlanConfirmation = typeof evryPlanConfirmations.$inferSelect;
