import { z } from "zod";

export const EVRY_CONVERSATION_STATE_VERSION = 1 as const;
export const EVRY_CONVERSATION_MAX_MESSAGE_CHARACTERS = 8_000;

const SEMANTIC_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;
const PLAN_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export type EvryConversationDurableStepStatus =
  | "completed"
  | "failed"
  | "refused"
  | "skipped";

export const EVRY_CONVERSATION_DURABLE_RESULT_CODES = [
  "effect_completed",
  "effect_failed",
  "precondition_refused",
  "dependency_skipped",
] as const;

export function evryConversationResultCodeFor(
  status: EvryConversationDurableStepStatus
): (typeof EVRY_CONVERSATION_DURABLE_RESULT_CODES)[number] {
  switch (status) {
    case "completed":
      return "effect_completed";
    case "failed":
      return "effect_failed";
    case "refused":
      return "precondition_refused";
    case "skipped":
      return "dependency_skipped";
  }
}

export const evryConversationIdSchema = z
  .string()
  .uuid()
  .brand<"EvryConversationId">();
export type EvryConversationId = z.infer<typeof evryConversationIdSchema>;

export const evryConversationMessageIdSchema = z
  .string()
  .uuid()
  .brand<"EvryConversationMessageId">();
export type EvryConversationMessageId = z.infer<
  typeof evryConversationMessageIdSchema
>;

export const evryConversationRequestKeySchema = z
  .string()
  .uuid()
  .brand<"EvryConversationRequestKey">();
export type EvryConversationRequestKey = z.infer<
  typeof evryConversationRequestKeySchema
>;

export const evryConversationReferenceKeySchema = z
  .string()
  .regex(SEMANTIC_KEY_PATTERN)
  .brand<"EvryConversationReferenceKey">();
export type EvryConversationReferenceKey = z.infer<
  typeof evryConversationReferenceKeySchema
>;

export const evryConversationMessageIdempotencyContextSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("none") }),
    z.strictObject({ status: z.literal("not_applicable") }),
    z.strictObject({
      status: z.literal("resolved"),
      referenceKey: evryConversationReferenceKeySchema,
      entityType: z.string().regex(SEMANTIC_KEY_PATTERN),
      entityId: z.string().min(1).max(160),
    }),
    z.strictObject({
      status: z.literal("clarification"),
      reason: z.enum(["missing", "ambiguous", "stale"]),
    }),
  ])
  .readonly();
export type EvryConversationMessageIdempotencyContext = z.infer<
  typeof evryConversationMessageIdempotencyContextSchema
>;

export const evryConversationRelevanceKeySchema = z
  .string()
  .regex(SEMANTIC_KEY_PATTERN)
  .brand<"EvryConversationRelevanceKey">();
export type EvryConversationRelevanceKey = z.infer<
  typeof evryConversationRelevanceKeySchema
>;

export const evryPlanFingerprintSchema = z
  .string()
  .regex(PLAN_FINGERPRINT_PATTERN)
  .brand<"EvryPlanFingerprint">();
export type EvryPlanFingerprint = z.infer<typeof evryPlanFingerprintSchema>;

export const evryConversationPlanIdentitySchema = z
  .object({
    planId: z.string().uuid(),
    fingerprint: evryPlanFingerprintSchema,
  })
  .strict()
  .readonly();
export type EvryConversationPlanIdentity = z.infer<
  typeof evryConversationPlanIdentitySchema
>;

export const storedEvrySourceLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    href: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (href) => href.startsWith("/") && !href.startsWith("//"),
        "Evry source links must be application paths"
      ),
  })
  .strict()
  .readonly();
export type StoredEvrySourceLink = z.infer<typeof storedEvrySourceLinkSchema>;

export const storedEvryArtifactFactSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: z.string().max(500),
  })
  .strict()
  .readonly();

function normalizeAlias(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}_.:\- ]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeEvryReferenceAlias(value: string): string {
  return normalizeAlias(value);
}

const aliasSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((alias) => alias === normalizeAlias(alias), {
    message: "Evry reference aliases must be normalized",
  });

export const evryResolvedReferenceSchema = z
  .object({
    key: evryConversationReferenceKeySchema,
    entityType: z.string().regex(SEMANTIC_KEY_PATTERN),
    entityId: z.string().min(1).max(160),
    label: z.string().trim().min(1).max(160),
    distinguishingFacts: z.array(storedEvryArtifactFactSchema).max(6),
    sourceLink: storedEvrySourceLinkSchema,
    aliases: z.array(aliasSchema).min(1).max(8),
    sourceMessageId: evryConversationMessageIdSchema,
    resolvedAt: z.string().datetime(),
    validThrough: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (new Set(reference.aliases).size !== reference.aliases.length) {
      context.addIssue({
        code: "custom",
        path: ["aliases"],
        message: "Evry reference aliases must be unique",
      });
    }
    if (
      reference.validThrough !== null &&
      Date.parse(reference.validThrough) <= Date.parse(reference.resolvedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validThrough"],
        message: "Evry reference validity must end after resolution",
      });
    }
  })
  .readonly();
export type EvryResolvedReference = z.infer<typeof evryResolvedReferenceSchema>;

const evryOfferedReferenceSchema = z
  .object({
    referenceKey: evryConversationReferenceKeySchema,
    entityType: z.string().regex(SEMANTIC_KEY_PATTERN),
    entityId: z.string().min(1).max(160),
  })
  .strict()
  .readonly();

const evryExplicitChoiceSchema = z
  .object({
    id: z.string().uuid(),
    clarificationArtifactId: z.string().uuid(),
    offeredReferences: z
      .array(evryOfferedReferenceSchema)
      .min(2)
      .max(8)
      .readonly(),
    referenceKey: evryConversationReferenceKeySchema,
    selectedEntityId: z.string().min(1).max(160),
    sourceMessageId: evryConversationMessageIdSchema,
    selectedAt: z.string().datetime(),
  })
  .strict()
  .readonly();

const evryRecipeInputSchema = z
  .object({
    key: z.string().regex(SEMANTIC_KEY_PATTERN),
    value: z.string().max(500),
  })
  .strict()
  .readonly();

const evryActiveRecipeSchema = z
  .object({
    identity: z.string().regex(SEMANTIC_KEY_PATTERN),
    inputs: z.array(evryRecipeInputSchema).max(16),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((recipe, context) => {
    const keys = recipe.inputs.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "Evry recipe inputs must have unique keys",
      });
    }
  })
  .readonly();

const evryPendingClarificationSchema = z
  .object({
    id: z.string().uuid(),
    entityType: z.string().regex(SEMANTIC_KEY_PATTERN),
    prompt: z.string().trim().min(1).max(500),
    choiceReferenceKeys: z
      .array(evryConversationReferenceKeySchema)
      .min(2)
      .max(8),
    sourceMessageId: evryConversationMessageIdSchema,
    askedAt: z.string().datetime(),
  })
  .strict()
  .readonly();

const evryCompletedStepSchema = z
  .object({
    planId: z.string().uuid(),
    planFingerprint: evryPlanFingerprintSchema,
    stepId: z.string().regex(SEMANTIC_KEY_PATTERN),
    capabilityIdentity: z.string().trim().min(1).max(200),
    status: z.enum(["completed", "failed", "refused", "skipped"]),
    resultCode: z.enum(EVRY_CONVERSATION_DURABLE_RESULT_CODES),
    occurredAt: z.string().datetime(),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.resultCode !== evryConversationResultCodeFor(step.status)) {
      context.addIssue({
        code: "custom",
        path: ["resultCode"],
        message: "Evry completed state must match its durable step outcome",
      });
    }
  })
  .readonly();

