import { z } from "zod";

import type { EvryHydratedConversationArtifact } from "@/lib/evry/conversations/artifacts";
import {
  EVRY_CONVERSATION_DURABLE_RESULT_CODES,
  EVRY_READ_ITEM_MAX_FACTS,
  evryConversationPlanIdentitySchema,
  storedEvryArtifactFactSchema,
} from "@/lib/evry/conversations/contract";

import {
  evryDetailedConfirmationArtifactDocumentSchema,
  evryDetailedProgressArtifactDocumentSchema,
  evryDetailedReceiptArtifactDocumentSchema,
  evryReviewSourceLinkSchema,
} from "./review";

const titleSchema = z.string().trim().min(1).max(200);
const labelSchema = z.string().trim().min(1).max(160);

const publicReadArtifactSchema = z
  .strictObject({
    kind: z.literal("read"),
    title: titleSchema,
    filters: z
      .array(
        z
          .strictObject({ label: labelSchema, value: z.string().max(500) })
          .readonly()
      )
      .max(16),
    counts: z
      .strictObject({
        matched: z.number().int().nonnegative(),
        returned: z.number().int().nonnegative(),
        excluded: z.number().int().nonnegative(),
      })
      .readonly(),
    exclusions: z
      .array(
        z
          .strictObject({
            reason: z.string().trim().min(1).max(240),
            count: z.number().int().nonnegative(),
          })
          .readonly()
      )
      .max(16),
    items: z
      .array(
        z
          .strictObject({
            id: z.string().min(1).max(160),
            label: labelSchema,
            facts: z
              .array(storedEvryArtifactFactSchema)
              .max(EVRY_READ_ITEM_MAX_FACTS),
            sourceLink: evryReviewSourceLinkSchema,
          })
          .readonly()
      )
      .max(100),
    sourceLinks: z.array(evryReviewSourceLinkSchema).max(32),
  })
  .superRefine((artifact, context) => {
    const excluded = artifact.exclusions.reduce(
      (total, exclusion) => total + exclusion.count,
      0
    );
    if (
      artifact.counts.returned !== artifact.items.length ||
      artifact.counts.excluded !== excluded ||
      artifact.counts.matched !== artifact.items.length + excluded
    ) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "Evry read counts must match the public snapshot",
      });
    }
  })
  .readonly();

const publicEntityChoiceSchema = z
  .strictObject({
    entityType: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
    id: z.string().min(1).max(160),
    label: labelSchema,
    distinguishingFacts: z.array(storedEvryArtifactFactSchema).max(6),
    sourceLink: evryReviewSourceLinkSchema,
  })
  .readonly();

const publicClarificationArtifactSchema = z.discriminatedUnion("mode", [
  z
    .strictObject({
      kind: z.literal("clarification"),
      mode: z.literal("missing"),
      entityType: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
      prompt: z.string().trim().min(1).max(500),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("clarification"),
      mode: z.literal("choice"),
      entityType: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
      prompt: z.string().trim().min(1).max(500),
      choices: z.array(publicEntityChoiceSchema).min(2).max(8),
      defaultChoiceId: z.null(),
    })
    .readonly(),
]);

const publicSettingsArtifactSchema = z
  .strictObject({
    kind: z.literal("settings_handoff"),
    title: titleSchema,
    message: z.string().trim().min(1).max(500),
    destination: z
      .strictObject({ sectionId: z.string().min(1).max(64) })
      .readonly(),
  })
  .readonly();

const publicBoundaryArtifactSchema = z
  .strictObject({
    kind: z.literal("boundary"),
    title: titleSchema,
    message: z.string().trim().min(1).max(500),
    examples: z.array(z.string().trim().min(1).max(200)).max(8),
  })
  .readonly();

const legacyDisplayItemSchema = z
  .strictObject({ label: labelSchema, value: z.string().max(1_000) })
  .readonly();

