import { z } from "zod";

export const eveAttachmentKindSchema = z.enum([
  "people_csv",
  "person_photo",
  "commitment_document",
]);
export type EveAttachmentKind = z.infer<typeof eveAttachmentKindSchema>;
export const eveAttachmentIdSchema = z
  .string()
  .uuid()
  .describe(
    "The attachmentId supplied with an uploaded file in this conversation. Never a file body, signed reference, URL or path."
  );
export const eveAttachmentInputSchema = z.strictObject({
  attachmentId: eveAttachmentIdSchema,
});
export const eveAttachmentDescriptorSchema = eveAttachmentInputSchema.extend({
  kind: eveAttachmentKindSchema,
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  personId: z.string().uuid().nullable(),
});
export type EveAttachmentDescriptor = z.infer<
  typeof eveAttachmentDescriptorSchema
>;
export const eveAttachmentContextSchema = eveAttachmentInputSchema.extend({
  duplicateResolutions: z
    .array(
      z.strictObject({
        rowNumber: z.number().int().min(2).max(27),
        resolution: z.enum(["skip", "create", "merge"]),
      })
    )
    .max(26)
    .optional(),
  commitmentType: z.enum(["core_group", "launch_team"]).optional(),
  signedDate: z.string().date().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
export type EveAttachmentContext = z.infer<typeof eveAttachmentContextSchema>;

export const eveFilePreparations = new Map<string, EveAttachmentKind>([
  ["people.import_file", "people_csv"],
  ["people.upload_photo", "person_photo"],
  ["people.attach_commitment", "commitment_document"],
]);

/** Derive every other argument from the native preparation, replacing only its transport reference. */
export function eveFilePreparationSchema(
  operation: string,
  schema: z.ZodType
): z.ZodType {
  if (!eveFilePreparations.has(operation)) return schema;
  if (!(schema instanceof z.ZodObject) || !schema.shape.reference)
    throw new Error("File preparation must declare its native reference");
  return schema
    .omit({ reference: true })
    .extend({ attachmentId: eveAttachmentIdSchema });
}

export type EveResolvedAttachment = Readonly<{
  reference: string;
  digest: string;
  descriptor: EveAttachmentDescriptor;
}>;
export type EveAttachmentResolver = (
  attachmentId: string,
  kind: EveAttachmentKind
) => Promise<EveResolvedAttachment | null>;
