import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
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
export const ministryTeams = pgTable(
  "ministry_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
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
// ----------------------------------------------------------------------------
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
    unique("team_memberships_active_unique").on(
      table.teamId,
      table.personId,
      table.roleId
    ),
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
