import { sql, type SQL } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { tasks } from "./tasks";
import { users } from "./user";

// ============================================================================
// Launch Sunday, as an entity (LS-001/2/3/6; FRD
// `product-docs/features/launch/frd.md`, ruled from #271 on 2026-08-04).
//
// WHY IT EXISTS. Launch Sunday used to be a single `date` column on `churches`
// plus a convention (`launch_prep` tasks) plus a lie (a "vision meeting" row
// standing in for the day itself). A column cannot carry a status lifecycle, a
// readiness structure, an outcome, or a history of when the date moved and who
// moved it — all four of which the methodology's culminating event actually
// has. So the column is DROPPED by migration 0032 and this is its only owner.
//
// NOT EXPAND-ONLY, BY RULING (#285). Dropping `churches.launch_date` breaks any
// build still naming it, which was accepted explicitly: the schema, the reader
// migration and the reseed land as one unit. There are no users yet, so the dev
// database is wiped and reseeded rather than back-filled by hand.
//
// FOUR TABLES, AND WHY EACH IS SEPARATE:
//   launches               one LIVE row per church — the date, the status, the
//                          outcome. Enforced by a UNIQUE index on church_id,
//                          not by a SELECT-then-INSERT (invariants → Atomicity).
//   launch_milestones      the seeded Playbook readiness rows.
//   launch_milestone_tasks milestone ⇄ task, a join table rather than a column
//                          on `tasks`: a milestone has many tasks, and the task
//                          system does not need to know the launch feature
//                          exists.
//   launch_events          the APPEND-ONLY date/status journal (LS-002/LS-009).
// ============================================================================

