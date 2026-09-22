import { z } from "zod";
import { fixtureMessageSchema } from "./transcript";
import { processingSnapshotSchema } from "./processing-snapshot";
import { clarificationMeasurementSchema } from "../contract";
import { taskPreparationAssertionSchema } from "./task-state-script";
import {
  presentationAssertionSchema,
  presentationReceiptSchema,
  presentationInventoryRequestSchema,
  presentationInventoryReceiptSchema,
} from "../../../../../../scripts/evry-eve-presentation-proof";
import {
  sourceRecoveryFaultSchema,
  sourceRecoveryRequest,
  sourceRecoverySetup,
} from "../fixtures/source-recovery";

export const fixtureTurnSchema = z.union([
  z.string().min(1),
  z.strictObject({ respond: z.string().min(1) }),
  // Optional fixture context is supplied only for a native pending question.
  // Plain prose is deliberately not classified as a question by this runner.
  z.strictObject({ respondIfAsked: z.string().min(1) }),
  z.strictObject({ optionId: z.string().min(1) }),
]);
export type FixtureTurn = z.infer<typeof fixtureTurnSchema>;

export const sourceRecoveryPreparationPrompt =
  "Prepare to mark Next orientation ready for my review.";

const restartFollowupSchema = z.strictObject({
  turn: z.string().min(1).max(4_000),
  responses: z
    .array(
      z.strictObject({
        text: z.string().optional(),
        assertPresentation: presentationAssertionSchema.optional(),
        toolCalls: z
          .array(
            z.strictObject({
              name: z.string(),
              input: z.json().optional(),
              id: z.string().optional(),
            })
          )
          .max(8)
          .optional(),
      })
    )
    .min(1)
    .max(8),
});

export const compiledFixtureRequest = z
  .strictObject({
    compiledEntry: z.string().min(1),
    databaseUrl: z.string().url(),
    proxyUrl: z.string().url(),
    sessionToken: z.string().min(1),
    actor: z.strictObject({ userId: z.string(), plantId: z.string() }),
    turns: z.array(fixtureTurnSchema).min(1),
    /** Host-only opt-in, never a model tool or user message field. */
    sourceRecovery: z.literal("edges-13").optional(),
    /** Fixture-owned bytes delivered by native staging, never pasted into a model turn. */
    attachments: z
      .array(
        z.strictObject({
          turnIndex: z.number().int().nonnegative(),
          kind: z.enum(["people_csv", "person_photo", "commitment_document"]),
          name: z.string().min(1).max(255),
          contentType: z.string().min(1).max(100),
          bytesBase64: z
            .string()
            .min(1)
            .max(14_000_000)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          personId: z.string().uuid().nullable(),
        })
      )
      .max(4)
      .optional(),
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
    /** Separate scripted POST proof; verifyRestart remains strictly GET-only. */
    restartFollowup: restartFollowupSchema.optional(),
    verifyPresentationInventory: presentationInventoryRequestSchema.optional(),
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
        /** Neutral summary for actual framework compaction calls, not an extra user turn. */
        compactionSummary: z.string().min(1).max(4_000).optional(),
        responses: z
          .array(
            z
              .strictObject({
                text: z.string().optional(),
                assertPresentation: presentationAssertionSchema.optional(),
                failStream: z.boolean().optional(),
                failGenerate: z.boolean().optional(),
                taskPreparation: taskPreparationAssertionSchema.optional(),
                assertTaskState: taskPreparationAssertionSchema
                  .omit({ callId: true })
                  .optional(),
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
              .refine(
                (response) =>
                  !response.taskPreparation ||
                  (response.toolCalls === undefined &&
                    !response.assertTaskState),
                {
                  message:
                    "Observed task preparation supplies its own tool call",
                  path: ["taskPreparation"],
                }
              )
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
    (request) =>
      !request.sourceRecovery ||
      (((request.turns.length === 2 &&
        request.turns[0] === sourceRecoverySetup &&
        request.turns[1] === sourceRecoveryRequest) ||
        (request.model.mode === "scripted" &&
          request.turns.length === 1 &&
          request.turns[0] === sourceRecoveryPreparationPrompt)) &&
        !request.verifyRestart &&
        !request.restartFollowup &&
        !request.attachments),
    {
      message:
        "Source recovery fault requires unchanged edges-13 turns or the scripted preparation proof",
      path: ["sourceRecovery"],
    }
  )
  .refine(
    (request) =>
      !request.attachments ||
      (new Set(request.attachments.map((item) => item.turnIndex)).size ===
        request.attachments.length &&
        request.attachments.every(
          (item) => item.turnIndex < request.turns.length
        )),
    {
      message: "Attachments need distinct existing turn indices",
      path: ["attachments"],
    }
  )
  .refine((request) => !request.routing || request.model.mode === "scripted", {
    message: "Injected routing requires a scripted fixture",
    path: ["routing"],
  })
  .refine(
    (request) =>
      !request.verifyPresentationInventory || request.model.mode === "scripted",
    {
      message: "Presentation inventory proof requires a scripted provider",
      path: ["verifyPresentationInventory"],
    }
  )
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
  )
  .refine(
    (request) =>
      !request.restartFollowup ||
      (request.model.mode === "scripted" &&
        !request.verifyRestart &&
        !request.attachments &&
        !request.expectedTurnFailureMessage),
    {
      message:
        "Restart follow-up requires a separate scripted run without GET-only restart, attachments or expected failures",
      path: ["restartFollowup"],
    }
  );
export type CompiledFixtureRequest = z.input<typeof compiledFixtureRequest>;
const httpEvalBaseOutcomeSchema = z.object({
  /** Generated only by the worker's actual dependency fault, not hostCapture/model output. */
  sourceRecoveryFaults: z.array(sourceRecoveryFaultSchema).max(1).optional(),
  followupRestore: z
    .object({
      messages: z.array(fixtureMessageSchema),
      generations: z.number().int().nonnegative(),
      invocations: z.number().int().nonnegative(),
      capturedCalls: z.number().int().nonnegative(),
    })
    .optional(),
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
      presentationInventory: presentationInventoryReceiptSchema.optional(),
      attachments: z
        .array(
          z.object({
            turnIndex: z.number().int().nonnegative(),
            attachmentId: z.string().uuid(),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            modelSawBinding: z.boolean().nullable(),
            rawReferenceHiddenFromModel: z.boolean().nullable(),
            rawReferenceHiddenFromOutput: z.boolean(),
          })
        )
        .optional(),
      availableTools: z.array(z.string()),
      modelRequests: z
        .array(
          z.object({
            tools: z.array(z.string()),
            inputBytes: z.number().int().nonnegative(),
            retainedOriginalRequest: z.boolean().optional(),
            compaction: z.boolean().optional(),
            presentation: presentationReceiptSchema.optional(),
            observedTask: z
              .object({
                draftCallId: z.string(),
                revision: z.number().int(),
                factKeys: z.array(z.string()),
              })
              .optional(),
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
      compactions: z
        .array(
          z.object({
            type: z.enum(["compaction.requested", "compaction.completed"]),
            turnId: z.string(),
            sequence: z.number().int(),
          })
        )
        .optional(),
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
export const httpEvalOutcomeSchema = httpEvalBaseOutcomeSchema.extend({
  restartFollowup: z
    .object({
      sameSession: z.boolean(),
      differentProcess: z.boolean(),
      firstPid: z.number().int().positive(),
      replacementPid: z.number().int().positive(),
      restoredTranscript: z.boolean(),
      outcome: httpEvalBaseOutcomeSchema,
    })
    .optional(),
});
