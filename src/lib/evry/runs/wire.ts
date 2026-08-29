import { z } from "zod";

import { publicEvryConversationSchema } from "@/lib/evry/conversations/public-contract";

const runBase = {
  requestId: z.string().uuid(),
  kind: z.enum(["conversation", "execution"]),
} as const;

export const evryRunRecoveryResponseSchema = z.union([
  z
    .object({
      status: z.literal("active"),
      ...runBase,
      sequence: z.number().int().nonnegative(),
      stage: z.enum([
        "accepted",
        "resolving_references",
        "revalidating_plan",
        "compiling_response",
        "executing",
      ]),
      conversationId: z.string().uuid().nullable(),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("durable"),
      ...runBase,
      sequence: z.number().int().nonnegative(),
      conversation: publicEvryConversationSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("resumable"),
      requestId: z.string().uuid(),
      kind: z.literal("execution"),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.enum(["expired", "unavailable"]),
      requestId: z.string().uuid(),
    })
    .strict()
    .readonly(),
]);

export type EvryRunRecoveryResponse = z.infer<
  typeof evryRunRecoveryResponseSchema
>;

export function parseEvryRunRecoveryResponse(
  input: unknown
): EvryRunRecoveryResponse {
  return evryRunRecoveryResponseSchema.parse(input);
}
