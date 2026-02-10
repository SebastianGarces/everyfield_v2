import { z } from "zod";
import {
  communicationChannels,
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

export const communicationFiltersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  channel: z.enum(communicationChannels).optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});
export type CommunicationFilters = z.infer<typeof communicationFiltersSchema>;

export const templateFiltersSchema = z.object({
  category: z.enum(templateCategories).optional(),
  channel: z.enum(communicationChannels).optional(),
});
export type TemplateFilters = z.infer<typeof templateFiltersSchema>;
