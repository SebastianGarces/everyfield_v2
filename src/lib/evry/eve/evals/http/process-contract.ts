import { z } from "zod";
import { fixtureMessageSchema } from "./transcript";

export const compiledFixtureRequest = z
  .strictObject({
    compiledEntry: z.string().min(1),
    databaseUrl: z.string().url(),
    proxyUrl: z.string().url(),
    sessionToken: z.string().min(1),
    actor: z.strictObject({ userId: z.string(), plantId: z.string() }),
    turns: z
      .array(
        z.union([
          z.string().min(1),
          z.strictObject({ respond: z.string().min(1) }),
        ])
      )
      .min(1),
    now: z.string().datetime(),
    maxCostUsd: z.number().positive(),
    prices: z.strictObject({
      inputUsdPerMillion: z.number().positive(),
      outputUsdPerMillion: z.number().positive(),
      maxInputBytes: z.number().int().positive(),
      maxOutputTokens: z.number().int().positive(),
    }),
    timeoutMs: z.number().int().positive().max(600_000).default(120_000),
    verifyReplay: z.boolean().optional(),
    verifyRestart: z.boolean().optional(),
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
  })
  .refine(
    (request) => !request.verifyRestart || request.model.mode === "scripted",
    {
      message: "Process-restart verification supports scripted providers only",
      path: ["verifyRestart"],
    }
  );
export type CompiledFixtureRequest = z.input<typeof compiledFixtureRequest>;
export const httpEvalOutcomeSchema = z.object({
  restart: z
    .object({
      matchingTranscript: z.boolean(),
      sameSession: z.boolean(),
      differentProcess: z.boolean(),
      firstPid: z.number().int().positive(),
      replacementPid: z.number().int().positive(),
      modelCalls: z.number().int(),
      generations: z.number().int(),
      invocations: z.number().int(),
      outboundMessages: z.number().int(),
      capturedCalls: z.number().int(),
    })
    .optional(),
  replay: z
    .object({
      matchingTranscript: z.boolean(),
      stableActivity: z.boolean(),
      stableCapture: z.boolean(),
      snapshots: z.number().int(),
      eventCount: z.number().int(),
      generationsBefore: z.number().int(),
      generationsAfter: z.number().int(),
      invocationsBefore: z.number().int(),
      invocationsAfter: z.number().int(),
    })
    .optional(),
  messages: z.array(fixtureMessageSchema),
  runtimeProof: z
    .object({
      availableTools: z.array(z.string()),
      availableSkills: z.array(z.string()),
      turnInputs: z.array(z.string()),
      questionAnswers: z.array(z.string()),
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
