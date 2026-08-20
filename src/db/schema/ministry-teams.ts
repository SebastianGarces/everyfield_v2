import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { persons } from "./people";
import { users } from "./user";

// ============================================================================
// Enums
// ============================================================================

export const teamTypes = ["predefined", "custom"] as const;
export type TeamType = (typeof teamTypes)[number];

/**
 * The closed set of team templates, and the values `ministry_teams.template_key`
 * may hold (#378, ruling 2026-08-12).
 *
 * IT LIVES HERE, BESIDE THE COLUMN THAT STORES IT, and not next to the template
 * DATA in `ministry-teams/role-templates.ts` where it started. The column is
 * what makes a predefined team identifiable, so the column's type is the
 * authoritative statement of what a key IS; `TEAM_TEMPLATES` then declares
 * `teamKey: PredefinedTeamKey` and the compiler checks the data against the
 * schema rather than the other way round. Keeping it over there meant `@/db`
 * could not name the type, so every reader that got a key out of a row had to
 * widen it back with `as PredefinedTeamKey` — three casts, each of them a lie
 * the compiler was told rather than a fact it checked.
 */
export const PREDEFINED_TEAM_KEYS = [
  "senior_pastor",
  "launch_coordinator",
  "worship",
  "childrens_ministry",
  "facilities",
  "assimilation",
  "small_groups",
  "promotion",
  "prayer",
  "technology",
] as const;

export type PredefinedTeamKey = (typeof PREDEFINED_TEAM_KEYS)[number];

export const teamStatuses = ["forming", "active", "paused"] as const;
export type TeamStatus = (typeof teamStatuses)[number];

export const roleStatuses = ["open", "filled"] as const;
export type RoleStatus = (typeof roleStatuses)[number];

export const membershipStatuses = ["active", "inactive", "pending"] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

export const timeCommitments = ["low", "medium", "high"] as const;
export type TimeCommitment = (typeof timeCommitments)[number];

export const phaseIntroduced = [
  "phase_0",
  "phase_1",
  "phase_2",
  "phase_3",
  "phase_4",
  "phase_5",
  "phase_6",
] as const;
export type PhaseIntroduced = (typeof phaseIntroduced)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Ministry Teams - Core team entity
// ----------------------------------------------------------------------------
/**
 * OB-015 / #306 — a plant has at most ONE predefined team of each name, and the
 * DATABASE is what says so (`ministry_teams_predefined_name_unique_idx`).
 *
 * WHY. `initializePredefinedTeams` is reachable from two places — the /teams
 * "Set Up Ministry Teams" button and the onboarding finish screen's offer — and
 * both used to be guarded by a read ("does this church have teams yet?") before
 * a loop of unconditional inserts. `memory/invariants.md` → Transactions names
 * that shape exactly: SELECT-then-INSERT is not a concurrency guard. Two accepts
 * a few milliseconds apart both passed the read and the plant woke up with 20
 * teams and 96 roles.
 *
 * WHY PARTIAL, ON `type = 'predefined'`. The templates are a closed, named set,
 * so "one Worship team per plant" is a truth about them. A planter's OWN teams
 * are not: two custom teams may legitimately share a name while the planter
 * settles on one, and a unique index over the whole table would refuse that
 * with a database error in the middle of a form. The predicate keeps the
 * constraint where the invariant actually holds.
 *
 * The insert that speaks for this index carries `ON CONFLICT … DO NOTHING` with
 * the SAME predicate — see `initializePredefinedTeams`. The two change together:
 * a mismatch is not subtle, it is "there is no unique or exclusion constraint
 * matching the ON CONFLICT specification" on every initialization.
 */
