import { z } from "zod";

export const compiledFixtureRequest = z.strictObject({
  compiledEntry: z.string().min(1),
  databaseUrl: z.string().url(),
  proxyUrl: z.string().url(),
  sessionToken: z.string().min(1),
  actor: z.strictObject({ userId: z.string(), plantId: z.string() }),
  turns: z.array(z.string().min(1)).min(1),
  now: z.string().datetime(),
  maxCostUsd: z.number().positive(),
  prices: z.strictObject({
    inputUsdPerMillion: z.number().positive(),
    outputUsdPerMillion: z.number().positive(),
    maxInputBytes: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
  }),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  model: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("scripted"),
      responses: z
        .array(
          z.strictObject({
            text: z.string().optional(),
            toolCalls: z
              .array(
                z.strictObject({
                  name: z.string(),
                  input: z.json().optional(),
                  id: z.string().optional(),
                })
              )
              .optional(),
          })
        )
        .min(1),
    }),
    z.strictObject({
      mode: z.literal("live"),
      spendingApproved: z.literal(true),
    }),
  ]),
});
export type CompiledFixtureRequest = z.input<typeof compiledFixtureRequest>;
export const httpEvalOutcomeSchema = z.object({
  runtimeProof: z
    .object({
      availableTools: z.array(z.string()),
      availableSkills: z.array(z.string()),
      turnInputs: z.array(z.string()),
      modelCalls: z.number(),
      failures: z.array(z.string()),
      eventTypes: z.array(z.string()),
    })
    .optional(),
  answer: z.string(),
  latency: z.object({
    acknowledgementMs: z.number(),
    firstTextMs: z.number().nullable(),
    totalMs: z.number(),
  }),
  clarificationCount: z.number(),
  judge: z.null(),
  costUsd: z.number(),
  hostCapture: z.object({
    calls: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        input: z.unknown(),
        output: z.unknown(),
      })
    ),
    presented: z.array(z.string()),
    freshAuthorizations: z.number(),
    refusedAuthorizations: z.number(),
    outboundMessages: z.number(),
    costUsd: z.number(),
    costBasis: z.enum(["provider_usage", "reserved_upper_bound"]),
  }),
  eveSessionId: z.string(),
});
