import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  executeEvryActionPlan,
  type ExecuteEvryActionPlanResult,
} from "@/lib/evry/executor";
import { parseStoredEvryActionPlan } from "@/lib/evry/plans";
import {
  findExactEvryActionPlan,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";

import { storedDocumentMatchesEvryRecipe } from "./compiler";
import type { EvryRecipeRegistry } from "./schema";

export type EvryRecipeRunResult = ExecuteEvryActionPlanResult &
  Readonly<{
    recipeIdentity: string | null;
    safeRetryStepIds: readonly string[];
  }>;

export type EvryRecipeRunnerBoundaries = Readonly<{
  findExactPlan: typeof findExactEvryActionPlan;
  execute: typeof executeEvryActionPlan;
}>;

const productionBoundaries: EvryRecipeRunnerBoundaries = Object.freeze({
  findExactPlan: findExactEvryActionPlan,
  execute: executeEvryActionPlan,
});

function unavailable(): EvryRecipeRunResult {
  return Object.freeze({
    status: "unavailable",
    steps: [] as const,
    recipeIdentity: null,
    safeRetryStepIds: [],
  });
}

function safeRetryStepIds(
  result: ExecuteEvryActionPlanResult,
  stored: StoredEvryActionPlan,
  registry: EvryRecipeRegistry
): readonly string[] {
  if (result.status !== "retryable") return [];
  const document = parseStoredEvryActionPlan({
    document: stored.document,
    registry: registry.executionRegistry.planRegistry,
  });
  const safe = new Set(document.recipe?.safeRetryStepIds ?? []);
  const outcomes = new Map(result.steps.map((step) => [step.stepId, step]));
  return Object.freeze(
    document.steps
      .filter((step) => {
        if (
          !safe.has(step.id) ||
          outcomes.get(step.id)?.status !== "retryable"
        ) {
          return false;
        }
        return step.dependsOn.every(
          (dependency) => outcomes.get(dependency)?.status === "completed"
        );
      })
      .map(({ id }) => id)
  );
}

/**
 * Execute only a persisted plan that still matches its registered recipe.
 * The existing exact-plan executor remains the only effect runner and reuses
 * every completed dependency on a same-plan retry.
 */
export function createEvryRecipeRunner(boundaries: EvryRecipeRunnerBoundaries) {
  return async function run(input: {
    actor: EvryPlantActor;
    planId: string;
    fingerprint: string;
    registry: EvryRecipeRegistry;
  }): Promise<EvryRecipeRunResult> {
    const stored = await boundaries.findExactPlan({
      planId: input.planId,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      fingerprint: input.fingerprint,
    });
    if (!stored) return unavailable();

    let document;
    try {
      document = parseStoredEvryActionPlan({
        document: stored.document,
        registry: input.registry.executionRegistry.planRegistry,
      });
    } catch {
      return unavailable();
    }
    const identity = document.recipe?.identity;
    const definition = identity
      ? input.registry.registrationFor(identity)
      : null;
    if (
      !definition ||
      !storedDocumentMatchesEvryRecipe({ definition, document })
    ) {
      return unavailable();
    }

    const result = await boundaries.execute({
      actor: input.actor,
      planId: input.planId,
      fingerprint: input.fingerprint,
      registry: input.registry.executionRegistry,
    });
    return Object.freeze({
      ...result,
      recipeIdentity: definition.identity,
      safeRetryStepIds: safeRetryStepIds(result, stored, input.registry),
    });
  };
}

const productionRunner = createEvryRecipeRunner(productionBoundaries);

export async function runEvryRecipe(input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  registry: EvryRecipeRegistry;
}): Promise<EvryRecipeRunResult> {
  return productionRunner(input);
}