export const ministryTeams = pgTable(
  "ministry_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    /**
     * WHICH template this team came from — `TEAM_TEMPLATES[].teamKey` — or NULL
     * for a team the planter made themselves (ruling 2026-08-12 on #378, from
     * sweep #403 / PR #409 DECISION 2).
     *
     * IT EXISTS SO THE DISPLAY NAME CAN CHANGE. Four surfaces used to identify a
     * predefined team by its NAME — the org-chart root, the responsibilities
     * lookup, the name→template map behind the role import, and
     * `teamRequiresBackgroundCheck` — so renaming "Senior Pastor" to
     * "Leadership" would have silently broken all four for every plant that
     * already had teams, and a planter renaming their Children's Ministry team
     * already dropped the roster's background-check column. The key is the
     * identity; `name` is now display and nothing else.
     *
     * BRANDED, so a reader that gets this off a row can hand it straight to
     * `getRoleTemplates` with no cast. NULL still means "not a template team",
     * and the brand is a compile-time claim only — migration 0053's backfill is
     * what makes it true of the rows, and nothing in the database enforces it.
     */
    templateKey: varchar("template_key", {
      length: 50,
    }).$type<PredefinedTeamKey>(),
    type: varchar("type", { length: 20 })
      .$type<TeamType>()
      .notNull()
      .default("predefined"),
    description: text("description"),
    icon: varchar("icon", { length: 50 }),
    leaderId: uuid("leader_id").references(() => persons.id),
    reportsToTeamId: uuid("reports_to_team_id"),
    phaseIntroduced: varchar("phase_introduced", { length: 10 })
      .$type<PhaseIntroduced>()
      .notNull()
      .default("phase_2"),
    status: varchar("status", { length: 20 })
      .$type<TeamStatus>()
      .notNull()
      .default("forming"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ministry_teams_church_id_idx").on(table.churchId),
    index("ministry_teams_leader_id_idx").on(table.leaderId),
    uniqueIndex("ministry_teams_predefined_name_unique_idx")
      .on(table.churchId, table.name)
      .where(sql`${table.type} = 'predefined'`),
  ]
);

export type MinistryTeam = typeof ministryTeams.$inferSelect;
export type NewMinistryTeam = typeof ministryTeams.$inferInsert;

// ----------------------------------------------------------------------------
// Team Roles - Roles within teams
// ----------------------------------------------------------------------------
export const teamRoles = pgTable(
  "team_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    teamId: uuid("team_id")
      .references(() => ministryTeams.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    reportsToRoleId: uuid("reports_to_role_id"),
    isLeadershipRole: boolean("is_leadership_role").default(false).notNull(),
    timeCommitment: varchar("time_commitment", {
      length: 10,
    }).$type<TimeCommitment>(),
    desiredSkills: text("desired_skills"),
    sortOrder: integer("sort_order").default(0).notNull(),
    status: varchar("status", { length: 10 })
      .$type<RoleStatus>()
      .notNull()
      .default("open"),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("team_roles_church_id_idx").on(table.churchId),
    index("team_roles_team_id_idx").on(table.teamId),
  ]
);

export type TeamRole = typeof teamRoles.$inferSelect;
export type NewTeamRole = typeof teamRoles.$inferInsert;

// ----------------------------------------------------------------------------
// Team Memberships - Person-to-role assignments
//
// #409 D1 — ONE PERSON PER TEAM ROLE, and the DATABASE is what says so
// (`team_memberships_role_active_unique_idx`, migration 0038).
//
// WHY. A `team_roles` row is a seat: `getTeam` resolves each role's occupant
// with `memberships.find((m) => m.roleId === role.id)` and the roles tab renders
// exactly one person beside it, with `Filled`/`Open` and a single Remove
// control. Nothing above the database held that to one row. `assignMember`
// asked only whether THIS person already held the role, so two planters
// assigning two DIFFERENT people to one open seat both passed — and the loser's
// person was assigned, counted in `getTeamCountsForPeople`, invisible on the
// roles tab (`find` returns the first row, in whatever order Postgres hands it
// back) and unremovable, because the only Remove button belongs to whoever the
// read happened to pick.
//
// WHY PARTIAL, ON `status = 'active'`. The seat is single only while it is
// occupied. Every past holder stays on the table as an `inactive` row — that is
// what `removeMember` writes and what `assignMember` reactivates on a
// re-assignment (F8) — so an unqualified unique index would make a role
// fillable exactly once in its life.
//
// WHY `(role_id)` ALONE and not `(church_id, role_id)`. A role belongs to one
// church, so the pair is a wider key for the same rule; it would let a forged
// church id claim a second active seat on one role. `church_id` is carried for
// tenant-scoped reads, not for identity — the same reasoning as
// `phase_prompt_answers_transition_unique_idx`.
//
// The insert that speaks for this index carries `ON CONFLICT … DO NOTHING` with
// the SAME predicate, and the reactivation UPDATE beside it — which cannot
// carry one — maps the index's own violation to the same refusal. That UPDATE
// also carries `status = 'inactive'` in its `WHERE`, because the index is NOT a
// guard for it when the racers are the same person: two UPDATEs of ONE row
// collide with nothing. See `assignMember` and `ROLE_ALREADY_FILLED_MESSAGE`.
// ----------------------------------------------------------------------------

/**
 * The partial unique index that enforces ONE PERSON PER TEAM ROLE (#409 D1).
 *
 * Exported so the code that recognises its violation names the same string the
 * declaration below does — the shape `TASKS_MEETING_EVALUATION_UNIQUE`
 * (`src/lib/tasks/events.ts`) established. The NAME is what the schema owns;
 * the PREDICATE that recognises a violation of it is `isUniqueViolation`
 * (`src/db/errors.ts`), the one copy every domain shares.
 */
export const TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE =
  "team_memberships_role_active_unique_idx";

// THE SEAT INDEX IS THE ONLY UNIQUE INDEX ON THIS TABLE — keyed on `role_id`
// where `status = 'active'`, and nothing else. `team_memberships_active_unique`
// (team_id, person_id, role_id) stood beside it for one round; migration 0039
// dropped it. Never re-add it, under that name or another: the seat key subsumes
// every wider key containing `role_id`, so a second unique index forbids
// nothing — and it is not the `ON CONFLICT` arbiter, so a raced INSERT meets it
// first and RAISES a unique violation where the `DO NOTHING` cannot cover it.
//
// The reasoning in full lives in exactly two places: the 0039 migration header
// and `memory/invariants.md` → Transactions. Enforced by `ruled-guards.test.ts`
// §4d, asserted off the rendered table rather than this declaration.

export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    teamId: uuid("team_id")
      .references(() => ministryTeams.id, { onDelete: "cascade" })
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    roleId: uuid("role_id")
      .references(() => teamRoles.id, { onDelete: "cascade" })
      .notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: varchar("status", { length: 10 })
      .$type<MembershipStatus>()
      .notNull()
      .default("active"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("team_memberships_church_id_idx").on(table.churchId),
    index("team_memberships_team_id_idx").on(table.teamId),
    index("team_memberships_person_id_idx").on(table.personId),
    index("team_memberships_role_id_idx").on(table.roleId),
    // The rule, and the ONLY unique index here: one person per team role
    // (#409 D1). Partial on `status = 'active'` because the seat is single only
    // while occupied — a past holder stays as an `inactive` row, so an
    // unqualified index would make a role fillable once in its life (F8).
    uniqueIndex(TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE)
      .on(table.roleId)
      .where(sql`status = 'active'`),
  ]
);

