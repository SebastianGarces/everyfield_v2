import { z } from "zod";

export const evryRunRecoveryPreviewProofSchema = z
  .object({
    kind: z.enum(["read", "execution"]),
    requestId: z.string().uuid(),
    runId: z.string().uuid(),
    conversationId: z.string().uuid(),
    planId: z.string().uuid().nullable(),
    attemptId: z.string().uuid().nullable(),
    starts: z.number().int().nonnegative(),
    effectCount: z.number().int().nonnegative(),
    stage: z.enum([
      "accepted",
      "resolving_references",
      "revalidating_plan",
      "compiling_response",
      "executing",
      "complete",
      "failed",
    ]),
    result: z.enum(["active", "completed", "failed"]),
  })
  .strict()
  .readonly();

export type EvryRunRecoveryPreviewProof = z.infer<
  typeof evryRunRecoveryPreviewProofSchema
>;

export const evryRunRecoveryPreviewResponseSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("available"),
        proof: evryRunRecoveryPreviewProofSchema,
      })
      .strict()
      .readonly(),
    z
      .object({ status: z.literal("unavailable") })
      .strict()
      .readonly(),
  ]
);

export type EvryRunRecoveryPreviewResponse = z.infer<
  typeof evryRunRecoveryPreviewResponseSchema
>;

export function parseEvryRunRecoveryPreviewResponse(
  input: unknown
): EvryRunRecoveryPreviewResponse {
  return evryRunRecoveryPreviewResponseSchema.parse(input);
}
