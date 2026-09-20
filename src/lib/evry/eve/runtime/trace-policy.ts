import { z } from "zod";

/** Closed metadata approved for Langfuse; raw errors, identities and content are absent. */
export const eveTraceMetadataSchema = z
  .object({
    operation: z.enum(["model", "tool"]),
    name: z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/),
    status: z.enum([
      "completed",
      "failed",
      "cancelled",
      "rejected",
      "abandoned",
    ]),
    durationMs: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type EveTraceMetadata = z.infer<typeof eveTraceMetadataSchema>;
