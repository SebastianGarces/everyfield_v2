import { z } from "zod";
import {
  meetingSubtypeSchema,
  meetingTypeSchema,
  type MeetingCreateInput,
} from "@/lib/validations/meetings";

const draftDateTimeSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid datetime",
  });

export const MeetingDraftMissingFieldSchema = z.enum([
  "meetingType",
  "datetime",
  "location",
  "team",
]);

export const AssistantMeetingDraftSchema = z.object({
  type: meetingTypeSchema.nullable(),
  title: z.string().max(255).nullable(),
  datetime: draftDateTimeSchema.nullable(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().max(255).nullable(),
  locationAddress: z.string().max(500).nullable(),
  estimatedAttendance: z.number().int().min(0).nullable(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  notes: z.string().nullable(),
  teamId: z.string().uuid().nullable(),
  teamName: z.string().max(255).nullable(),
  meetingSubtype: meetingSubtypeSchema.nullable(),
});

export const MeetingDraftInterpretationSchema = z.object({
  meetingTypeLabel: z.string().optional(),
  titleLabel: z.string().optional(),
  dateLabel: z.string().optional(),
  datetimeLabel: z.string().optional(),
  locationLabel: z.string().optional(),
  teamLabel: z.string().optional(),
});

export const MeetingDraftArtifactStatusSchema = z.enum([
  "collecting",
  "ready",
  "created",
]);

export const MeetingDraftArtifactPayloadSchema = z.object({
  type: z.literal("meeting_draft"),
  status: MeetingDraftArtifactStatusSchema,
  draft: AssistantMeetingDraftSchema,
  missingFields: z.array(MeetingDraftMissingFieldSchema),
  interpretation: MeetingDraftInterpretationSchema.optional(),
  createdMeetingId: z.string().uuid().nullable(),
  createdMeetingHref: z.string().nullable(),
});

export type AssistantMeetingDraft = z.infer<typeof AssistantMeetingDraftSchema>;
export type MeetingDraftMissingField = z.infer<
  typeof MeetingDraftMissingFieldSchema
>;
export type MeetingDraftInterpretation = z.infer<
  typeof MeetingDraftInterpretationSchema
>;
export type MeetingDraftArtifactStatus = z.infer<
  typeof MeetingDraftArtifactStatusSchema
>;
export type MeetingDraftArtifactPayload = z.infer<
  typeof MeetingDraftArtifactPayloadSchema
>;

export const initialAssistantMeetingDraft: AssistantMeetingDraft = {
  type: null,
  title: null,
  datetime: null,
  locationId: null,
  locationName: null,
  locationAddress: null,
  estimatedAttendance: null,
  durationMinutes: null,
  notes: null,
  teamId: null,
  teamName: null,
  meetingSubtype: null,
};

const meetingTypeLabels = {
  vision_meeting: "Vision Meeting",
  orientation: "Orientation",
  team_meeting: "Team Meeting",
} as const;

const meetingSubtypeLabels = {
  regular: "Regular",
  training: "Training",
  planning: "Planning",
  special: "Special",
  rehearsal: "Rehearsal",
} as const;

export function getMeetingTypeLabel(
  type: AssistantMeetingDraft["type"] | null | undefined
) {
  if (!type) {
    return "Not set";
  }

  return meetingTypeLabels[type];
}

export function getMeetingSubtypeLabel(
  subtype: AssistantMeetingDraft["meetingSubtype"] | null | undefined
) {
  if (!subtype) {
    return "Not set";
  }

  return meetingSubtypeLabels[subtype];
}

export function hasMeetingLocation(draft: AssistantMeetingDraft) {
  return !!draft.locationId || !!(draft.locationName && draft.locationAddress);
}

export function getMeetingDraftTitle(draft: AssistantMeetingDraft) {
  if (draft.type === "vision_meeting") {
    return "Vision Meeting";
  }

  if (draft.title?.trim()) {
    return draft.title.trim();
  }

  if (draft.type === "orientation") {
    return "Orientation";
  }

  if (draft.type === "team_meeting") {
    const teamName = draft.teamName?.trim() || "Team";

    switch (draft.meetingSubtype ?? "regular") {
      case "training":
        return `${teamName} Training`;
      case "planning":
        return `${teamName} Planning Meeting`;
      case "special":
        return `${teamName} Special Meeting`;
      case "rehearsal":
        return `${teamName} Rehearsal`;
      default:
        return `${teamName} Meeting`;
    }
  }

  return "Meeting";
}

export function serializeMeetingDraftForCreate(
  draft: AssistantMeetingDraft
): MeetingCreateInput {
  if (!draft.type || !draft.datetime) {
    throw new Error("Meeting draft is missing required fields");
  }

  return {
    type: draft.type,
    ...(draft.type !== "vision_meeting"
      ? { title: getMeetingDraftTitle(draft) }
      : {}),
    datetime: new Date(draft.datetime),
    ...(draft.locationId ? { locationId: draft.locationId } : {}),
    ...(draft.locationName ? { locationName: draft.locationName } : {}),
    ...(draft.locationAddress
      ? { locationAddress: draft.locationAddress }
      : {}),
    ...(draft.estimatedAttendance != null
      ? { estimatedAttendance: draft.estimatedAttendance }
      : {}),
    ...(draft.durationMinutes != null
      ? { durationMinutes: draft.durationMinutes }
      : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
    ...(draft.teamId ? { teamId: draft.teamId } : {}),
    ...(draft.type === "team_meeting"
      ? { meetingSubtype: draft.meetingSubtype ?? "regular" }
      : {}),
  };
}

export function getMeetingDraftArtifactPayload(
  artifacts: Array<{ kind: string; payload: unknown }>
): MeetingDraftArtifactPayload | null {
  for (const artifact of artifacts) {
    if (artifact.kind !== "meeting_draft") {
      continue;
    }

    const parsed = MeetingDraftArtifactPayloadSchema.safeParse(
      artifact.payload
    );

    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
}
