import { z } from "zod";

import {
  EVRY_CONVERSATION_DURABLE_RESULT_CODES,
  evryConversationPlanIdentitySchema,
  evryConversationResultCodeFor,
} from "@/lib/evry/conversations/contract";

import {
  evryConfirmationDateTimeDocumentSchema,
  trustedEvryApplicationSourceLink,
} from "./types";

export const EVRY_REVIEW_ARTIFACT_VERSION = 1 as const;

const semanticIdSchema = z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/);
const titleSchema = z.string().trim().min(1).max(200);
const labelSchema = z.string().trim().min(1).max(160);
const displayTextSchema = z.string().trim().min(1).max(4_000);
const countSchema = z.number().int().nonnegative();

export const evryReviewSourceLinkSchema = z
  .strictObject({
    label: labelSchema,
    href: z.string().min(1).max(500),
  })
  .refine((link) => {
    try {
      trustedEvryApplicationSourceLink(link);
      return true;
    } catch {
      return false;
    }
  }, "Evry review links must be application paths")
  .readonly();

const resolvedTargetSchema = z
  .strictObject({
    label: labelSchema,
    value: displayTextSchema,
    sourceLink: evryReviewSourceLinkSchema.nullable(),
  })
  .readonly();

const reviewCountSchema = z
  .strictObject({ label: labelSchema, count: countSchema })
  .readonly();

const reviewExclusionSchema = z
  .strictObject({
    reason: displayTextSchema,
    count: z.number().int().positive(),
  })
  .readonly();

const contentPreviewSchema = z
  .strictObject({
    label: labelSchema,
    content: displayTextSchema,
  })
  .readonly();

const beforeAfterSchema = z
  .strictObject({
    label: labelSchema,
    before: displayTextSchema,
    after: displayTextSchema,
    count: z.number().int().positive(),
  })
  .readonly();

export const evryConfirmationDateTimeRangeSchema = z
  .strictObject({
    startsAt: evryConfirmationDateTimeDocumentSchema,
    endsAt: evryConfirmationDateTimeDocumentSchema.nullable(),
  })
  .superRefine((range, context) => {
    if (!range.endsAt) return;
    if (
      range.endsAt.timeZone !== range.startsAt.timeZone ||
      new Date(range.endsAt.instantUtc) <= new Date(range.startsAt.instantUtc)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Evry confirmation end time must follow its start time",
      });
    }
  })
  .readonly();

export const EVRY_CONFIRMATION_EFFECT_KINDS = [
  "meeting",
  "bulk_change",
  "file_import",
  "destructive",
  "communication",
  "other",
] as const;

const confirmationStepSchema = z
  .strictObject({
    stepId: semanticIdSchema,
    title: titleSchema,
    effectKind: z.enum(EVRY_CONFIRMATION_EFFECT_KINDS),
    reversibility: z.enum([
      "reversible",
      "difficult_to_reverse",
      "irreversible",
    ]),
    resolvedTargets: z.array(resolvedTargetSchema).min(1).max(100).readonly(),
    counts: z.array(reviewCountSchema).min(1).max(16).readonly(),
    exclusions: z.array(reviewExclusionSchema).max(32).readonly(),
    dateTime: evryConfirmationDateTimeRangeSchema.nullable(),
    contentPreviews: z.array(contentPreviewSchema).max(8).readonly(),
    beforeAfter: z.array(beforeAfterSchema).max(32).readonly(),
  })
  .superRefine((step, context) => {
    if (step.effectKind === "meeting" && step.dateTime === null) {
      context.addIssue({
        code: "custom",
        path: ["dateTime"],
        message: "Meeting confirmation steps require absolute timing",
      });
    }
    if (
      step.effectKind === "communication" &&
      step.contentPreviews.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["contentPreviews"],
        message: "Communication confirmation steps require a content preview",
      });
    }
    if (
      (step.effectKind === "bulk_change" ||
        step.effectKind === "destructive" ||
        step.reversibility !== "reversible") &&
      step.beforeAfter.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["beforeAfter"],
        message:
          "Bulk and difficult-to-reverse changes require before-and-after disclosure",
      });
    }
  })
  .readonly();

/** Complete versioned review document for one exact immutable plan. */
export const evryDetailedConfirmationArtifactDocumentSchema = z
  .strictObject({
    kind: z.literal("confirmation"),
    artifactVersion: z.literal(EVRY_REVIEW_ARTIFACT_VERSION),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    actionLabel: labelSchema,
    steps: z.array(confirmationStepSchema).min(1).max(32).readonly(),
    consequences: z.array(displayTextSchema).min(1).max(16).readonly(),
  })
  .superRefine((artifact, context) => {
    const stepIds = artifact.steps.map(({ stepId }) => stepId);
    if (new Set(stepIds).size !== stepIds.length) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Evry confirmation steps must be unique",
      });
    }
  })
  .readonly();

export type EvryDetailedConfirmationArtifactDocument = z.infer<
  typeof evryDetailedConfirmationArtifactDocumentSchema
>;

export const EVRY_UNEXPECTED_ERROR_COPY =
  "Evry couldn't complete this step. Try again later or contact support.";

export const evryArtifactErrorSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("expected"),
      message: z.string().trim().min(1).max(500),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("unexpected"),
      correlationId: z.string().uuid(),
    })
    .readonly(),
]);

export type EvryArtifactError = z.infer<typeof evryArtifactErrorSchema>;