const evryConversationSummarySchema = z
  .object({
    text: z.string().max(2_000),
    throughSequence: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();

export const evryConversationStateDocumentSchema = z
  .object({
    version: z.literal(EVRY_CONVERSATION_STATE_VERSION),
    resolvedReferences: z.array(evryResolvedReferenceSchema).max(16),
    explicitChoices: z.array(evryExplicitChoiceSchema).max(16),
    activeRecipe: evryActiveRecipeSchema.nullable(),
    pendingClarification: evryPendingClarificationSchema.nullable(),
    completedSteps: z.array(evryCompletedStepSchema).max(32),
    summary: evryConversationSummarySchema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    const referenceKeys = state.resolvedReferences.map(({ key }) => key);
    if (new Set(referenceKeys).size !== referenceKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["resolvedReferences"],
        message: "Evry resolved reference keys must be unique",
      });
    }

    const referenceByKey = new Map(
      state.resolvedReferences.map((reference) => [reference.key, reference])
    );
    const choiceIds = state.explicitChoices.map(({ id }) => id);
    const clarificationArtifactIds = state.explicitChoices.map(
      ({ clarificationArtifactId }) => clarificationArtifactId
    );
    if (
      new Set(choiceIds).size !== choiceIds.length ||
      new Set(clarificationArtifactIds).size !== clarificationArtifactIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["explicitChoices"],
        message: "Evry explicit choices must name unique persisted decisions",
      });
    }
    for (const [index, choice] of state.explicitChoices.entries()) {
      const offeredKeys = choice.offeredReferences.map(
        ({ referenceKey }) => referenceKey
      );
      const offeredIds = choice.offeredReferences.map(
        ({ entityId }) => entityId
      );
      const selected = choice.offeredReferences.find(
        ({ referenceKey, entityId }) =>
          referenceKey === choice.referenceKey &&
          entityId === choice.selectedEntityId
      );
      if (
        new Set(offeredKeys).size !== offeredKeys.length ||
        new Set(offeredIds).size !== offeredIds.length ||
        !selected
      ) {
        context.addIssue({
          code: "custom",
          path: ["explicitChoices", index],
          message:
            "Evry choices must select one exact persisted offered reference",
        });
      }
    }

    for (const [index, key] of (
      state.pendingClarification?.choiceReferenceKeys ?? []
    ).entries()) {
      if (!referenceByKey.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["pendingClarification", "choiceReferenceKeys", index],
          message: "Evry clarification choices must name persisted references",
        });
      }
    }

    const completedKeys = state.completedSteps.map(
      (step) => `${step.planId}:${step.stepId}`
    );
    if (new Set(completedKeys).size !== completedKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["completedSteps"],
        message: "Evry completed plan steps must be unique",
      });
    }
  })
  .readonly();

export type EvryConversationStateDocument = z.infer<
  typeof evryConversationStateDocumentSchema
>;

export const evryConversationRelevanceKeysSchema = z
  .array(evryConversationRelevanceKeySchema)
  .max(16)
  .refine((keys) => new Set(keys).size === keys.length, {
    message: "Evry relevance keys must be unique",
  })
  .readonly();

export function initialEvryConversationState(): EvryConversationStateDocument {
  return evryConversationStateDocumentSchema.parse({
    version: EVRY_CONVERSATION_STATE_VERSION,
    resolvedReferences: [],
    explicitChoices: [],
    activeRecipe: null,
    pendingClarification: null,
    completedSteps: [],
    summary: null,
  });
}

export class EvryConversationStorageError extends Error {
  constructor() {
    super("Stored Evry conversation data is invalid");
    this.name = "EvryConversationStorageError";
  }
}

export function parseStoredEvryConversationState(
  input: unknown
): EvryConversationStateDocument {
  const parsed = evryConversationStateDocumentSchema.safeParse(input);
  if (!parsed.success) throw new EvryConversationStorageError();
  return parsed.data;
}
