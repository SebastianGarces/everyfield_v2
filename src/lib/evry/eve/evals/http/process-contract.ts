import { z } from "zod";
import { fixtureMessageSchema } from "./transcript";
import { processingSnapshotSchema } from "./processing-snapshot";
import { clarificationMeasurementSchema } from "../contract";

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
          z.strictObject({ optionId: z.string().min(1) }),
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
    expectedTurnFailureMessage: z
      .enum([
        "EVRY_PROCESSING_LIMIT_REACHED",
        "EVRY_SCRIPTED_STREAM_FAILURE",
        "EVRY_SCRIPTED_COMPACTION_FAILURE",
      ])
      .optional(),
    verifyProcessingState: z.boolean().optional(),
    verifyRestart: z.boolean().optional(),
    routing: z
      .array(
        z.discriminatedUnion("status", [
          z.strictObject({
            status: z.literal("available"),
            probabilities: z.record(z.string(), z.number().min(0).max(1)),
          }),
          z.strictObject({
            status: z.literal("unavailable"),
            reason: z.enum(["not_configured", "timeout", "provider_error"]),
          }),
        ])
      )
      .optional(),
    model: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("scripted"),
        responses: z
          .array(
            z.strictObject({
              text: z.string().optional(),
              failStream: z.boolean().optional(),
              failGenerate: z.boolean().optional(),
              usage: z
                .strictObject({
                  inputTokens: z.number().int().nonnegative(),
                  outputTokens: z.number().int().nonnegative(),
                })
                .optional(),
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
  .refine((request) => !request.routing || request.model.mode === "scripted", {
    message: "Injected routing requires a scripted fixture",
    path: ["routing"],
  })
  .refine(
    (request) =>
      !request.verifyProcessingState || request.model.mode === "scripted",
    {
      message: "Processing snapshot proof requires a scripted provider",
      path: ["verifyProcessingState"],
    }
  )
  .refine(
    (request) => !request.verifyRestart || request.model.mode === "scripted",
    {
      message: "Process-restart verification supports scripted providers only",
      path: ["verifyRestart"],
    }
  );
export type CompiledFixtureRequest = z.input<typeof compiledFixtureRequest>;
export const httpEvalOutcomeSchema = z.object({
  routingRequests: z.array(z.json()).optional(),
  processingSnapshots: z.array(processingSnapshotSchema).optional(),
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
      modelRequests: z
        .array(
          z.object({
            tools: z.array(z.string()),
            inputBytes: z.number().int().nonnegative(),
            retainedOriginalRequest: z.boolean().optional(),
            authoredSkills: z
              .array(z.object({ name: z.string(), sha256: z.string() }))
              .optional(),
            toolSchemas: z
              .array(z.object({ name: z.string(), inputSchema: z.json() }))
              .optional(),
            toolErrors: z
              .array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  output: z.unknown(),
                })
              )
              .optional(),
          })
        )
        .optional(),
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
    firstInteractionMs: z.number().nonnegative().nullable().optional(),
    totalMs: z.number(),
  }),
  clarificationCount: z.number(),
  clarificationMeasurement: clarificationMeasurementSchema.optional(),
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
    modelCalls: z.array(
      z.object({
        reservedUsd: z.number(),
        startedMs: z.number().nonnegative(),
        durationMs: z.number().nonnegative().nullable(),
        tools: z.array(z.string()),
        assistantTextHistory: z.array(
          z.object({
            phase: z.enum(["commentary", "final_answer"]).nullable(),
            hasItemId: z.boolean(),
          })
        ),
        inputBytes: z.number(),
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        costUsd: z.number().nullable(),
      })
    ),
  }),
  eveSessionId: z.string(),
});
