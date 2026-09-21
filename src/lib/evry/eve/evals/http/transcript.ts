import type { EveMessage } from "eve/client";
import { inputRequestSchema, inputResponseSchema } from "eve/client";
import { z } from "zod";

const approval = z.object({
  id: z.string(),
  reason: z.string().optional(),
  isAutomatic: z.boolean().optional(),
});
const toolBase = z.object({
  type: z.literal("dynamic-tool"),
  toolCallId: z.string(),
  toolName: z.string(),
  stepIndex: z.number().optional(),
  toolMetadata: z
    .object({
      eve: z
        .object({
          kind: z.enum(["load-skill", "subagent-call", "tool-call", "unknown"]),
          name: z.string(),
          inputRequest: inputRequestSchema.omit({ action: true }).optional(),
          inputResponse: inputResponseSchema.optional(),
        })
        .optional(),
    })
    .optional(),
});
const tool = z.discriminatedUnion("state", [
  toolBase.extend({
    state: z.literal("input-streaming"),
    input: z.unknown(),
    inputText: z.string(),
  }),
  toolBase.extend({ state: z.literal("input-available"), input: z.unknown() }),
  toolBase.extend({
    state: z.literal("approval-requested"),
    input: z.unknown(),
    approval: approval.omit({ reason: true }),
  }),
  toolBase.extend({
    state: z.literal("approval-responded"),
    input: z.unknown(),
    approval: approval.extend({ approved: z.boolean().optional() }),
  }),
  toolBase.extend({
    state: z.literal("output-available"),
    input: z.unknown(),
    output: z.unknown(),
    partial: z.literal(true).optional(),
    approval: approval.extend({ approved: z.literal(true) }).optional(),
  }),
  toolBase.extend({
    state: z.literal("output-error"),
    input: z.unknown(),
    errorText: z.string(),
    approval: approval.extend({ approved: z.literal(true) }).optional(),
  }),
  toolBase.extend({
    state: z.literal("output-denied"),
    input: z.unknown(),
    approval: approval.extend({ approved: z.literal(false) }),
  }),
]);
const textPart = z.object({
  type: z.enum(["text", "reasoning"]),
  text: z.string(),
  state: z.enum(["done", "streaming"]).optional(),
  stepIndex: z.number().optional(),
});
export const fixtureMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["assistant", "user"]),
  metadata: z
    .object({
      turnId: z.string().optional(),
      status: z
        .enum(["complete", "failed", "streaming", "submitted"])
        .optional(),
    })
    .optional(),
  parts: z.array(
    z.union([
      textPart,
      tool,
      z.object({ type: z.literal("step-start") }),
      z.object({
        type: z.literal("file"),
        mediaType: z.string(),
        filename: z.string().optional(),
        size: z.number().optional(),
        url: z.string().optional(),
        stepIndex: z.number().optional(),
      }),
    ])
  ),
}) satisfies z.ZodType<EveMessage>;

/** Native reducer data only: omit transport and authorization metadata from test evidence. */
export function fixtureTranscript(messages: readonly EveMessage[]) {
  return messages.map((message) =>
    fixtureMessageSchema.parse({
      id: message.id,
      role: message.role,
      metadata: message.metadata,
      parts: message.parts.filter((part) => part.type !== "authorization"),
    })
  );
}
