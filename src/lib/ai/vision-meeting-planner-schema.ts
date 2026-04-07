import { z } from "zod";

const plannerDateTimeSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid datetime",
  });

export const PlannerMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

export const PlannerSavedLocationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  address: z.string().min(1),
});

export const VisionMeetingDraftSchema = z.object({
  type: z.literal("vision_meeting"),
  datetime: plannerDateTimeSchema.nullable(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().max(255).nullable(),
  locationAddress: z.string().max(500).nullable(),
  estimatedAttendance: z.number().int().min(0).nullable(),
  notes: z.string().nullable(),
});

export const PlannerRequestSchema = z.object({
  messages: z.array(PlannerMessageSchema).min(1),
  draft: VisionMeetingDraftSchema,
});

export const PlannerModelResponseSchema = z.object({
  assistantMessage: z.string().min(1),
  draft: VisionMeetingDraftSchema,
});

export const PlannerResponseSchema = PlannerModelResponseSchema.extend({
  missingFields: z.array(z.enum(["datetime", "location"])),
  readyToCreate: z.boolean(),
  interpretation: z
    .object({
      dateLabel: z.string().optional(),
      datetimeLabel: z.string().optional(),
      locationLabel: z.string().optional(),
    })
    .optional(),
});

export type PlannerMessage = z.infer<typeof PlannerMessageSchema>;
export type PlannerRequest = z.infer<typeof PlannerRequestSchema>;
export type PlannerResponse = z.infer<typeof PlannerResponseSchema>;
export type PlannerSavedLocation = z.infer<typeof PlannerSavedLocationSchema>;
export type VisionMeetingDraft = z.infer<typeof VisionMeetingDraftSchema>;

export const initialVisionMeetingDraft: VisionMeetingDraft = {
  type: "vision_meeting",
  datetime: null,
  locationId: null,
  locationName: null,
  locationAddress: null,
  estimatedAttendance: null,
  notes: null,
};

export function serializeDraftForCreate(draft: VisionMeetingDraft) {
  return {
    type: "vision_meeting" as const,
    datetime: draft.datetime,
    ...(draft.locationId ? { locationId: draft.locationId } : {}),
    ...(draft.locationName ? { locationName: draft.locationName } : {}),
    ...(draft.locationAddress
      ? { locationAddress: draft.locationAddress }
      : {}),
    ...(draft.estimatedAttendance != null
      ? { estimatedAttendance: draft.estimatedAttendance }
      : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
  };
}