export type TeamMembership = typeof teamMemberships.$inferSelect;
export type NewTeamMembership = typeof teamMemberships.$inferInsert;

// ----------------------------------------------------------------------------
// Training Programs - Training program definitions
// ----------------------------------------------------------------------------
export const trainingPrograms = pgTable(
  "training_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    teamId: uuid("team_id").references(() => ministryTeams.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    isRequired: boolean("is_required").default(false).notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("training_programs_church_id_idx").on(table.churchId),
    index("training_programs_team_id_idx").on(table.teamId),
  ]
);

export type TrainingProgram = typeof trainingPrograms.$inferSelect;
export type NewTrainingProgram = typeof trainingPrograms.$inferInsert;

// ----------------------------------------------------------------------------
// Training Completions - Per-person training completions
// ----------------------------------------------------------------------------
export const trainingCompletions = pgTable(
  "training_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    trainingProgramId: uuid("training_program_id")
      .references(() => trainingPrograms.id, { onDelete: "cascade" })
      .notNull(),
    completedAt: timestamp("completed_at").notNull(),
    verifiedBy: uuid("verified_by").references(() => users.id),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("training_completions_church_id_idx").on(table.churchId),
    index("training_completions_person_id_idx").on(table.personId),
    index("training_completions_program_id_idx").on(table.trainingProgramId),
    unique("training_completions_unique").on(
      table.personId,
      table.trainingProgramId
    ),
  ]
);

export type TrainingCompletion = typeof trainingCompletions.$inferSelect;
export type NewTrainingCompletion = typeof trainingCompletions.$inferInsert;