export const EVRY_ARTIFACT_STEP_STATUSES = [
  "pending",
  "active",
  "safe_retry",
  "completed",
  "refused",
  "failed",
  "skipped",
] as const;

const progressStepSchema = z
  .strictObject({
    stepId: semanticIdSchema,
    label: labelSchema,
    status: z.enum(EVRY_ARTIFACT_STEP_STATUSES),
    affectedCount: countSchema,
    excludedCount: countSchema,
  })
  .readonly();

export const evryDetailedProgressArtifactDocumentSchema = z
  .strictObject({
    kind: z.literal("progress"),
    artifactVersion: z.literal(EVRY_REVIEW_ARTIFACT_VERSION),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    steps: z.array(progressStepSchema).min(1).max(32).readonly(),
    error: evryArtifactErrorSchema.nullable().default(null),
  })
  .superRefine((artifact, context) => {
    const stepIds = artifact.steps.map(({ stepId }) => stepId);
    if (new Set(stepIds).size !== stepIds.length) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Evry progress steps must be unique",
      });
    }
    if (artifact.steps.filter(({ status }) => status === "active").length > 1) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Evry progress may name only one active step",
      });
    }
    const hasSafeRetry = artifact.steps.some(
      ({ status }) => status === "safe_retry"
    );
    if (
      hasSafeRetry &&
      artifact.steps.some(({ status }) => status === "active")
    ) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Evry progress cannot run and await a safe retry at once",
      });
    }
    if (hasSafeRetry === (artifact.error === null)) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Evry safe-retry progress requires one public error",
      });
    }
  })
  .readonly();

export type EvryDetailedProgressArtifactDocument = z.infer<
  typeof evryDetailedProgressArtifactDocumentSchema
>;

const retryStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unavailable") }).readonly(),
  z
    .strictObject({
      status: z.literal("safe_retry"),
      label: z.string().trim().min(1).max(160),
    })
    .readonly(),
]);

const receiptStepSchema = z
  .strictObject({
    stepId: semanticIdSchema,
    label: labelSchema,
    status: z.enum(["completed", "failed", "refused", "skipped"]),
    resultCode: z.enum(EVRY_CONVERSATION_DURABLE_RESULT_CODES),
    affectedCount: countSchema,
    excludedCount: countSchema,
    sourceLinks: z.array(evryReviewSourceLinkSchema).max(16).readonly(),
    retry: retryStateSchema,
    error: evryArtifactErrorSchema.nullable(),
  })
  .superRefine((step, context) => {
    if (step.resultCode !== evryConversationResultCodeFor(step.status)) {
      context.addIssue({
        code: "custom",
        path: ["resultCode"],
        message: "Evry receipt status and result code must agree",
      });
    }
    if (step.status === "completed" && step.error !== null) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Completed Evry steps cannot carry errors",
      });
    }
    if (
      (step.status === "failed" || step.status === "refused") &&
      step.error === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Failed and refused Evry steps require a safe public error",
      });
    }
    if (step.retry.status === "safe_retry" && step.status !== "failed") {
      context.addIssue({
        code: "custom",
        path: ["retry"],
        message: "Only a failed Evry step may offer a safe retry",
      });
    }
  })
  .readonly();

export const evryDetailedReceiptArtifactDocumentSchema = z
  .strictObject({
    kind: z.literal("result"),
    artifactVersion: z.literal(EVRY_REVIEW_ARTIFACT_VERSION),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    status: z.enum(["completed", "partially_failed", "failed", "refused"]),
    steps: z.array(receiptStepSchema).min(1).max(32).readonly(),
  })
  .superRefine((artifact, context) => {
    const stepIds = artifact.steps.map(({ stepId }) => stepId);
    if (new Set(stepIds).size !== stepIds.length) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Evry receipt steps must be unique",
      });
    }
    const expectedStatus = artifact.steps.every(
      ({ status }) => status === "completed"
    )
      ? "completed"
      : artifact.steps.some(({ status }) => status === "completed")
        ? "partially_failed"
        : artifact.steps.some(({ status }) => status === "refused")
          ? "refused"
          : "failed";
    if (artifact.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Evry receipt status must match its step outcomes",
      });
    }
  })
  .readonly();

export type EvryDetailedReceiptArtifactDocument = z.infer<
  typeof evryDetailedReceiptArtifactDocumentSchema
>;

export function deepFreezeEvryArtifact<T>(value: T): T {
  if (value && typeof value === "object") {
    if (!Object.isFrozen(value)) Object.freeze(value);
    for (const child of Object.values(value)) deepFreezeEvryArtifact(child);
  }
  return value;
}

export function buildEvryConfirmationArtifact(
  input: z.input<typeof evryDetailedConfirmationArtifactDocumentSchema>
): EvryDetailedConfirmationArtifactDocument {
  return deepFreezeEvryArtifact(
    evryDetailedConfirmationArtifactDocumentSchema.parse(input)
  );
}

export function buildEvryProgressArtifact(
  input: z.input<typeof evryDetailedProgressArtifactDocumentSchema>
): EvryDetailedProgressArtifactDocument {
  return deepFreezeEvryArtifact(
    evryDetailedProgressArtifactDocumentSchema.parse(input)
  );
}

export function buildEvryReceiptArtifact(
  input: z.input<typeof evryDetailedReceiptArtifactDocumentSchema>
): EvryDetailedReceiptArtifactDocument {
  return deepFreezeEvryArtifact(
    evryDetailedReceiptArtifactDocumentSchema.parse(input)
  );
}
