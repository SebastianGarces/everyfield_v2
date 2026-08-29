import { z } from "zod";

import {
  evryConversationEnvelopeSchema,
  publicEvryConversationSchema,
  type PublicEvryConversation,
} from "@/lib/evry/conversations/public-contract";

export type { PublicEvryConversation };

export function parseEvryConversationEnvelope(
  input: unknown
): PublicEvryConversation {
  return evryConversationEnvelopeSchema.parse(input).conversation;
}

const artifactLifecycleErrorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("expected"),
      message: z.string().trim().min(1).max(500),
    })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("unexpected"), correlationId: z.string().uuid() })
    .strict()
    .readonly(),
]);

const artifactLifecycleResponseSchema = z.union([
  z
    .object({
      status: z.enum([
        "cancelled",
        "editing",
        "executed",
        "retryable",
        "already_finished",
      ]),
      conversation: publicEvryConversationSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.enum(["unavailable", "failed"]),
      error: artifactLifecycleErrorSchema,
    })
    .strict()
    .readonly(),
]);

export type EvryArtifactLifecycleResponse = z.infer<
  typeof artifactLifecycleResponseSchema
>;

export function parseEvryArtifactLifecycleResponse(
  input: unknown
): EvryArtifactLifecycleResponse {
  return artifactLifecycleResponseSchema.parse(input);
}
