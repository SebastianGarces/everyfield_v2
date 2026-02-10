import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

// ============================================================================
// Enums
// ============================================================================

export const personStatuses = [
  "prospect",
  "attendee",
  "following_up",
  "interviewed",
  "core_group",
  "launch_team",
  "leader",
] as const;
export type PersonStatus = (typeof personStatuses)[number];

export const personSources = [
  "personal_referral",
  "social_media",
  "vision_meeting",
  "website",
  "event",
  "partner_church",
  "other",
] as const;
export type PersonSource = (typeof personSources)[number];

export const householdRoles = ["head", "spouse", "child", "other"] as const;
export type HouseholdRole = (typeof householdRoles)[number];

export const interviewStatuses = ["pass", "fail", "concern"] as const;
export type InterviewStatus = (typeof interviewStatuses)[number];

export const interviewResults = [
  "qualified",
  "qualified_with_notes",
  "not_qualified",
  "follow_up",
] as const;
export type InterviewResult = (typeof interviewResults)[number];

export const commitmentTypes = ["core_group", "launch_team"] as const;
export type CommitmentType = (typeof commitmentTypes)[number];

export const skillCategories = [
  "worship",
  "tech",
  "admin",
  "teaching",
  "hospitality",
  "leadership",
  "other",
] as const;
export type SkillCategory = (typeof skillCategories)[number];

export const skillProficiencies = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;
export type SkillProficiency = (typeof skillProficiencies)[number];

export const activityTypes = [
  "status_changed",
  "note_added",
  "person_created",
  "person_updated",
  "interview_completed",
  "assessment_completed",
  "commitment_recorded",
  "tag_added",
  "tag_removed",
  "skill_added",
  "skill_updated",
  "skill_removed",
  "household_created",
  "household_joined",
  "household_left",
  "household_role_changed",
] as const;
export type ActivityType = (typeof activityTypes)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Households - Family groupings
// ----------------------------------------------------------------------------
export const households = pgTable(
  "households",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    addressLine1: varchar("address_line1", { length: 255 }),
    addressLine2: varchar("address_line2", { length: 255 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 100 }),
    postalCode: varchar("postal_code", { length: 20 }),
    country: varchar("country", { length: 100 }).default("US"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("households_church_id_idx").on(table.churchId)]
);

export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;

// ----------------------------------------------------------------------------
// Persons - Main person records
// ----------------------------------------------------------------------------
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    firstName: varchar("first_name", { length: 255 }).notNull(),
    lastName: varchar("last_name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    addressLine1: varchar("address_line1", { length: 255 }),
    addressLine2: varchar("address_line2", { length: 255 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 100 }),
    postalCode: varchar("postal_code", { length: 20 }),
    country: varchar("country", { length: 100 }).default("US"),
    status: varchar("status", { length: 50 })
      .$type<PersonStatus>()
      .notNull()
      .default("prospect"),
    source: varchar("source", { length: 50 }).$type<PersonSource>(),
    sourceDetails: text("source_details"),
    notes: text("notes"),
    photoUrl: varchar("photo_url", { length: 500 }),
    householdId: uuid("household_id").references(() => households.id),
    householdRole: varchar("household_role", {
      length: 20,
    }).$type<HouseholdRole>(),
    pipelineSortOrder: integer("pipeline_sort_order").default(0).notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("persons_church_id_idx").on(table.churchId),
    index("persons_status_idx").on(table.status),
    index("persons_email_idx").on(table.email),
    index("persons_household_id_idx").on(table.householdId),
    index("persons_deleted_at_idx").on(table.deletedAt),
  ]
);

export type Person = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;

// ----------------------------------------------------------------------------
// Tags - Church-defined tags
// ----------------------------------------------------------------------------
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("tags_church_id_idx").on(table.churchId)]
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

// ----------------------------------------------------------------------------
// Person Tags - Junction table for person-tag relationships
// ----------------------------------------------------------------------------
export const personTags = pgTable(
  "person_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("person_tags_person_tag_unique").on(table.personId, table.tagId),
    index("person_tags_person_id_idx").on(table.personId),
    index("person_tags_tag_id_idx").on(table.tagId),
  ]
);

