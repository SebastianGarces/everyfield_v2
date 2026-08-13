import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { phaseTransitions } from "./phase-engine";
import { users } from "./user";

/** `'a', 'b'` — the CHECK's value list, built from the tuple below so the two cannot drift. */
function inList(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

// ============================================================================
// Enums
// ============================================================================

export const taskStatuses = [
  "not_started",
  "in_progress",
  "blocked",
  "complete",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskPriorities = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const taskCategories = [
  "vision_meeting",
  "follow_up",
  "training",
  "facilities",
  "promotion",
  "administrative",
  "ministry_team",
  "launch_prep",
  "recurring",
  "general",
] as const;
export type TaskCategory = (typeof taskCategories)[number];

export const taskRelatedTypes = [
  "person",
  "meeting",
  "team",
  "facility",
] as const;
export type TaskRelatedType = (typeof taskRelatedTypes)[number];

/**
 * How a planter answered ONE phase transition's checklist prompt (T-020).
 *
 * Both answers are recorded, and the distinction is deliberately kept: the
 * prompt is suppressed by the row EXISTING, so `declined` alone would do — but
 * "did anyone ever take the phase-2 checklists?" is a question worth being able
 * to ask of the data, and it cannot be reconstructed from `tasks` (an imported
 * task is an ordinary task and carries no template marker).
 */
export const phasePromptAnswerKinds = ["accepted", "declined"] as const;
export type PhasePromptAnswerKind = (typeof phasePromptAnswerKinds)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Tasks - Core task records
// ----------------------------------------------------------------------------
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 })
      .$type<TaskStatus>()
      .notNull()
      .default("not_started"),
    priority: varchar("priority", { length: 10 })
      .$type<TaskPriority>()
      .notNull()
      .default("medium"),
    dueDate: date("due_date"),
    dueTime: time("due_time"),
    assignedToId: uuid("assigned_to_id").references(() => users.id),
    category: varchar("category", { length: 30 }).$type<TaskCategory>(),
    relatedType: varchar("related_type", {
      length: 20,
    }).$type<TaskRelatedType>(),
    relatedId: uuid("related_id"),
    /**
     * The task this one is a checklist item of — one level only
     * (`memory/invariants.md` → Tasks), enforced in application code by
     * `assertSubtaskNesting`.
     *
     * #405 D5 — the SELF-FK IS `ON DELETE CASCADE` (migration 0038), and it
     * carries two guarantees the application code cannot:
     *
     * 1. A parent id that names no task is UNREPRESENTABLE. The column had no
     *    FK at all, so `createTask`'s nesting check was the only thing between a
     *    forged `parentTaskId` and a row nothing renders: a subtask is filtered
     *    out of `listTasks` by `topLevelTasksOnly()` and reachable only through
     *    its parent's detail view, so a dangling parent is live work no planter
     *    can see or close, still counted by `getTaskCounts`.
     * 2. A HARD delete of a parent takes its children with it. The product soft-
     *    deletes (`deleteTask` stamps `deleted_at` on the parent and its
     *    children in one statement), so this fires only for the paths that
     *    delete rows outright — `planWipe()`'s seed sweep and hand-run repairs —
     *    where the alternative is an FK violation or an orphan.
     *
     * CASCADE rather than `set null`: a checklist item promoted to a top-level
     * task by a delete it had nothing to do with is a task the planter never
     * created, appearing in the list the moment its parent left it.
     */
    parentTaskId: uuid("parent_task_id").references(
      (): AnyPgColumn => tasks.id,
      { onDelete: "cascade" }
    ),
    isRecurring: boolean("is_recurring").default(false).notNull(),
    recurrenceRule: jsonb("recurrence_rule"),
    completionEvent: varchar("completion_event", { length: 100 }),
    completedAt: timestamp("completed_at"),
    completedById: uuid("completed_by_id").references(() => users.id),
    createdById: uuid("created_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("tasks_church_id_idx").on(table.churchId),
    index("tasks_assigned_to_id_idx").on(table.assignedToId),
    index("tasks_status_idx").on(table.status),
    index("tasks_due_date_idx").on(table.dueDate),
    index("tasks_church_status_idx").on(table.churchId, table.status),
    index("tasks_church_assigned_idx").on(table.churchId, table.assignedToId),
    index("tasks_parent_task_id_idx").on(table.parentTaskId),
    index("tasks_deleted_at_idx").on(table.deletedAt),
    index("tasks_related_idx").on(table.relatedType, table.relatedId),
    index("tasks_completion_event_idx").on(
      table.completionEvent,
      table.relatedId
    ),
    // MEET-011: at most ONE live evaluation task per meeting. This is the
    // idempotency key for follow-up generation
    // (`handleMeetingAttendanceFinalized`), and it has to be enforced by the
    // database: a SELECT-then-INSERT guard in application code cannot stop two
    // concurrent finalizes from both passing the check. Because the evaluation
    // task is inserted in the SAME statement as the per-attendee follow-ups,
    // the unique violation aborts that whole INSERT — so the loser of a race
    // writes nothing at all, not a set of orphan follow-ups.
    uniqueIndex("tasks_meeting_evaluation_unique_idx")
      .on(table.churchId, table.relatedId)
      .where(
        sql`${table.completionEvent} = 'meeting.evaluation.completed' and ${table.deletedAt} is null`
      ),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// ----------------------------------------------------------------------------
// PhasePromptAnswer — "this plant answered THIS transition's checklist prompt"
// (T-020, ruled 2026-08-10 on PR #393).
//
// THIS ROW IS THE IDEMPOTENCY KEY, NOT A LOG. The prompt itself is still
// derived — `phase_transitions` plus the code catalog — and this table holds
// the one fact that is not derivable: the planter already answered. It used to
// be an httpOnly cookie, which made the answer per-BROWSER: the same planter on
// a phone was prompted about the same transition and accepting there created a
// second full set of 22–26 tasks. The ruling is a durable record keyed by
// transition id, and accept idempotent per transition on any device.
//
// `phase_prompt_answers_transition_unique_idx` IS the rule. A SELECT-then-
// INSERT ("has this been answered?" then import) is not a concurrency guard
// (`memory/invariants.md` → Transactions) — two fast presses both pass it. The
// unique index makes the second answer unrepresentable, and
// `acceptPhaseTemplatePrompt` claims this row with `ON CONFLICT DO NOTHING`
// BEFORE it imports anything, gating the import on the claim's own rowcount.
// The claim goes first here rather than last (the usual marker-last rule)
// precisely because the dependent write is NOT idempotent: importing a
// checklist twice creates two sets by design, so a marker written afterwards
// would be written after the damage.
//
// UNIQUE ON `transition_id` ALONE, not on (church_id, transition_id). A
// transition belongs to exactly one church, so the pair would be a wider key
// for the same rule and would let a forged church id claim a second answer for
// one transition. `church_id` is carried for tenant-scoped reads and for the
// seed wipe's FK walk, not for identity.
//
// CASCADE ON THE TRANSITION, NOT ON THE CHURCH. An answer about a transition
// that no longer exists says nothing, so it goes with it; `church_id` follows
// the house pattern (no cascade), and `planWipe()` derives the delete order
// from `pg_constraint` rather than from a list anyone has to maintain.
// ----------------------------------------------------------------------------
export const phasePromptAnswers = pgTable(
  "phase_prompt_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    transitionId: uuid("transition_id")
      .references(() => phaseTransitions.id, { onDelete: "cascade" })
      .notNull(),
    /** `accepted` or `declined` — see `phasePromptAnswerKinds`. */
    answer: varchar("answer", { length: 20 })
      .$type<PhasePromptAnswerKind>()
      .notNull(),
    answeredById: uuid("answered_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // The rule: one answer per transition, ever, on any device.
    uniqueIndex("phase_prompt_answers_transition_unique_idx").on(
      table.transitionId
    ),
    index("phase_prompt_answers_church_id_idx").on(table.churchId),
    check(
      "phase_prompt_answers_answer_check",
      sql`${table.answer} in (${inList(phasePromptAnswerKinds)})`
    ),
  ]
);

export type PhasePromptAnswerRecord = typeof phasePromptAnswers.$inferSelect;
export type NewPhasePromptAnswer = typeof phasePromptAnswers.$inferInsert;