/** `'a', 'b'` — the CHECK's value list, built from the tuples below so the two cannot drift. */
function inList(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

// ----------------------------------------------------------------------------
// launches
// ----------------------------------------------------------------------------

/**
 * The launch lifecycle (LS-001).
 *
 * `planning` is the row's existence WITHOUT a committed date — a plant that has
 * a launch to talk about but has not named the day. It is the only status for
 * which `target_date` may be null, which the `launches_target_date_check`
 * CHECK below makes structural rather than conventional.
 *
 * `postponed` is deliberately NOT terminal: a postponement carries a NEW target
 * date and the plant goes on preparing. It differs from `scheduled` only in
 * that the journal (and the page) can say the day moved after it had been
 * committed to — which is LS-009's whole request.
 */
export const launchStatuses = [
  "planning",
  "scheduled",
  "completed",
  "postponed",
] as const;
export type LaunchStatus = (typeof launchStatuses)[number];

export const launches = pgTable(
  "launches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The tenant scope AND the uniqueness key: ONE live launch per church
     * (LS-001). The unique index below is the real guard — two planters (or one
     * planter double-clicking) racing a first schedule both pass any
     * SELECT-then-INSERT check, and the loser's INSERT is refused by Postgres
     * rather than by hope. `memory/invariants.md` → Atomicity.
     */
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    /**
     * The launch DAY as a wall clock, never an instant. A `date` column, read
     * and written as `YYYY-MM-DD` and parsed at UTC midnight (`APP_TIME_ZONE`)
     * wherever a countdown is computed — see `daysUntilTarget` in
     * `src/lib/launch/countdown.ts`, which is the one implementation.
     *
     * Nullable ONLY while `status = 'planning'` (CHECK below).
     */
    targetDate: date("target_date"),
    status: varchar("status", { length: 20 })
      .$type<LaunchStatus>()
      .default("planning")
      .notNull(),
    // ---- Outcome (LS-006). Written when the planter records the day. ----
    /**
     * Non-null = the outcome has been recorded. It is the idempotency marker
     * for "did this launch already happen", so nothing else needs to infer it
     * from `status` plus a date comparison.
     */
    outcomeRecordedAt: timestamp("outcome_recorded_at"),
    /** People present on the day. Null = not recorded; 0 is a real answer. */
    attendanceCount: integer("attendance_count"),
    /** Decisions/responses recorded on the day. Null = not recorded. */
    decisionsCount: integer("decisions_count"),
    /** The planter's free-text account of the day. */
    outcomeNotes: text("outcome_notes"),
    /**
     * "Capture the day" — the Playbook's own charge that the day be recorded
     * and remembered. Free text on purpose: photos/links are #186-arc scope,
     * and a nullable text column is honest about that where an empty media
     * table would not be.
     */
    captureTheDay: text("capture_the_day"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // ONE live launch per church (LS-001). This index IS the rule; the service
    // layer's check is only there to turn the refusal into a message.
    uniqueIndex("launches_church_id_unique").on(table.churchId),
    check(
      "launches_status_check",
      sql`${table.status} in (${inList(launchStatuses)})`
    ),
    // A date is required by every status except `planning`. Without this, a
    // "scheduled" launch with no day is representable, and every countdown
    // reader has to defend against a state the schema promised could not exist.
    check(
      "launches_target_date_check",
      sql`${table.status} = 'planning' or ${table.targetDate} is not null`
    ),
    // Counts are counts. Null means "not recorded"; negative means a bug.
    check(
      "launches_attendance_count_check",
      sql`${table.attendanceCount} is null or ${table.attendanceCount} >= 0`
    ),
    check(
      "launches_decisions_count_check",
      sql`${table.decisionsCount} is null or ${table.decisionsCount} >= 0`
    ),
  ]
);

export type Launch = typeof launches.$inferSelect;
export type NewLaunch = typeof launches.$inferInsert;

// ----------------------------------------------------------------------------
// launch_milestones
// ----------------------------------------------------------------------------

/**
 * The Launch Playbook's three priority areas (LS-003). Fixed for alpha —
 * planter-defined milestones are an explicit non-goal — so the set lives in
 * `src/lib/launch/milestones.ts` as data and this column only records which
 * area a row belongs to.
 */
export const launchMilestoneAreas = [
  "operations",
  "launch_team",
  "promotion",
] as const;
export type LaunchMilestoneArea = (typeof launchMilestoneAreas)[number];

export const launchMilestones = pgTable(
  "launch_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    launchId: uuid("launch_id")
      .references(() => launches.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * Denormalised tenant scope. The launch already carries it, but every
     * feature table in this schema carries `church_id` (invariants →
     * Multi-Tenancy) so a tenancy filter is never one JOIN away from being
     * forgotten.
     */
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    /**
     * The template key (`operations.venue_secured`, …). Stable across reseeds,
     * so `templateKey` — not the title — is what code matches on, and the
     * unique index below is what makes seeding idempotent: a second seed of the
     * same launch is refused by the database rather than doubling the list.
     */
    templateKey: varchar("template_key", { length: 64 }).notNull(),
    area: varchar("area", { length: 20 })
      .$type<LaunchMilestoneArea>()
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    /** Display order within the whole list, from the template. */
    sortOrder: integer("sort_order").default(0).notNull(),
    /**
     * Non-null = complete. A timestamp rather than a boolean for the same
     * reason `outcome_recorded_at` is: "when" is free and answers questions a
     * boolean cannot.
     */
    completedAt: timestamp("completed_at"),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("launch_milestones_launch_id_template_key_unique").on(
      table.launchId,
      table.templateKey
    ),
    index("launch_milestones_church_id_idx").on(table.churchId),
    check(
      "launch_milestones_area_check",
      sql`${table.area} in (${inList(launchMilestoneAreas)})`
    ),
  ]
);

export type LaunchMilestone = typeof launchMilestones.$inferSelect;
export type NewLaunchMilestone = typeof launchMilestones.$inferInsert;

// ----------------------------------------------------------------------------
// launch_milestone_tasks
// ----------------------------------------------------------------------------

/**
 * Milestone ⇄ task (LS-003).
 *
 * A JOIN TABLE rather than a `launch_milestone_id` column on `tasks`: the
 * relationship is one-to-many in the direction that matters and the task system
 * does not need a column for every feature that wants to point at a task. It
 * also keeps the drop-and-migrate slice off `tasks`, which several other tracks
 * are writing to.
 *
 * Both sides cascade: unlinking is what deleting a task or a milestone means
 * here, and a dangling link would silently mis-count milestone progress.
 */
export const launchMilestoneTasks = pgTable(
  "launch_milestone_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    milestoneId: uuid("milestone_id")
      .references(() => launchMilestones.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("launch_milestone_tasks_unique").on(
      table.milestoneId,
      table.taskId
    ),
    index("launch_milestone_tasks_task_id_idx").on(table.taskId),
  ]
);

export type LaunchMilestoneTask = typeof launchMilestoneTasks.$inferSelect;
export type NewLaunchMilestoneTask = typeof launchMilestoneTasks.$inferInsert;

// ----------------------------------------------------------------------------
// launch_events — the journal
// ----------------------------------------------------------------------------

/**
 * WHAT happened to the date (LS-002/LS-009).
 *
 * `moved` and `postponed` are separate arms on purpose: LS-009 asks the journal
 * to distinguish a reschedule from a postponement-after-scheduled, and a single
 * "date changed" arm plus a comment would not survive a reader. `scheduled` is
 * the first commitment (planning → scheduled); `completed` is the outcome
 * recording, journalled so the story reads end to end from this one table.
 */
export const launchEventTypes = [
  "scheduled",
  "moved",
  "postponed",
  "completed",
] as const;
export type LaunchEventType = (typeof launchEventTypes)[number];

/**
 * APPEND-ONLY, on the same terms as `association_events` (see
 * `memory/contracts/db.md`): one writer (`src/lib/launch/service.ts`), INSERT
 * only, no `updated_at` and no soft-delete column, and no database rule
 * enforcing it — a trigger blocking UPDATE/DELETE is a retention decision, not
 * a detail to smuggle into this migration.
 */
export const launchEvents = pgTable(
  "launch_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    launchId: uuid("launch_id")
      .references(() => launches.id, { onDelete: "cascade" })
      .notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    event: varchar("event", { length: 20 }).$type<LaunchEventType>().notNull(),
    /**
     * The day before and after. `previous_target_date` is null for the FIRST
     * commitment — a fact ("there was no date"), not a gap.
     */
    previousTargetDate: date("previous_target_date"),
    targetDate: date("target_date"),
    previousStatus: varchar("previous_status", { length: 20 })
      .$type<LaunchStatus>()
      .notNull(),
    status: varchar("status", { length: 20 }).$type<LaunchStatus>().notNull(),
    /** The planter's stated reason, when a surface collects one. */
    note: text("note"),
    /**
     * WHO — always the session's user, never an id that arrived from a client.
     * Same rule as `association_events.actor_user_id`: the write path mints the
     * actor from `verifySession()` (invariants → Authentication).
     */
    actorUserId: uuid("actor_user_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("launch_events_launch_id_created_at_idx").on(
      table.launchId,
      table.createdAt
    ),
    index("launch_events_church_id_idx").on(table.churchId),
    check(
      "launch_events_event_check",
      sql`${table.event} in (${inList(launchEventTypes)})`
    ),
    check(
      "launch_events_status_check",
      sql`${table.status} in (${inList(launchStatuses)})`
    ),
    check(
      "launch_events_previous_status_check",
      sql`${table.previousStatus} in (${inList(launchStatuses)})`
    ),
  ]
);

export type LaunchEvent = typeof launchEvents.$inferSelect;
export type NewLaunchEvent = typeof launchEvents.$inferInsert;
