import { z } from "zod";

import { evryExecutionResultCodes } from "@/db/schema/evry";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import type {
  EvryClarificationArtifact,
  EvryEntityChoice,
  EvryReadArtifact,
  TrustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/types";
import {
  boundaryArtifactFor,
  settingsHandoffArtifactFor,
  type EvryBoundaryArtifact,
  type EvrySettingsHandoffArtifact,
} from "@/lib/evry/policy/artifacts";
import { evrySettingsSectionIdSchema } from "@/lib/evry/policy/schema";

import {
  EvryConversationStorageError,
  evryConversationResultCodeFor,
  evryConversationPlanIdentitySchema,
  storedEvryArtifactFactSchema,
  storedEvrySourceLinkSchema,
} from "./contract";

const titleSchema = z.string().trim().min(1).max(200);
const labelSchema = z.string().trim().min(1).max(160);

const readFilterSchema = z
  .object({ label: labelSchema, value: z.string().max(500) })
  .strict()
  .readonly();
const readExclusionSchema = z
  .object({
    reason: z.string().trim().min(1).max(240),
    count: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();
const readItemSchema = z
  .object({
    id: z.string().min(1).max(160),
    label: labelSchema,
    facts: z.array(storedEvryArtifactFactSchema).max(12),
    sourceLink: storedEvrySourceLinkSchema,
  })
  .strict()
  .readonly();

const readArtifactDocumentSchema = z
  .object({
    kind: z.literal("read"),
    title: titleSchema,
    filters: z.array(readFilterSchema).max(16),
    counts: z
      .object({
        matched: z.number().int().nonnegative(),
        returned: z.number().int().nonnegative(),
        excluded: z.number().int().nonnegative(),
      })
      .strict()
      .readonly(),
    exclusions: z.array(readExclusionSchema).max(16),
    items: z.array(readItemSchema).max(100),
    sourceLinks: z.array(storedEvrySourceLinkSchema).max(32),
  })
  .strict()
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
        message: "Evry read artifact counts do not match its snapshot",
      });
    }
  })
  .readonly();

const storedEntityChoiceSchema = z
  .object({
    entityType: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
    id: z.string().min(1).max(160),
    label: labelSchema,
    distinguishingFacts: z.array(storedEvryArtifactFactSchema).max(6),
    sourceLink: storedEvrySourceLinkSchema,
  })
  .strict()
  .readonly();

const missingClarificationDocumentSchema = z
  .object({
    kind: z.literal("clarification"),
    mode: z.literal("missing"),
    entityType: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
    prompt: z.string().trim().min(1).max(500),
  })
  .strict()
  .readonly();

const choiceClarificationDocumentSchema = z
  .object({
    kind: z.literal("clarification"),
    mode: z.literal("choice"),
    entityType: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
    prompt: z.string().trim().min(1).max(500),
    choices: z
      .array(storedEntityChoiceSchema)
      .min(2)
      .max(8)
      .refine(
        (choices) =>
          new Set(choices.map(({ id }) => id)).size === choices.length,
        "Evry clarification choices must be unique"
      ),
    defaultChoiceId: z.null(),
  })
  .strict()
  .readonly();

const settingsArtifactDocumentSchema = z
  .object({
    kind: z.literal("settings_handoff"),
    sectionId: evrySettingsSectionIdSchema,
  })
  .strict()
  .readonly();

const boundaryArtifactDocumentSchema = z
  .object({
    kind: z.literal("boundary"),
    classification: z.enum([
      "theology_or_spiritual_guidance",
      "unrelated",
      "mixed",
      "ambiguous",
    ]),
  })
  .strict()
  .readonly();

const displayItemSchema = z
  .object({ label: labelSchema, value: z.string().max(1_000) })
  .strict()
  .readonly();

const confirmationArtifactDocumentSchema = z
  .object({
    kind: z.literal("confirmation"),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    actionLabel: labelSchema,
    items: z.array(displayItemSchema).min(1).max(32),
    consequences: z.array(z.string().trim().min(1).max(500)).max(16),
  })
  .strict()
  .readonly();

const progressStepSchema = z
  .object({
    stepId: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
    label: labelSchema,
  })
  .strict()
  .readonly();

const progressArtifactDocumentSchema = z
  .object({
    kind: z.literal("progress"),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    activeStep: progressStepSchema.nullable(),
    completedSteps: z.array(progressStepSchema).max(32),
  })
  .strict()
  .readonly();

const resultStepSchema = z
  .object({
    stepId: z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/),
    label: labelSchema,
    status: z.enum(["completed", "failed", "refused", "skipped"]),
    resultCode: z.enum(evryExecutionResultCodes),
    affectedCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    sourceLinks: z.array(storedEvrySourceLinkSchema).max(16),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.resultCode !== evryConversationResultCodeFor(step.status)) {
      context.addIssue({
        code: "custom",
        path: ["resultCode"],
        message: "Evry result status and result code must describe one outcome",
      });
    }
  })
  .readonly();

const resultArtifactDocumentSchema = z
  .object({
    kind: z.literal("result"),
    plan: evryConversationPlanIdentitySchema,
    title: titleSchema,
    status: z.enum(["completed", "partially_failed", "failed", "refused"]),
    steps: z.array(resultStepSchema).min(1).max(32),
  })
  .strict()
  .superRefine((artifact, context) => {
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
        message: "Evry result status must match its durable step outcomes",
      });
    }
  })
  .readonly();

