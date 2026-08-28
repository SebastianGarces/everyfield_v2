import { z } from "zod";

import { evryPageContextSchema } from "@/lib/evry/resolvers/contract";

const publicArtifactSchema = z
  .object({ kind: z.string().min(1) })
  .passthrough();

const publicConversationSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    createdAt: z.string().datetime(),
    lastActivityAt: z.string().datetime(),
    activePlan: z.unknown().nullable(),
    stateVersion: z.number().int().nonnegative(),
    state: z.unknown(),
    messages: z.array(
      z.object({
        id: z.string().uuid(),
        sequence: z.number().int().nonnegative(),
        author: z.enum(["user", "assistant"]),
        body: z.string(),
        pageContext: evryPageContextSchema.nullable(),
        deliveryStatus: z.enum(["complete", "interrupted"]),
        createdAt: z.string().datetime(),
        artifacts: z.array(
          z.object({
            id: z.string().uuid(),
            ordinal: z.number().int().nonnegative(),
            artifact: publicArtifactSchema,
          })
        ),
      })
    ),
  })
  .strict();

export type PublicEvryConversation = z.infer<typeof publicConversationSchema>;

const conversationEnvelopeSchema = z
  .object({
    status: z.enum(["created", "available", "continued", "clarification"]),
    conversation: publicConversationSchema,
  })
  .passthrough();

export function parseEvryConversationEnvelope(
  input: unknown
): PublicEvryConversation {
  return conversationEnvelopeSchema.parse(input).conversation;
}
