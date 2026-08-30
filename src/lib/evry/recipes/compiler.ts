import { z } from "zod";

import {
  authorizeEvryReadCapability,
  type EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryAllowedPolicyDecision } from "@/lib/evry/policy";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  assertEvryPlanDocumentReviewable,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import {
  EVRY_PLAN_DOCUMENT_VERSION,
  parseEvryActionPlanCandidate,
  parseStoredEvryActionPlan,
  type EvryActionPlanDocument,
  type EvryJsonValue,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import {
  createEvryActionPlanRecord,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";

import type {
  EvryRecipeDefinition,
  EvryRecipeRegistry,
  EvryRecipeResolvedInputs,
  EvryRecipeStepDefinition,
} from "./schema";
import {
  disclosureForEvryRecipeStep,
  storedDocumentMatchesEvryRecipe,
} from "./contract";

export { storedDocumentMatchesEvryRecipe } from "./contract";

const EVRY_COMPILED_RECIPE: unique symbol = Symbol("EvryCompiledRecipe");

type EvryApplicationActionDecision = Extract<
  EvryAllowedPolicyDecision,
  { classification: "application_action" }
>;

export type EvryCompiledRecipe = Readonly<{
  recipeIdentity: string;
  document: EvryActionPlanDocument;
  [EVRY_COMPILED_RECIPE]: true;
}>;

export class EvryRecipeCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvryRecipeCompilationError";
  }
}

export type EvryRecipeCompilerBoundaries = Readonly<{
  authorizeResolver(
    identity: string
  ): Promise<EvryReadCapabilityAuthorization | null>;
}>;

const productionBoundaries: EvryRecipeCompilerBoundaries = Object.freeze({
  authorizeResolver: authorizeEvryReadCapability,
});

function isJsonValue(value: unknown): value is EvryJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.entries(value).every(
    ([, child]) => child !== undefined && isJsonValue(child)
  );
}

function freezeJson(value: EvryJsonValue): EvryJsonValue {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeJson(child);
  }
  return value;
}

async function parsedInputs(
  definition: EvryRecipeDefinition,
  values: unknown,
  actor: EvryPlantActor,
  registry: EvryRecipeRegistry,
  boundaries: EvryRecipeCompilerBoundaries
): Promise<EvryRecipeResolvedInputs> {
  const object = z.record(z.string(), z.unknown()).safeParse(values);
  if (!object.success) {
    throw new EvryRecipeCompilationError(
      "Evry recipe inputs have an invalid shape"
    );
  }
  const rawInputs = object.data;
  const allowed = new Set([
    ...definition.requiredInputs.map(({ key }) => key),
    ...definition.optionalInputs.map(({ key }) => key),
  ]);
  if (Object.keys(rawInputs).some((key) => !allowed.has(key))) {
    throw new EvryRecipeCompilationError(
      "Evry recipe inputs have an invalid shape"
    );
  }

  const parsed: Record<string, EvryJsonValue | undefined> = {};
  const resolverByInput = new Map(
    definition.recordResolvers.map((resolver) => [resolver.inputKey, resolver])
  );

  async function parseInput(
    input: (typeof definition.requiredInputs)[number],
    required: boolean
  ): Promise<void> {
    const present = Object.hasOwn(rawInputs, input.key);
    if (!present && required) {
      throw new EvryRecipeCompilationError(
        "Evry recipe inputs have an invalid shape"
      );
    }
    if (!present) return;

    let candidate = rawInputs[input.key];
    const resolverUse = resolverByInput.get(input.key);
    if (resolverUse) {
      const resolver = registry.resolverFor(resolverUse.resolverIdentity);
      if (!resolver) {
        throw new EvryRecipeCompilationError(
          `Evry recipe resolver is unavailable: ${resolverUse.resolverIdentity}`
        );
      }
      const authorization = await boundaries.authorizeResolver(
        resolver.readCapabilityIdentity
      );
      if (!authorization) {
        throw new EvryRecipeCompilationError(
          `Evry recipe resolver is unavailable: ${resolverUse.resolverIdentity}`
        );
      }
      if (
        authorization.actor.userId !== actor.userId ||
        authorization.actor.plantId !== actor.plantId
      ) {
        throw new EvryRecipeCompilationError(
          `Evry recipe resolver is unavailable: ${resolverUse.resolverIdentity}`
        );
      }
      try {
        candidate = await resolver.resolve({
          authorization,
          rawValue: candidate,
        });
      } catch {
        throw new EvryRecipeCompilationError(
          `Evry recipe resolver failed: ${resolverUse.resolverIdentity}`
        );
      }
    }

    const value = input.schema.safeParse(candidate);
    if (!value.success || !isJsonValue(value.data)) {
      throw new EvryRecipeCompilationError(
        "Evry recipe inputs have an invalid shape"
      );
    }
    parsed[input.key] = freezeJson(value.data);
  }
  for (const input of definition.requiredInputs) {
    await parseInput(input, true);
  }
  for (const input of definition.optionalInputs) {
    await parseInput(input, false);
  }
  const resolved = Object.freeze(parsed);
  for (const identity of definition.preconditions) {
    const precondition = registry.preconditionFor(identity);
    if (!precondition) {
      throw new EvryRecipeCompilationError(
        `Evry recipe precondition is unavailable: ${identity}`
      );
    }
    let passed = false;
    try {
      passed = await precondition.check(resolved);
    } catch {
      // A thrown planning precondition fails closed before persistence.
    }
    if (!passed) {
      throw new EvryRecipeCompilationError(
        `Evry recipe precondition failed: ${identity}`
      );
    }
  }
  return resolved;
}

