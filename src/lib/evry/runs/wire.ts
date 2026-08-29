import { z } from "zod";

import { publicEvryConversationSchema } from "@/lib/evry/conversations/public-contract";

const sequencedRunBase = {
  requestId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
} as const;

export const evryRunRecoveryResponseSchema = z.union([
  z
    .object({
      status: z.literal("active"),
      ...sequencedRunBase,
      kind: z.literal("conversation"),
      operation: z.literal("create"),
      stage: z.enum([
        "accepted",
        "resolving_references",
        "revalidating_plan",
        "compiling_response",
      ]),
      conversationId: z.null(),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("active"),
      ...sequencedRunBase,
      kind: z.literal("conversation"),
      operation: z.literal("continue"),
      stage: z.enum([
        "accepted",
        "resolving_references",
        "revalidating_plan",
        "compiling_response",
      ]),
      conversationId: z.string().uuid(),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("active"),
      ...sequencedRunBase,
      kind: z.literal("execution"),
      operation: z.enum(["execute", "retry"]),
      stage: z.literal("executing"),
      conversationId: z.string().uuid(),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("durable"),
      ...sequencedRunBase,
      kind: z.enum(["conversation", "execution"]),
      conversation: publicEvryConversationSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("resumable"),
      ...sequencedRunBase,
      kind: z.literal("execution"),
      operation: z.enum(["execute", "retry"]),
      conversationId: z.string().uuid(),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("expired"),
      ...sequencedRunBase,
      kind: z.literal("conversation"),
      operation: z.enum(["create", "continue"]),
      conversationId: z.string().uuid().nullable(),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal("unavailable"),
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
