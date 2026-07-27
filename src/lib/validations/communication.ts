import { z } from "zod";
import {
  communicationChannels,
  communicationStatuses,
  templateCategories,
} from "@/db/schema/communication";

// ---------------------------------------------------------------------------
// Compose / Send Message
// ---------------------------------------------------------------------------

export const composeMessageSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(500),
  body: z.string().min(1, "Message body is required"),
  channel: z.enum(communicationChannels).default("email"),
  templateId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  /** Array of person IDs */
  recipientIds: z
    .array(z.string().uuid())
    .min(1, "At least one recipient is required"),
});
export type ComposeMessageInput = z.infer<typeof composeMessageSchema>;

// ---------------------------------------------------------------------------
// Template CRUD
// ---------------------------------------------------------------------------

export const createTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required").max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(templateCategories),
  channel: z.enum(communicationChannels).default("email"),
  subject: z.string().max(500).optional(),
  body: z.string().min(1, "Template body is required"),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = createTemplateSchema.partial();
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

// A history URL is user-typed and bookmarkable, so every field falls back
// rather than throwing: an unknown channel is a filter we cannot honour, not a
// broken page. `.catch()` drops the offending value and keeps the rest.
export const communicationFiltersSchema = z.object({
  page: z.coerce.number().int().positive().catch(1),
  limit: z.coerce.number().int().positive().max(100).catch(20),
  channel: z.enum(communicationChannels).optional().catch(undefined),
  status: z.enum(communicationStatuses).optional().catch(undefined),
  search: z.string().trim().min(1).optional().catch(undefined),
});
export type CommunicationFilters = z.infer<typeof communicationFiltersSchema>;

/**
 * Parse Next.js `searchParams` into communication filters.
 * Repeated params (`?channel=email&channel=sms`) collapse to the first value;
 * unparseable values are ignored, never thrown.
 */
export function parseCommunicationFilters(
  params: Record<string, string | string[] | undefined>
): CommunicationFilters {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  return communicationFiltersSchema.parse({
    page: first(params.page),
    limit: first(params.limit),
    channel: first(params.channel),
    status: first(params.status),
    search: first(params.search),
  });
}

export const templateFiltersSchema = z.object({
  category: z.enum(templateCategories).optional(),
  channel: z.enum(communicationChannels).optional(),
});
export type TemplateFilters = z.infer<typeof templateFiltersSchema>;