function candidateArguments(
  step: EvryRecipeStepDefinition,
  inputs: Readonly<Record<string, EvryJsonValue | undefined>>
): Readonly<Record<string, EvryJsonValue>> {
  const values: Record<string, EvryJsonValue> = {};
  for (const [argumentKey, binding] of Object.entries(step.arguments)) {
    if (binding.kind === "literal") {
      values[argumentKey] = binding.value;
      continue;
    }
    let value = inputs[binding.inputKey];
    if (binding.kind === "input_path") {
      for (const part of binding.path) {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !Object.hasOwn(value, part)
        ) {
          value = undefined;
          break;
        }
        value = (value as Readonly<Record<string, EvryJsonValue>>)[part];
      }
    }
    if (value !== undefined) values[argumentKey] = value;
  }
  return values;
}

/**
 * Compile trusted recipe structure around arguments already validated by the
 * ordinary untrusted plan-candidate boundary. Recipe metadata never enters
 * that generic parser.
 */
export function createEvryRecipeCompiler(
  boundaries: EvryRecipeCompilerBoundaries
) {
  return async function compile(input: {
    actor: EvryPlantActor;
    registry: EvryRecipeRegistry;
    recipeIdentity: string;
    inputValues: unknown;
    eligibleCapabilities: readonly Readonly<{ identity: string }>[];
  }): Promise<EvryCompiledRecipe> {
    const definition = input.registry.registrationFor(input.recipeIdentity);
    if (!definition) {
      throw new EvryRecipeCompilationError(
        `Evry recipe is unavailable: ${input.recipeIdentity}`
      );
    }
    const inputs = await parsedInputs(
      definition,
      input.inputValues,
      input.actor,
      input.registry,
      boundaries
    );
    const base = parseEvryActionPlanCandidate({
      candidate: {
        steps: definition.steps.map((step) => ({
          id: step.id,
          capabilityIdentity: step.capabilityIdentity,
          arguments: candidateArguments(step, inputs),
          dependsOn: step.dependsOn,
        })),
      },
      registry: input.registry.executionRegistry.planRegistry,
      eligibleCapabilities: input.eligibleCapabilities,
    });

    const byId = new Map(definition.steps.map((step) => [step.id, step]));
    const document = parseStoredEvryActionPlan({
      registry: input.registry.executionRegistry.planRegistry,
      document: {
        version: EVRY_PLAN_DOCUMENT_VERSION,
        recipe: {
          identity: definition.identity,
          preconditionIdentities: definition.preconditions,
          safeRetryStepIds: definition.steps
            .filter(({ failurePolicy }) => failurePolicy.retry === "same_plan")
            .map(({ id }) => id),
        },
        confirmation: definition.confirmation,
        steps: base.steps.map((step) => {
          const stepDefinition = byId.get(step.id);
          if (!stepDefinition) {
            throw new EvryRecipeCompilationError(
              `Evry recipe compiler lost step ${step.id}`
            );
          }
          return {
            ...step,
            disclosure: disclosureForEvryRecipeStep(stepDefinition, step),
          };
        }),
      },
    });
    if (!storedDocumentMatchesEvryRecipe({ definition, document })) {
      throw new EvryRecipeCompilationError(
        "Evry recipe compilation did not preserve its registered contract"
      );
    }
    return Object.freeze({
      recipeIdentity: definition.identity,
      document,
      [EVRY_COMPILED_RECIPE]: true as const,
    });
  };
}

const productionCompiler = createEvryRecipeCompiler(productionBoundaries);

export async function compileEvryRecipe(input: {
  actor: EvryPlantActor;
  registry: EvryRecipeRegistry;
  recipeIdentity: string;
  inputValues: unknown;
  eligibleCapabilities: readonly Readonly<{ identity: string }>[];
}): Promise<EvryCompiledRecipe> {
  return productionCompiler(input);
}

type CreateEvryRecipePlanInput = Readonly<{
  actor: EvryPlantActor;
  policy: EvryApplicationActionDecision;
  recipeIdentity: string;
  inputValues: unknown;
  requestKey: EvryPlanRequestKey;
  registry: EvryRecipeRegistry;
  reviewRegistry: EvryArtifactReviewRegistry;
  eligibleCapabilities: readonly Readonly<{ identity: string }>[];
}>;

export type EvryRecipePlanCreatorBoundaries = Readonly<{
  compile: typeof compileEvryRecipe;
  persist: typeof createEvryActionPlanRecord;
}>;

/**
 * Compilation finishes, including authorized resolution and deterministic
 * planning preconditions, before the persistence boundary can be reached.
 */
export function createEvryRecipePlanCreator(
  boundaries: EvryRecipePlanCreatorBoundaries
) {
  return async function create(
    input: CreateEvryRecipePlanInput
  ): Promise<StoredEvryActionPlan> {
    if (input.policy.classification !== "application_action") {
      throw new Error(
        "Only an application action may create an Evry recipe plan"
      );
    }
    const compiled = await boundaries.compile(input);
    assertEvryPlanDocumentReviewable({
      document: compiled.document,
      reviewRegistry: input.reviewRegistry,
    });
    return boundaries.persist({
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      requestKey: input.requestKey,
      document: compiled.document,
    });
  };
}

const productionPlanCreator = createEvryRecipePlanCreator({
  compile: compileEvryRecipe,
  persist: createEvryActionPlanRecord,
});

/** Compile and persist one recipe plan without reopening the model boundary. */
export async function createEvryRecipePlan(
  input: CreateEvryRecipePlanInput
): Promise<StoredEvryActionPlan> {
  return productionPlanCreator(input);
}
