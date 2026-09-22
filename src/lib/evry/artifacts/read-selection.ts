import { z } from "zod";

export const evryReadCountsSchema = z
  .strictObject({
    matched: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    excluded: z.number().int().nonnegative(),
  })
  .readonly();
export const evryReadFilterSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(160),
    value: z.string().max(500),
  })
  .readonly();
export const evryReadExclusionSchema = z
  .strictObject({
    reason: z.string().trim().min(1).max(240),
    count: z.number().int().nonnegative(),
  })
  .readonly();

/** Provenance of a displayed subset, never a new query or a population count. */
export const evryReadSelectionSchema = z
  .strictObject({
    capability: z.string().min(1).max(160),
    sources: z
      .array(
        z.strictObject({
          reference: z.string().min(1).max(240),
          itemIds: z.array(z.string().min(1).max(160)).min(1).max(100),
          counts: evryReadCountsSchema,
          filters: z.array(evryReadFilterSchema).max(16),
          exclusions: z.array(evryReadExclusionSchema).max(16),
        })
      )
      .min(1)
      .max(24),
  })
  .readonly();

export type EvryReadSelection = z.infer<typeof evryReadSelectionSchema>;
