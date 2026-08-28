import { z } from "zod";

import {
  EVRY_EFFECT_CLASSES,
  type EvryEffectClass,
  type EvryPlanCapabilityRegistry,
} from "./registry";

export const EVRY_PLAN_DOCUMENT_VERSION = 1 as const;
export const EVRY_PLAN_TTL_MS = 15 * 60 * 1000;

const STEP_ID_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

export type EvryJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly EvryJsonValue[]
  | Readonly<{ [key: string]: EvryJsonValue }>;

export type EvryActionStep = Readonly<{
  id: string;
  capabilityIdentity: string;
  effectClass: EvryEffectClass;
  arguments: Readonly<Record<string, EvryJsonValue>>;
  dependsOn: readonly string[];
  /**
   * Fingerprint-bound confirmation copy. Optional only for version-1 plans
   * created before EV-018; the recipe compiler and runner require it on every
   * recipe effect and verify it against the registered recipe.
   */
  disclosure?: EvryPlanStepDisclosure;
}>;

export type EvryPlanDisclosureItem = Readonly<{
  label: string;
  value: string;
}>;

export type EvryPlanStepDisclosure = Readonly<{
  title: string;
  items: readonly [EvryPlanDisclosureItem, ...EvryPlanDisclosureItem[]];
  consequences: readonly string[];
}>;

export type EvryPlanConfirmationDisclosure = Readonly<{
  title: string;
  actionLabel: string;
}>;

export type EvryPlanRecipeMetadata = Readonly<{
  identity: string;
  preconditionIdentities: readonly string[];
  safeRetryStepIds: readonly string[];
}>;

export type EvryActionPlanDocument = Readonly<{
  version: typeof EVRY_PLAN_DOCUMENT_VERSION;
  /** See the compatibility note on {@link EvryActionStep.disclosure}. */
  recipe?: EvryPlanRecipeMetadata;
  confirmation?: EvryPlanConfirmationDisclosure;
  steps: readonly [EvryActionStep, ...EvryActionStep[]];
}>;

const jsonValueSchema: z.ZodType<EvryJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

const stepIdSchema = z.string().regex(STEP_ID_PATTERN);
const identitySchema = z.string().trim().min(1).max(200);
const disclosureTextSchema = z.string().trim().min(1).max(1_000);

const recipeMetadataSchema = z.strictObject({
  identity: identitySchema,
  preconditionIdentities: z.array(identitySchema),
  safeRetryStepIds: z.array(stepIdSchema),
});

const confirmationDisclosureSchema = z.strictObject({
  title: disclosureTextSchema,
  actionLabel: disclosureTextSchema,
});

const stepDisclosureSchema = z.strictObject({
  title: disclosureTextSchema,
  items: z
    .array(
      z.strictObject({
        label: disclosureTextSchema,
        value: z.string().min(1).max(4_000),
      })
    )
    .min(1),
  consequences: z.array(disclosureTextSchema).max(16),
});

const candidateStepSchema = z.strictObject({
  id: stepIdSchema,
  capabilityIdentity: identitySchema,
  arguments: z.unknown(),
  dependsOn: z.array(stepIdSchema),
});

const candidateSchema = z.strictObject({
  steps: z.array(candidateStepSchema).min(1),
});

const storedStepSchema = z.strictObject({
  id: stepIdSchema,
  capabilityIdentity: z.string().min(1),
  effectClass: z.enum(EVRY_EFFECT_CLASSES),
  arguments: z.record(z.string(), jsonValueSchema),
  dependsOn: z.array(stepIdSchema),
  disclosure: stepDisclosureSchema.optional(),
});

const storedDocumentSchema = z.strictObject({
  version: z.literal(EVRY_PLAN_DOCUMENT_VERSION),
  recipe: recipeMetadataSchema.optional(),
  confirmation: confirmationDisclosureSchema.optional(),
  steps: z.array(storedStepSchema).min(1),
});

export class EvryPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvryPlanValidationError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateGraph(steps: readonly EvryActionStep[]): void {
  const byId = new Map<string, EvryActionStep>();
  for (const step of steps) {
    if (byId.has(step.id)) {
      throw new EvryPlanValidationError(`Duplicate Evry plan step: ${step.id}`);
    }
    byId.set(step.id, step);

    if (new Set(step.dependsOn).size !== step.dependsOn.length) {
      throw new EvryPlanValidationError(
        `Evry plan step ${step.id} repeats a dependency`
      );
    }
  }

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!byId.has(dependency)) {
        throw new EvryPlanValidationError(
          `Evry plan step ${step.id} depends on unknown step ${dependency}`
        );
      }
      if (dependency === step.id) {
        throw new EvryPlanValidationError(
          `Evry plan step ${step.id} depends on itself`
        );
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new EvryPlanValidationError(
        "Evry plan dependencies contain a cycle"
      );
    }

    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of byId.keys()) visit(id);
}

