import {
  boolean,
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
import { ministryTeams } from "./ministry-teams";
import { persons } from "./people";
import { users } from "./user";

// ============================================================================
// Enums
// ============================================================================

export const meetingTypes = [
  "vision_meeting",
  "orientation",
  "team_meeting",
] as const;
export type MeetingType = (typeof meetingTypes)[number];

export const meetingStatuses = [
  "planning",
  "ready",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type MeetingStatus = (typeof meetingStatuses)[number];

export const meetingSubtypes = [
  "regular",
  "training",
  "planning",
  "special",
  "rehearsal",
] as const;
export type MeetingSubtype = (typeof meetingSubtypes)[number];

export const attendanceTypes = [
  "first_time",
  "returning",
  "core_group",
] as const;
export type AttendanceType = (typeof attendanceTypes)[number];

export const attendanceStatuses = ["attended", "absent", "excused"] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const responseStatuses = [
  "confirmed",
  "declined",
  "interested",
  "ready_commit",
  "questions",
  "not_interested",
] as const;
export type ResponseStatus = (typeof responseStatuses)[number];

export const invitationStatuses = [
  "invited",
  "confirmed",
  "maybe",
  "declined",
  "attended",
  "no_show",
] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];

export const checklistCategories = [
  "essential",
  "materials",
  "setup",
  "av",
  "organization",
] as const;
export type ChecklistCategory = (typeof checklistCategories)[number];

// ============================================================================
// Tables
// ============================================================================

// ----------------------------------------------------------------------------
// Locations - Venue/location records for meetings (shared across all types)
// ----------------------------------------------------------------------------
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    address: varchar("address", { length: 500 }).notNull(),
    contactName: varchar("contact_name", { length: 255 }),
    contactPhone: varchar("contact_phone", { length: 50 }),
    contactEmail: varchar("contact_email", { length: 255 }),
    cost: varchar("cost", { length: 50 }),
    capacity: integer("capacity"),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("locations_church_id_idx").on(table.churchId)]
);

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

// ----------------------------------------------------------------------------
// Church Meetings - Unified meeting entity (vision meetings, orientations, team meetings)
// ----------------------------------------------------------------------------
export const churchMeetings = pgTable(
  "church_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    type: varchar("type", { length: 20 })
      .$type<MeetingType>()
      .notNull(),
    title: varchar("title", { length: 255 }),
    datetime: timestamp("datetime").notNull(),
    status: varchar("status", { length: 50 })
      .$type<MeetingStatus>()
      .notNull()
      .default("planning"),
    locationId: uuid("location_id").references(() => locations.id),
    locationName: varchar("location_name", { length: 255 }),
    locationAddress: varchar("location_address", { length: 500 }),
    // Vision meeting specific
    meetingNumber: integer("meeting_number"),
    // Team meeting specific
    teamId: uuid("team_id").references(() => ministryTeams.id),
    meetingSubtype: varchar("meeting_subtype", { length: 20 })
      .$type<MeetingSubtype>(),
    // Common fields
    estimatedAttendance: integer("estimated_attendance"),
    actualAttendance: integer("actual_attendance"),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    agenda: jsonb("agenda"),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("church_meetings_church_id_idx").on(table.churchId),
    index("church_meetings_type_idx").on(table.type),
    index("church_meetings_status_idx").on(table.status),
    index("church_meetings_team_id_idx").on(table.teamId),
    unique("church_meetings_church_meeting_number").on(
      table.churchId,
      table.meetingNumber
    ),
  ]
);

export type ChurchMeeting = typeof churchMeetings.$inferSelect;
export type NewChurchMeeting = typeof churchMeetings.$inferInsert;

// ----------------------------------------------------------------------------
// Meeting Attendance - Who attended each meeting (unified)
// ----------------------------------------------------------------------------
export const meetingAttendance = pgTable(
  "meeting_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    meetingId: uuid("meeting_id")
      .references(() => churchMeetings.id, { onDelete: "cascade" })
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    attendanceType: varchar("attendance_type", { length: 50 })
      .$type<AttendanceType>(),
    status: varchar("status", { length: 10 })
      .$type<AttendanceStatus>()
      .notNull()
      .default("attended"),
    invitedById: uuid("invited_by_id").references(() => persons.id),
    responseStatus: varchar("response_status", {
      length: 50,
    }).$type<ResponseStatus>(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("meeting_attendance_meeting_person_unique").on(
      table.meetingId,
      table.personId
    ),
    index("meeting_attendance_meeting_id_idx").on(table.meetingId),
    index("meeting_attendance_person_id_idx").on(table.personId),
  ]
);

export type MeetingAttendanceRecord = typeof meetingAttendance.$inferSelect;
export type NewMeetingAttendanceRecord = typeof meetingAttendance.$inferInsert;

// ----------------------------------------------------------------------------
// Invitations - Tracking who invited whom (vision-meeting focused)
// ----------------------------------------------------------------------------
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    meetingId: uuid("meeting_id")
      .references(() => churchMeetings.id, { onDelete: "cascade" })
      .notNull(),
    inviterId: uuid("inviter_id")
      .references(() => persons.id)
      .notNull(),
    inviteeName: varchar("invitee_name", { length: 255 }),
    inviteeId: uuid("invitee_id").references(() => persons.id),
    status: varchar("status", { length: 50 })
      .$type<InvitationStatus>()
      .notNull()
      .default("invited"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("invitations_meeting_id_idx").on(table.meetingId)]
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

// ----------------------------------------------------------------------------
// Meeting Evaluations - Scoring each meeting (vision-meeting focused)
// ----------------------------------------------------------------------------
export const meetingEvaluations = pgTable(
  "meeting_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    meetingId: uuid("meeting_id")
      .references(() => churchMeetings.id, { onDelete: "cascade" })
      .notNull(),
    attendanceScore: integer("attendance_score").notNull(),
    locationScore: integer("location_score").notNull(),
    logisticsScore: integer("logistics_score").notNull(),
    agendaScore: integer("agenda_score").notNull(),
    vibeScore: integer("vibe_score").notNull(),
    messageScore: integer("message_score").notNull(),
    closeScore: integer("close_score").notNull(),
    nextStepsScore: integer("next_steps_score").notNull(),
    totalScore: varchar("total_score", { length: 10 }).notNull(),
    notes: text("notes"),
    evaluatedBy: uuid("evaluated_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("evaluations_meeting_unique").on(table.meetingId)]
);

export type MeetingEvaluation = typeof meetingEvaluations.$inferSelect;
export type NewMeetingEvaluation = typeof meetingEvaluations.$inferInsert;

// ----------------------------------------------------------------------------
// Meeting Checklist Items - Preparation checklist
// ----------------------------------------------------------------------------
export const meetingChecklistItems = pgTable(
  "meeting_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id)
      .notNull(),
    meetingId: uuid("meeting_id")
      .references(() => churchMeetings.id, { onDelete: "cascade" })
      .notNull(),
    itemName: varchar("item_name", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 })
      .$type<ChecklistCategory>()
      .notNull(),
    isChecked: boolean("is_checked").default(false).notNull(),
    notes: text("notes"),
    assignedTo: uuid("assigned_to").references(() => persons.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("meeting_checklist_items_meeting_id_idx").on(table.meetingId),
  ]
);

export type MeetingChecklistItem = typeof meetingChecklistItems.$inferSelect;
export type NewMeetingChecklistItem = typeof meetingChecklistItems.$inferInsert;