export type PersonTag = typeof personTags.$inferSelect;
export type NewPersonTag = typeof personTags.$inferInsert;

// ----------------------------------------------------------------------------
// Assessments - 4 C's assessments
// ----------------------------------------------------------------------------
export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    assessedBy: uuid("assessed_by")
      .references(() => users.id)
      .notNull(),
    committedScore: integer("committed_score").notNull(),
    committedNotes: text("committed_notes"),
    compelledScore: integer("compelled_score").notNull(),
    compelledNotes: text("compelled_notes"),
    contagiousScore: integer("contagious_score").notNull(),
    contagiousNotes: text("contagious_notes"),
    courageousScore: integer("courageous_score").notNull(),
    courageousNotes: text("courageous_notes"),
    totalScore: integer("total_score").notNull(),
    assessmentDate: date("assessment_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("assessments_person_id_idx").on(table.personId)]
);

export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;

// ----------------------------------------------------------------------------
// Interviews - 5-criteria interviews
// ----------------------------------------------------------------------------
export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    interviewedBy: uuid("interviewed_by")
      .references(() => users.id)
      .notNull(),
    interviewDate: date("interview_date").notNull(),
    maturityStatus: varchar("maturity_status", { length: 20 })
      .$type<InterviewStatus>()
      .notNull(),
    maturityNotes: text("maturity_notes"),
    giftedStatus: varchar("gifted_status", { length: 20 })
      .$type<InterviewStatus>()
      .notNull(),
    giftedNotes: text("gifted_notes"),
    chemistryStatus: varchar("chemistry_status", { length: 20 })
      .$type<InterviewStatus>()
      .notNull(),
    chemistryNotes: text("chemistry_notes"),
    rightReasonsStatus: varchar("right_reasons_status", { length: 20 })
      .$type<InterviewStatus>()
      .notNull(),
    rightReasonsNotes: text("right_reasons_notes"),
    seasonStatus: varchar("season_status", { length: 20 })
      .$type<InterviewStatus>()
      .notNull(),
    seasonNotes: text("season_notes"),
    overallResult: varchar("overall_result", { length: 30 })
      .$type<InterviewResult>()
      .notNull(),
    nextSteps: text("next_steps"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("interviews_person_id_idx").on(table.personId)]
);

export type Interview = typeof interviews.$inferSelect;
export type NewInterview = typeof interviews.$inferInsert;

// ----------------------------------------------------------------------------
// Commitments - Signed commitments
// ----------------------------------------------------------------------------
export const commitments = pgTable(
  "commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    commitmentType: varchar("commitment_type", { length: 20 })
      .$type<CommitmentType>()
      .notNull(),
    signedDate: date("signed_date").notNull(),
    witnessedBy: uuid("witnessed_by").references(() => users.id),
    documentUrl: varchar("document_url", { length: 500 }),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("commitments_person_id_idx").on(table.personId)]
);

export type Commitment = typeof commitments.$inferSelect;
export type NewCommitment = typeof commitments.$inferInsert;

// ----------------------------------------------------------------------------
// Skills Inventory - Skills and gifts
// ----------------------------------------------------------------------------
export const skillsInventory = pgTable(
  "skills_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    skillCategory: varchar("skill_category", { length: 20 })
      .$type<SkillCategory>()
      .notNull(),
    skillName: varchar("skill_name", { length: 100 }).notNull(),
    proficiency: varchar("proficiency", {
      length: 20,
    }).$type<SkillProficiency>(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("skills_inventory_person_id_idx").on(table.personId)]
);

export type SkillInventory = typeof skillsInventory.$inferSelect;
export type NewSkillInventory = typeof skillsInventory.$inferInsert;

// ----------------------------------------------------------------------------
// Person Activities - Activity timeline
// ----------------------------------------------------------------------------
export const personActivities = pgTable(
  "person_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    activityType: varchar("activity_type", { length: 30 })
      .$type<ActivityType>()
      .notNull(),
    metadata: jsonb("metadata"),
    performedBy: uuid("performed_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("person_activities_person_id_idx").on(table.personId),
    index("person_activities_activity_type_idx").on(table.activityType),
  ]
);

export type PersonActivity = typeof personActivities.$inferSelect;
export type NewPersonActivity = typeof personActivities.$inferInsert;
