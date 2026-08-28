import { z } from "zod";

export const EVRY_TRACE_STAGES = [
  "request",
  "policy",
  "eligibility",
  "handoff",
  "read",
  "planning",
  "confirmation_wait",
  "execution_attempt",
  "execution_outcome",
  "reporting",
] as const;

const safeIdentitySchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/i);
const instantSchema = z.iso.datetime({ offset: true });
const tokenSchema = z.number().int().nonnegative().finite();

export const evryNormalizedUsageSchema = z
  .object({
    model: safeIdentitySchema,
    inputUncachedTokens: tokenSchema,
    inputCacheReadTokens: tokenSchema,
    inputCacheWriteTokens: tokenSchema,
    outputTextTokens: tokenSchema,
    outputReasoningTokens: tokenSchema,
    inputTokens: tokenSchema,
    outputTokens: tokenSchema,
    totalTokens: tokenSchema,
    costUsd: z.number().nonnegative().finite(),
    timeToFirstTokenMs: z.number().nonnegative().finite().nullable(),
  })
  .strict();

export type EvryNormalizedUsage = z.infer<typeof evryNormalizedUsageSchema>;

export const evryGenerationGroupingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request-policy") }).strict(),
  z
    .object({
      kind: z.literal("selected-capability"),
      capabilityIdentity: safeIdentitySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("selected-recipe"),
      recipeIdentity: safeIdentitySchema,
    })
    .strict(),
]);

export type EvryGenerationGrouping = z.infer<
  typeof evryGenerationGroupingSchema
>;

export const evryTraceSpanFieldsSchema = z
  .object({
    spanId: z.string().regex(/^[0-9a-f]{16}$/),
    parentSpanId: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .nullable(),
    stage: z.enum(EVRY_TRACE_STAGES),
    startedAt: instantSchema,
    endedAt: instantSchema,
    durationMs: z.number().nonnegative().finite(),
    status: z.enum(["succeeded", "waiting", "refused", "failed"]),
    resultCode: z.enum([
      "request_received",
      "policy_allowed",
      "policy_refused",
      "eligibility_allowed",
      "eligibility_refused",
      "handoff_selected",
      "read_completed",
      "plan_proposed",
      "confirmation_pending",
      "execution_started",
      "execution_completed",
      "execution_partial",
      "execution_refused",
      "request_failed",
      "reported",
    ]),
    capabilityIdentity: safeIdentitySchema.nullable(),
    details: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("operation") }).strict(),
      z
        .object({
          kind: z.literal("generation"),
          grouping: evryGenerationGroupingSchema,
          usage: evryNormalizedUsageSchema,
        })
        .strict(),
    ]),
  })
  .strict();

export const evryTraceSpanSchema = evryTraceSpanFieldsSchema.superRefine(
  (span, context) => {
    if (span.details.kind !== "generation") return;

    if (span.details.grouping.kind === "request-policy") {
      if (span.stage !== "policy" || span.capabilityIdentity !== null) {
        context.addIssue({
          code: "custom",
          message:
            "request-policy generation must be an unselected policy stage",
        });
      }
      return;
    }

    if (span.details.grouping.kind === "selected-recipe") {
      if (span.stage !== "planning" || span.capabilityIdentity !== null) {
        context.addIssue({
          code: "custom",
          message:
            "selected-recipe generation must be an unselected planning stage",
        });
      }
      return;
    }

    if (
      span.stage === "request" ||
      span.stage === "policy" ||
      span.stage === "eligibility" ||
      span.stage === "handoff" ||
      span.capabilityIdentity !== span.details.grouping.capabilityIdentity
    ) {
      context.addIssue({
        code: "custom",
        message:
          "selected-capability generation must occur after handoff with the same capability identity",
      });
    }
  }
);

export type EvryTraceSpan = z.infer<typeof evryTraceSpanSchema>;

export const evryTraceDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
    correlationId: z.uuid(),
    environment: safeIdentitySchema,
    recipeIdentity: safeIdentitySchema.nullable(),
    startedAt: instantSchema,
    endedAt: instantSchema,
    durationMs: z.number().nonnegative().finite(),
    auditRecordCount: tokenSchema,
    spans: z.array(evryTraceSpanSchema).min(1),
  })
  .strict();

export type EvryTraceDocument = z.infer<typeof evryTraceDocumentSchema>;

/** Validate the final allowlisted document immediately before a sink sees it. */
export function parseEvryTraceDocument(input: unknown): EvryTraceDocument {
  return evryTraceDocumentSchema.parse(input);
}
