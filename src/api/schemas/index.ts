import { z } from "@hono/zod-openapi";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  churches,
  churchMeetings,
  communications,
  communicationRecipients,
  locations,
  ministryTeams,
  persons,
  tasks,
  teamRoles,
  wikiArticles,
  wikiSections,
} from "@/db/schema";
import {
  locations as legacyLocations,
  visionMeetings,
} from "@/db/schema/vision-meetings";
import { composeMessageSchema } from "@/lib/validations/communication";
import {
  meetingCreateSchema,
  meetingUpdateSchema,
} from "@/lib/validations/meetings";
import {
  teamCreateSchema,
  teamUpdateSchema,
} from "@/lib/validations/ministry-teams";
import {
  personCreateSchema,
  personUpdateSchema,
} from "@/lib/validations/people";
import { taskCreateSchema, taskUpdateSchema } from "@/lib/validations/tasks";
import {
  meetingCreateSchema as visionMeetingCreateSchema,
  meetingUpdateSchema as visionMeetingUpdateSchema,
} from "@/lib/validations/vision-meetings";

export const ErrorSchema = z.object({
  error: z.string(),
});

export const IdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: {
        name: "id",
        in: "path",
      },
    }),
});

export const SlugParamSchema = z.object({
  slug: z
    .string()
    .min(1)
    .openapi({
      param: {
        name: "slug",
        in: "path",
      },
    }),
});

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ChurchContextQuerySchema = z.object({
  churchId: z.string().uuid().optional(),
});

export const ChurchSelectSchema = createSelectSchema(churches);
export const ChurchCreateRequestSchema = createInsertSchema(churches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const ChurchUpdateRequestSchema = ChurchCreateRequestSchema.partial();

export const PersonSelectSchema = createSelectSchema(persons);
export const PersonCreateRequestSchema = personCreateSchema;
export const PersonUpdateRequestSchema = personUpdateSchema;

export const TaskSelectSchema = createSelectSchema(tasks);
export const TaskCreateRequestSchema = taskCreateSchema;
export const TaskUpdateRequestSchema = taskUpdateSchema;

export const LocationSelectSchema = createSelectSchema(locations);
export const LegacyLocationSelectSchema = createSelectSchema(legacyLocations);

export const MeetingSelectSchema = createSelectSchema(churchMeetings);
export const MeetingCreateRequestSchema = meetingCreateSchema;
export const MeetingUpdateRequestSchema = meetingUpdateSchema;

export const VisionMeetingSelectSchema = createSelectSchema(visionMeetings);
export const VisionMeetingCreateRequestSchema = visionMeetingCreateSchema;
export const VisionMeetingUpdateRequestSchema = visionMeetingUpdateSchema;

export const TeamSelectSchema = createSelectSchema(ministryTeams);
export const TeamRoleSelectSchema = createSelectSchema(teamRoles);
export const TeamCreateRequestSchema = teamCreateSchema;
export const TeamUpdateRequestSchema = teamUpdateSchema;

export const CommunicationSelectSchema = createSelectSchema(communications);
export const CommunicationRecipientSelectSchema = createSelectSchema(
  communicationRecipients
);
export const CommunicationCreateRequestSchema = composeMessageSchema;

export const WikiArticleSelectSchema = createSelectSchema(wikiArticles);
export const WikiSectionSelectSchema = createSelectSchema(wikiSections);

export const PersonSummarySchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export const MeetingWithCountsSchema = MeetingSelectSchema.extend({
  totalAttendees: z.number().int(),
  newAttendees: z.number().int(),
  returningAttendees: z.number().int(),
  location: LocationSelectSchema.nullable(),
  teamName: z.string().nullable().optional(),
});

export const VisionMeetingWithCountsSchema = VisionMeetingSelectSchema.extend({
  totalAttendees: z.number().int(),
  newAttendees: z.number().int(),
  returningAttendees: z.number().int(),
  location: LegacyLocationSelectSchema.nullable(),
});

export const TaskWithAssigneeSchema = TaskSelectSchema.extend({
  assigneeName: z.string().nullable(),
  assigneeEmail: z.string().nullable(),
});

export const TeamWithStatsSchema = TeamSelectSchema.extend({
  filledRoles: z.number().int(),
  totalRoles: z.number().int(),
  leaderName: z.string().nullable(),
});

export const TeamRoleWithAssigneeSchema = TeamRoleSelectSchema.extend({
  assignedPerson: PersonSummarySchema.nullable(),
});

export const TeamDetailSchema = TeamWithStatsSchema.extend({
  roles: z.array(TeamRoleWithAssigneeSchema),
});

export const CommunicationStatsSchema = z.object({
  total: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  opened: z.number().int(),
  clicked: z.number().int(),
  bounced: z.number().int(),
  failed: z.number().int(),
});

export const CommunicationWithStatsSchema = CommunicationSelectSchema.extend({
  stats: CommunicationStatsSchema,
});

export const RecipientWithPersonSchema =
  CommunicationRecipientSelectSchema.extend({
    person: z.object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string().nullable(),
    }),
  });

export const CommunicationDetailSchema = CommunicationWithStatsSchema.extend({
  recipients: z.array(RecipientWithPersonSchema),
});

export const DashboardMetricsSchema = z.object({
  coreGroupSize: z.number().int(),
  totalPeople: z.number().int(),
  overdueTasks: z.number().int(),
  visionMeetingsHeld: z.number().int(),
});

export const createListResponseSchema = <T extends z.ZodTypeAny>(
  itemSchema: T
) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number().int(),
  });