export const evryConversationArtifactDocumentSchema = z.union([
  readArtifactDocumentSchema,
  missingClarificationDocumentSchema,
  choiceClarificationDocumentSchema,
  settingsArtifactDocumentSchema,
  confirmationArtifactDocumentSchema,
  progressArtifactDocumentSchema,
  resultArtifactDocumentSchema,
  boundaryArtifactDocumentSchema,
]);

export type StoredEvryConversationArtifactDocument = z.infer<
  typeof evryConversationArtifactDocumentSchema
>;

export type EvryHydratedResultArtifact = Readonly<{
  kind: "result";
  plan: z.infer<typeof evryConversationPlanIdentitySchema>;
  title: string;
  status: "completed" | "partially_failed" | "failed" | "refused";
  steps: readonly Readonly<{
    stepId: string;
    label: string;
    status: "completed" | "failed" | "refused" | "skipped";
    resultCode: string;
    affectedCount: number;
    excludedCount: number;
    sourceLinks: readonly TrustedEvryApplicationSourceLink[];
  }>[];
}>;

export type EvryHydratedConversationArtifact =
  | EvryReadArtifact
  | EvryClarificationArtifact
  | EvrySettingsHandoffArtifact
  | EvryBoundaryArtifact
  | z.infer<typeof confirmationArtifactDocumentSchema>
  | z.infer<typeof progressArtifactDocumentSchema>
  | EvryHydratedResultArtifact;

export function parseEvryConversationArtifactDocument(
  input: unknown
): StoredEvryConversationArtifactDocument {
  return evryConversationArtifactDocumentSchema.parse(input);
}

export function parseStoredEvryConversationArtifact(input: {
  kind: string;
  document: unknown;
}): StoredEvryConversationArtifactDocument {
  const parsed = evryConversationArtifactDocumentSchema.safeParse(
    input.document
  );
  if (!parsed.success || parsed.data.kind !== input.kind) {
    throw new EvryConversationStorageError();
  }
  return parsed.data;
}

function trustedLink(
  link: z.infer<typeof storedEvrySourceLinkSchema>
): TrustedEvryApplicationSourceLink {
  try {
    return trustedEvryApplicationSourceLink(link);
  } catch {
    throw new EvryConversationStorageError();
  }
}

function hydrateChoiceTuple(
  choices: readonly z.infer<typeof storedEntityChoiceSchema>[]
): readonly [EvryEntityChoice, EvryEntityChoice, ...EvryEntityChoice[]] {
  const hydrated = choices.map((choice) =>
    Object.freeze({
      ...choice,
      sourceLink: trustedLink(choice.sourceLink),
    })
  );
  const first = hydrated[0];
  const second = hydrated[1];
  if (!first || !second) throw new EvryConversationStorageError();
  return Object.freeze([first, second, ...hydrated.slice(2)]);
}

export function hydrateStoredEvryConversationArtifact(
  document: StoredEvryConversationArtifactDocument
): EvryHydratedConversationArtifact {
  switch (document.kind) {
    case "read":
      return buildEvryReadArtifact({
        title: document.title,
        filters: document.filters,
        exclusions: document.exclusions,
        items: document.items.map((item) => ({
          ...item,
          sourceLink: trustedLink(item.sourceLink),
        })),
        sourceLinks: document.sourceLinks.map(trustedLink),
      });
    case "clarification":
      return document.mode === "missing"
        ? document
        : Object.freeze({
            ...document,
            choices: hydrateChoiceTuple(document.choices),
          });
    case "settings_handoff": {
      const artifact = settingsHandoffArtifactFor(document.sectionId);
      if (!artifact) throw new EvryConversationStorageError();
      return artifact;
    }
    case "boundary":
      return boundaryArtifactFor(document.classification);
    case "confirmation":
    case "progress":
      return document;
    case "result":
      return Object.freeze({
        ...document,
        steps: Object.freeze(
          document.steps.map((step) =>
            Object.freeze({
              ...step,
              sourceLinks: Object.freeze(step.sourceLinks.map(trustedLink)),
            })
          )
        ),
      });
  }
}

export function storedEvryReadArtifactDocument(
  artifact: EvryReadArtifact
): StoredEvryConversationArtifactDocument {
  return parseEvryConversationArtifactDocument({
    ...artifact,
    items: artifact.items.map((item) => ({
      ...item,
      sourceLink: { label: item.sourceLink.label, href: item.sourceLink.href },
    })),
    sourceLinks: artifact.sourceLinks.map(({ label, href }) => ({
      label,
      href,
    })),
  });
}

export function storedEvryClarificationArtifactDocument(
  artifact: EvryClarificationArtifact
): StoredEvryConversationArtifactDocument {
  return parseEvryConversationArtifactDocument(
    artifact.mode === "missing"
      ? artifact
      : {
          ...artifact,
          choices: artifact.choices.map((choice) => ({
            ...choice,
            sourceLink: {
              label: choice.sourceLink.label,
              href: choice.sourceLink.href,
            },
          })),
        }
  );
}

export function evrySettingsArtifactDocument(
  sectionId: z.input<typeof evrySettingsSectionIdSchema>
): StoredEvryConversationArtifactDocument {
  return parseEvryConversationArtifactDocument({
    kind: "settings_handoff",
    sectionId,
  });
}

export function evryBoundaryArtifactDocument(
  classification: z.infer<
    typeof boundaryArtifactDocumentSchema
  >["classification"]
): StoredEvryConversationArtifactDocument {
  return parseEvryConversationArtifactDocument({
    kind: "boundary",
    classification,
  });
}