function validateRecipeMetadata(
  recipe: EvryPlanRecipeMetadata | undefined,
  confirmation: EvryPlanConfirmationDisclosure | undefined,
  steps: readonly EvryActionStep[]
): void {
  if ((recipe === undefined) !== (confirmation === undefined)) {
    throw new EvryPlanValidationError(
      "Evry recipe metadata and confirmation disclosure must appear together"
    );
  }
  if (!recipe) {
    if (steps.some(({ disclosure }) => disclosure !== undefined)) {
      throw new EvryPlanValidationError(
        "Only a registered Evry recipe may carry step disclosure"
      );
    }
    return;
  }

  if (steps.some(({ disclosure }) => disclosure === undefined)) {
    throw new EvryPlanValidationError(
      "Every Evry recipe effect requires confirmation disclosure"
    );
  }

  if (
    new Set(recipe.safeRetryStepIds).size !== recipe.safeRetryStepIds.length
  ) {
    throw new EvryPlanValidationError("Evry recipe repeats a safe retry step");
  }
  if (
    new Set(recipe.preconditionIdentities).size !==
    recipe.preconditionIdentities.length
  ) {
    throw new EvryPlanValidationError("Evry recipe repeats a precondition");
  }

  const stepIds = new Set(steps.map(({ id }) => id));
  for (const stepId of recipe.safeRetryStepIds) {
    if (!stepIds.has(stepId)) {
      throw new EvryPlanValidationError(
        `Evry recipe names an unknown safe retry step: ${stepId}`
      );
    }
  }
}

function ensureJsonArguments(
  capabilityIdentity: string,
  value: unknown
): Readonly<Record<string, EvryJsonValue>> {
  const parsed = z.record(z.string(), jsonValueSchema).safeParse(value);
  if (!parsed.success) {
    throw new EvryPlanValidationError(
      `Evry plan capability ${capabilityIdentity} produced non-JSON arguments`
    );
  }
  return parsed.data;
}

function storedDisclosure(
  value: z.infer<typeof stepDisclosureSchema>
): EvryPlanStepDisclosure {
  const [first, ...rest] = value.items;
  if (!first) {
    throw new EvryPlanValidationError(
      "Stored Evry plan disclosure has no visible items"
    );
  }
  return {
    title: value.title,
    items: [first, ...rest],
    consequences: value.consequences,
  };
}

export function parseEvryActionPlanCandidate(input: {
  candidate: unknown;
  registry: EvryPlanCapabilityRegistry;
  eligibleCapabilities: readonly Readonly<{ identity: string }>[];
}): EvryActionPlanDocument {
  const candidate = candidateSchema.safeParse(input.candidate);
  if (!candidate.success) {
    throw new EvryPlanValidationError("Evry action plan has an invalid shape");
  }

  const eligible = new Set(
    input.eligibleCapabilities.map((capability) => capability.identity)
  );

  const steps = candidate.data.steps.map((step): EvryActionStep => {
    const registration = input.registry.registrationFor(
      step.capabilityIdentity
    );
    if (!registration || !eligible.has(step.capabilityIdentity)) {
      throw new EvryPlanValidationError(
        `Evry plan capability is unavailable: ${step.capabilityIdentity}`
      );
    }

    const parsedArguments = registration.argumentsSchema.safeParse(
      step.arguments
    );
    if (!parsedArguments.success) {
      throw new EvryPlanValidationError(
        `Evry plan capability ${step.capabilityIdentity} has invalid arguments`
      );
    }

    return {
      id: step.id,
      capabilityIdentity: step.capabilityIdentity,
      effectClass: registration.effectClass,
      arguments: ensureJsonArguments(
        step.capabilityIdentity,
        parsedArguments.data
      ),
      dependsOn: step.dependsOn,
    };
  });

  validateGraph(steps);

  return deepFreeze({
    version: EVRY_PLAN_DOCUMENT_VERSION,
    steps: steps as [EvryActionStep, ...EvryActionStep[]],
  });
}

/** Parse persisted JSON again and prove it still matches the trusted registry. */
export function parseStoredEvryActionPlan(input: {
  document: unknown;
  registry: EvryPlanCapabilityRegistry;
}): EvryActionPlanDocument {
  const document = storedDocumentSchema.safeParse(input.document);
  if (!document.success) {
    throw new EvryPlanValidationError(
      "Stored Evry action plan has an invalid shape"
    );
  }

  const steps = document.data.steps.map((step): EvryActionStep => {
    const registration = input.registry.registrationFor(
      step.capabilityIdentity
    );
    if (!registration) {
      throw new EvryPlanValidationError(
        `Stored Evry plan capability is unavailable: ${step.capabilityIdentity}`
      );
    }
    if (registration.effectClass !== step.effectClass) {
      throw new EvryPlanValidationError(
        `Stored Evry plan effect class changed for ${step.capabilityIdentity}`
      );
    }
    const parsedArguments = registration.argumentsSchema.safeParse(
      step.arguments
    );
    if (!parsedArguments.success) {
      throw new EvryPlanValidationError(
        `Stored Evry plan arguments changed for ${step.capabilityIdentity}`
      );
    }

    return {
      id: step.id,
      capabilityIdentity: step.capabilityIdentity,
      effectClass: registration.effectClass,
      arguments: ensureJsonArguments(
        step.capabilityIdentity,
        parsedArguments.data
      ),
      dependsOn: step.dependsOn,
      ...(step.disclosure
        ? { disclosure: storedDisclosure(step.disclosure) }
        : {}),
    };
  });

  validateGraph(steps);
  validateRecipeMetadata(
    document.data.recipe,
    document.data.confirmation,
    steps
  );
  return deepFreeze({
    version: EVRY_PLAN_DOCUMENT_VERSION,
    ...(document.data.recipe ? { recipe: document.data.recipe } : {}),
    ...(document.data.confirmation
      ? { confirmation: document.data.confirmation }
      : {}),
    steps: steps as [EvryActionStep, ...EvryActionStep[]],
  });
}

/** The expiry is server policy, never a browser, model, or environment input. */
export function evryPlanExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + EVRY_PLAN_TTL_MS);
}
