import {
  meetingTypes,
  meetingStatuses,
  meetingSubtypes,
  attendanceTypes,
  attendanceStatuses,
  responseStatuses,
  invitationStatuses,
  checklistCategories,
} from "@/db/schema";
import { z } from "zod";

// ============================================================================
// Base Schemas
// ============================================================================

export const meetingTypeSchema = z.enum(meetingTypes);
export const meetingStatusSchema = z.enum(meetingStatuses);
export const meetingSubtypeSchema = z.enum(meetingSubtypes);
export const attendanceTypeSchema = z.enum(attendanceTypes);
export const attendanceStatusSchema = z.enum(attendanceStatuses);
export const responseStatusSchema = z.enum(responseStatuses);
export const invitationStatusSchema = z.enum(invitationStatuses);
export const checklistCategorySchema = z.enum(checklistCategories);

// ============================================================================
// Meeting Schemas
// ============================================================================

export const meetingCreateSchema = z
  .object({
    type: meetingTypeSchema,
    title: z.string().max(255).optional(),
    datetime: z.coerce.date({ error: "Date and time is required" }),
    locationId: z.string().uuid().optional(),
    locationName: z.string().max(255).optional(),
    locationAddress: z.string().max(500).optional(),
    estimatedAttendance: z.coerce.number().int().min(0).optional(),
    durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    notes: z.string().optional(),
    agenda: z.any().optional(),
    // Team meeting specific
    teamId: z.string().uuid().optional(),
    meetingSubtype: meetingSubtypeSchema.optional(),
  })
  .refine(
    (data) => {
      // Team meetings require a teamId
      if (data.type === "team_meeting" && !data.teamId) {
        return false;
      }
      return true;
    },
    {
      message: "Team meetings require a team to be selected",
      path: ["teamId"],
    }
  );

export type MeetingCreateInput = z.infer<typeof meetingCreateSchema>;

export const meetingUpdateSchema = z.object({
  title: z.string().max(255).optional(),
  datetime: z.coerce.date().optional(),
  locationId: z.string().uuid().optional().nullable(),
  locationName: z.string().max(255).optional(),
  locationAddress: z.string().max(500).optional(),
  estimatedAttendance: z.coerce.number().int().min(0).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  notes: z.string().optional(),
  status: meetingStatusSchema.optional(),
  meetingSubtype: meetingSubtypeSchema.optional(),
});

export type MeetingUpdateInput = z.infer<typeof meetingUpdateSchema>;

// ============================================================================
// Location Schemas
// ============================================================================

export const locationCreateSchema = z.object({
  name: z
    .string()
    .min(1, "Location name is required")
    .max(255)
    .transform((v) => v.trim()),
  address: z
    .string()
    .min(1, "Address is required")
    .max(500)
    .transform((v) => v.trim()),
  contactName: z.string().max(255).optional(),
  contactPhone: z.string().max(50).optional(),
  contactEmail: z
    .string()
    .email("Invalid email")
    .max(255)
    .optional()
    .or(z.literal("")),
  cost: z.string().max(50).optional(),
  capacity: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export type LocationCreateInput = z.infer<typeof locationCreateSchema>;

export const locationUpdateSchema = locationCreateSchema.partial();

export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;

// ============================================================================
// Attendance Schemas
// ============================================================================

export const attendanceCreateSchema = z.object({
  personId: z.string().uuid("Invalid person"),
  attendanceType: attendanceTypeSchema.optional(),
  status: attendanceStatusSchema.optional(),
  invitedById: z.string().uuid().optional(),
  responseStatus: responseStatusSchema.optional(),
  notes: z.string().optional(),
});

export type AttendanceCreateInput = z.infer<typeof attendanceCreateSchema>;

export const attendeeQuickAddSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(255)
    .transform((v) => v.trim()),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(255)
    .transform((v) => v.trim()),
  email: z
    .string()
    .email("Invalid email")
    .max(255)
    .optional()
    .or(z.literal("")),
  phone: z.string().max(50).optional(),
  attendanceType: attendanceTypeSchema.optional().default("first_time"),
  invitedById: z.string().uuid().optional(),
});

export type AttendeeQuickAddInput = z.infer<typeof attendeeQuickAddSchema>;

export const attendanceBatchSchema = z.object({
  records: z
    .array(
      z.object({
        personId: z.string().uuid(),
        status: attendanceStatusSchema,
      })
    )
    .min(1),
});

export type AttendanceBatchInput = z.infer<typeof attendanceBatchSchema>;

// ============================================================================
// Evaluation Schemas
// ============================================================================

const scoreSchema = z.coerce
  .number()
  .int()
  .min(1, "Score must be at least 1")
  .max(5, "Score must be at most 5");

export const evaluationCreateSchema = z.object({
  attendanceScore: scoreSchema,
  locationScore: scoreSchema,
  logisticsScore: scoreSchema,
  agendaScore: scoreSchema,
  vibeScore: scoreSchema,
  messageScore: scoreSchema,
  closeScore: scoreSchema,
  nextStepsScore: scoreSchema,
  notes: z.string().optional(),
});

export type EvaluationCreateInput = z.infer<typeof evaluationCreateSchema>;

// ============================================================================
// Invitation Schemas
// ============================================================================

export const invitationCreateSchema = z.object({
  inviterId: z.string().uuid("Invalid inviter"),
  inviteeId: z.string().uuid("Invalid invitee"),
  status: invitationStatusSchema.optional().default("invited"),
});

export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;

export const invitationStatusUpdateSchema = z.object({
  status: invitationStatusSchema,
});

// ============================================================================
// Checklist Schemas
// ============================================================================

export const checklistItemUpdateSchema = z.object({
  isChecked: z.boolean().optional(),
  notes: z.string().optional(),
  assignedTo: z.string().uuid().optional().nullable(),
});

export type ChecklistItemUpdateInput = z.infer<
  typeof checklistItemUpdateSchema
>;