const publicLegacyConfirmationArtifactSchema = z
  .strictObject({
    kind: z.literal("confirmation"),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    actionLabel: labelSchema,
    items: z.array(legacyDisplayItemSchema).min(1).max(32),
    consequences: z.array(z.string().trim().min(1).max(500)).max(16),
  })
  .readonly();

const legacyProgressStepSchema = z
  .strictObject({
    stepId: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
    label: labelSchema,
  })
  .readonly();

const publicLegacyProgressArtifactSchema = z
  .strictObject({
    kind: z.literal("progress"),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    activeStep: legacyProgressStepSchema.nullable(),
    completedSteps: z.array(legacyProgressStepSchema).max(32),
  })
  .readonly();

const publicLegacyResultArtifactSchema = z
  .strictObject({
    kind: z.literal("result"),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    status: z.enum(["completed", "partially_failed", "failed", "refused"]),
    steps: z
      .array(
        z
          .strictObject({
            stepId: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
            label: labelSchema,
            status: z.enum(["completed", "failed", "refused", "skipped"]),
            resultCode: z.enum(EVRY_CONVERSATION_DURABLE_RESULT_CODES),
            affectedCount: z.number().int().nonnegative(),
            excludedCount: z.number().int().nonnegative(),
            sourceLinks: z.array(evryReviewSourceLinkSchema).max(16),
          })
          .readonly()
      )
      .min(1)
      .max(32),
  })
  .readonly();

/** Closed browser contract; unknown server fields never become render input. */
export const evryPublicArtifactSchema = z.union([
  publicReadArtifactSchema,
  publicClarificationArtifactSchema,
  publicSettingsArtifactSchema,
  evryDetailedConfirmationArtifactDocumentSchema,
  publicLegacyConfirmationArtifactSchema,
  evryDetailedProgressArtifactDocumentSchema,
  publicLegacyProgressArtifactSchema,
  evryDetailedReceiptArtifactDocumentSchema,
  publicLegacyResultArtifactSchema,
  publicBoundaryArtifactSchema,
]);

export type EvryPublicArtifact = z.infer<typeof evryPublicArtifactSchema>;

function publicLink(link: { label: string; href: string }) {
  return { label: link.label, href: link.href };
}

/** Explicitly project trusted hydrated values across the server/client seam. */
export function publicEvryArtifact(
  artifact: EvryHydratedConversationArtifact
): EvryPublicArtifact {
  let projected: unknown;
  switch (artifact.kind) {
    case "read":
      projected = {
        ...artifact,
        items: artifact.items.map((item) => ({
          ...item,
          sourceLink: publicLink(item.sourceLink),
        })),
        sourceLinks: artifact.sourceLinks.map(publicLink),
      };
      break;
    case "clarification":
      projected =
        artifact.mode === "missing"
          ? artifact
          : {
              ...artifact,
              choices: artifact.choices.map((choice) => ({
                ...choice,
                sourceLink: publicLink(choice.sourceLink),
              })),
            };
      break;
    case "settings_handoff":
      projected = {
        kind: artifact.kind,
        title: artifact.title,
        message: artifact.message,
        destination: { sectionId: artifact.destination.sectionId },
      };
      break;
    case "boundary":
      projected = {
        kind: artifact.kind,
        title: artifact.title,
        message: artifact.message,
        examples: [...artifact.examples],
      };
      break;
    case "confirmation":
      projected =
        "artifactVersion" in artifact
          ? {
              ...artifact,
              steps: artifact.steps.map((step) => ({
                ...step,
                resolvedTargets: step.resolvedTargets.map((target) => ({
                  ...target,
                  sourceLink: target.sourceLink
                    ? publicLink(target.sourceLink)
                    : null,
                })),
              })),
            }
          : artifact;
      break;
    case "progress":
      projected = artifact;
      break;
    case "result":
      projected = {
        ...artifact,
        steps: artifact.steps.map((step) => ({
          ...step,
          sourceLinks: step.sourceLinks.map(publicLink),
        })),
      };
      break;
    default: {
      const exhaustive: never = artifact;
      projected = exhaustive;
    }
  }
  return evryPublicArtifactSchema.parse(projected);
}
