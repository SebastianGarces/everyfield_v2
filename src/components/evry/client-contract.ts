import { z } from "zod";

import { evryPublicArtifactSchema } from "@/lib/evry/artifacts/public";
import { evryResolvedPageContextSchema } from "@/lib/evry/resolvers/contract";

const publicActivePlanSchema = z
  .object({
    identity: z
      .object({
        planId: z.string().uuid(),
        fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict()
      .readonly(),
    status: z.enum([
      "draft",
      "awaiting_confirmation",
      "approved",
      "executing",
      "completed",
      "partially_failed",
      "failed",
      "cancelled",
      "superseded",
      "expired",
      "stale",
    ]),
    expiresAt: z.string().datetime().nullable(),
    confirmable: z.boolean(),
  })
  .strict()
  .readonly();

const publicConversationSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    createdAt: z.string().datetime(),
    lastActivityAt: z.string().datetime(),
    activePlan: publicActivePlanSchema.nullable(),
    stateVersion: z.number().int().nonnegative(),
    state: z.unknown(),
    messages: z.array(
      z.object({
        id: z.string().uuid(),
        sequence: z.number().int().nonnegative(),
        author: z.enum(["user", "assistant"]),
        body: z.string(),
        pageContext: evryResolvedPageContextSchema.nullable(),
        deliveryStatus: z.enum(["complete", "interrupted"]),
        createdAt: z.string().datetime(),
        artifacts: z.array(
          z.object({
            id: z.string().uuid(),
            ordinal: z.number().int().nonnegative(),
            artifact: evryPublicArtifactSchema,
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
      status: z.enum(["cancelled", "editing", "executed", "already_finished"]),
      conversation: publicConversationSchema,
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
