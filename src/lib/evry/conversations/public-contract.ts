import { z } from "zod";

import { evryPublicArtifactSchema } from "@/lib/evry/artifacts/public";
import { evryResolvedPageContextSchema } from "@/lib/evry/resolvers/contract";

export const publicEvryActivePlanSchema = z
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

export const publicEvryConversationSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    createdAt: z.string().datetime(),
    lastActivityAt: z.string().datetime(),
    activePlan: publicEvryActivePlanSchema.nullable(),
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

export type PublicEvryConversation = z.infer<
  typeof publicEvryConversationSchema
>;

export const evryConversationEnvelopeSchema = z
  .object({
    status: z.enum(["created", "available", "continued", "clarification"]),
    conversation: publicEvryConversationSchema,
  })
  .passthrough();
