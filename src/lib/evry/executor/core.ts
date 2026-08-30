import {
  executionEffectKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";
import {
  authorizeEvryEffectCapability,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  canonicalEvryPlanJson,
  parseStoredEvryActionPlan,
  type EvryActionPlanDocument,
} from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import {
  confirmExactEvryActionPlan,
  findExactEvryActionPlan,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";
import { storedDocumentMatchesEvryRecipe } from "@/lib/evry/recipes/contract";
import type {
  EvryRecipeDefinition,
  EvryRecipeRegistry,
} from "@/lib/evry/recipes/schema";

import {
  findEvryExecutionSnapshot,
  finishEvryExecution,
  recordEvryStepOutcome,
  revalidateEvryExecutionStep,
  startOrResumeEvryExecution,
  type EvryDurableStepOutcome,
  type EvryExecutionAttemptRecord,
  type EvryExecutionSnapshot,
} from "./repository";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryClaimedEffectInput,
  type EvryEffectResult,
  type EvryExecutionCapabilityRegistration,
  type EvryExecutionCapabilityRegistry,
} from "./registry";

export type EvryExecutionStepResult = Readonly<{
  stepId: string;
  capabilityIdentity: string;
  status: "completed" | "refused" | "failed" | "skipped" | "retryable";
  durable: boolean;
  affectedCount: number;
  excludedCount: number;
}>;

export type ExecuteEvryActionPlanResult =
  | Readonly<{ status: "unavailable"; steps: readonly [] }>
  | Readonly<{ status: "expired"; steps: readonly [] }>
  | Readonly<{
      status:
        | "completed"
        | "partially_failed"
        | "failed"
        | "refused"
        | "retryable";
      correlationId: string;
      steps: readonly EvryExecutionStepResult[];
    }>;

export type EvryExecutorBoundaries = Readonly<{
  authorizeCapability(
    identity: string
  ): Promise<EvryEffectCapabilityAuthorization | null>;
  findExactPlan: typeof findExactEvryActionPlan;
  findSnapshot: typeof findEvryExecutionSnapshot;
  startOrResume: typeof startOrResumeEvryExecution;
  revalidateStep: typeof revalidateEvryExecutionStep;
  recordStep: typeof recordEvryStepOutcome;
  finish: typeof finishEvryExecution;
  expirePlan: typeof confirmExactEvryActionPlan;
  now(): Date;
}>;

export type ExecuteEvryGenericPlanInput = Readonly<{
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  registry: EvryExecutionCapabilityRegistry;
  recipeRegistry?: never;
}>;

export type ExecuteEvryRecipePlanInput = Readonly<{
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  recipeRegistry: EvryRecipeRegistry;
  registry?: never;
}>;

type ExecuteEvryPlanInput =
  | ExecuteEvryGenericPlanInput
  | ExecuteEvryRecipePlanInput;

function executionSourceRegistry(
  input: ExecuteEvryPlanInput
): EvryExecutionCapabilityRegistry | null {
  if (input.recipeRegistry) return input.recipeRegistry.executionRegistry;
  return input.registry ?? null;
}

const productionBoundaries: EvryExecutorBoundaries = Object.freeze({
  authorizeCapability: authorizeEvryEffectCapability,
  findExactPlan: findExactEvryActionPlan,
  findSnapshot: findEvryExecutionSnapshot,
  startOrResume: startOrResumeEvryExecution,
  revalidateStep: revalidateEvryExecutionStep,
  recordStep: recordEvryStepOutcome,
  finish: finishEvryExecution,
  expirePlan: confirmExactEvryActionPlan,
  now: () => new Date(),
});

function orderedSteps(document: EvryActionPlanDocument) {
  const byId = new Map(document.steps.map((step) => [step.id, step]));
  const ordered: (typeof document.steps)[number][] = [];
  const visited = new Set<string>();

  function visit(stepId: string): void {
    if (visited.has(stepId)) return;
    const step = byId.get(stepId);
    if (!step) return;
    for (const dependency of step.dependsOn) visit(dependency);
    visited.add(stepId);
    ordered.push(step);
  }

  for (const step of document.steps) visit(step.id);
  return ordered;
}

function publicDurable(
  outcome: EvryDurableStepOutcome
): EvryExecutionStepResult {
  return Object.freeze({ ...outcome, durable: true as const });
}

/** Claim lookup is a network boundary; transport failures stay retryable. */
async function reconcileClaimedEffect(
  registration: EvryExecutionCapabilityRegistration,
  input: EvryClaimedEffectInput
) {
  if (!registration.reconcileClaimed) return null;
  try {
    return await registration.reconcileClaimed(input);
  } catch {
    return { status: "retryable" } as const;
  }
}

function resultFromSnapshot(
  snapshot: EvryExecutionSnapshot,
  document: EvryActionPlanDocument
): ExecuteEvryActionPlanResult | null {
  if (!snapshot.terminalStatus) return null;
  const byStep = new Map(
    snapshot.steps.map((outcome) => [outcome.stepId, outcome])
  );
  return Object.freeze({
    status: snapshot.terminalStatus,
    correlationId: snapshot.attempt.correlationId,
    steps: orderedSteps(document).flatMap((step) => {
      const outcome = byStep.get(step.id);
      return outcome ? [publicDurable(outcome)] : [];
    }),
  });
}

function parseExactPlan(
  stored: StoredEvryActionPlan,
  registry: EvryExecutionCapabilityRegistry
): EvryActionPlanDocument | null {
  try {
    if (!validateStoredEvryActionPlan(stored, registry.planRegistry)) {
      return null;
    }
    return parseStoredEvryActionPlan({
      document: stored.document,
      registry: registry.planRegistry,
    });
  } catch {
    return null;
  }
}

/**
 * Derive executable registrations from the authoritative recipe registration.
 * Explicit retryable results for never-retry steps become durable failures.
 * Throws remain non-durable so a same-key replay can recover an effect whose
 * commit succeeded but whose response was lost.
 */
function executionRegistryForRecipe(input: {
  planId: string;
  fingerprint: string;
  definition: EvryRecipeDefinition;
  registry: EvryRecipeRegistry;
}): EvryExecutionCapabilityRegistry | null {
  const neverEffectKeys = new Set(
    input.definition.steps
      .filter(({ failurePolicy }) => failurePolicy.retry === "never")
      .map(({ id }) => executionEffectKey(input.planId, input.fingerprint, id))
  );
  const identities = [
    ...new Set(
      input.definition.steps.map(({ capabilityIdentity }) => capabilityIdentity)
    ),
  ];
  const registrations: EvryExecutionCapabilityRegistration[] = [];
  for (const identity of identities) {
    const registration =
      input.registry.executionRegistry.registrationFor(identity);
    if (!registration) return null;
    registrations.push(
      defineEvryExecutionCapability({
        planCapability: registration.planCapability,
        ...(registration.reconcileClaimed
          ? { reconcileClaimed: registration.reconcileClaimed }
          : {}),
        async executeIfCurrent(effectInput) {
          const result = await registration.executeIfCurrent(effectInput);
          if (
            result.status === "retryable" &&
            neverEffectKeys.has(effectInput.effectKey)
          ) {
            return { status: "failed", excludedCount: 0 };
          }
          return result;
        },
      })
    );
  }
  return createEvryExecutionCapabilityRegistry(registrations);
}

function validatedExecution(input: {
  planId: string;
  fingerprint: string;
  document: EvryActionPlanDocument;
  execution: ExecuteEvryPlanInput;
}): EvryExecutionCapabilityRegistry | null {
  if (input.document.recipe) {
    const recipeRegistry = input.execution.recipeRegistry;
    if (!recipeRegistry) return null;
    const definition = recipeRegistry.registrationFor(
      input.document.recipe.identity
    );
    if (
      !definition ||
      !storedDocumentMatchesEvryRecipe({
        definition,
        document: input.document,
      })
    ) {
      return null;
    }
    return executionRegistryForRecipe({
      planId: input.planId,
      fingerprint: input.fingerprint,
      definition,
      registry: recipeRegistry,
    });
  }

  return input.execution.registry ?? null;
}

function terminalStatusOf(steps: readonly EvryExecutionStepResult[]): {
  attemptStatus: "completed" | "partially_failed" | "failed" | "refused";
  planStatus: "completed" | "partially_failed" | "failed";
} {
  if (steps.every(({ status }) => status === "completed")) {
    return { attemptStatus: "completed", planStatus: "completed" };
  }

  const hasCompletion = steps.some(({ status }) => status === "completed");
  if (hasCompletion) {
    return {
      attemptStatus: "partially_failed",
      planStatus: "partially_failed",
    };
  }
  if (steps.some(({ status }) => status === "refused")) {
    return { attemptStatus: "refused", planStatus: "failed" };
  }
  return { attemptStatus: "failed", planStatus: "failed" };
}

async function persistRefusal(
  boundaries: EvryExecutorBoundaries,
  attempt: EvryExecutionAttemptRecord,
  stepId: string,
  capabilityIdentity: string
): Promise<EvryDurableStepOutcome> {
  return boundaries.recordStep({
    attempt,
    stepId,
    capabilityIdentity,
    status: "refused",
    effectKey: null,
    affectedCount: 0,
    excludedCount: 0,
    occurredAt: boundaries.now(),
  });
}

/**
 * Deterministic orchestration over explicit durable and effect boundaries.
 * Tests inject faithful in-memory boundaries; production uses the fixed module
 * boundaries below and cannot accept actor, time, or repository data from HTTP.
 */
export function createEvryExecutor(boundaries: EvryExecutorBoundaries) {
  return async function execute(
    input: ExecuteEvryPlanInput
  ): Promise<ExecuteEvryActionPlanResult> {
    const exact = await boundaries.findExactPlan({
      planId: input.planId,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      fingerprint: input.fingerprint,
    });
    if (!exact) return { status: "unavailable", steps: [] };

    const sourceRegistry = executionSourceRegistry(input);
    if (!sourceRegistry) return { status: "unavailable", steps: [] };
    const document = parseExactPlan(exact, sourceRegistry);
    if (!document) return { status: "unavailable", steps: [] };
    const registry = validatedExecution({
      planId: exact.id,
      fingerprint: exact.fingerprint,
      document,
      execution: input,
    });
    if (!registry) return { status: "unavailable", steps: [] };

    let snapshot = await boundaries.findSnapshot({
      planId: exact.id,
      actorUserId: exact.actorUserId,
      plantId: exact.plantId,
      fingerprint: exact.fingerprint,
    });
    const replay = snapshot && resultFromSnapshot(snapshot, document);
    if (replay) return replay;

    const startedAt = boundaries.now();
    if (!snapshot && exact.expiresAt <= startedAt) {
      await boundaries.expirePlan({
        planId: exact.id,
        actorUserId: exact.actorUserId,
        plantId: exact.plantId,
        fingerprint: exact.fingerprint,
        decidedAt: startedAt,
      });
      return { status: "expired", steps: [] };
    }

    snapshot ??= await boundaries.startOrResume({
      planId: exact.id,
      actorUserId: exact.actorUserId,
      plantId: exact.plantId,
      fingerprint: exact.fingerprint,
      startedAt,
    });
    if (!snapshot) return { status: "unavailable", steps: [] };

    const attempt = snapshot.attempt;
    const results = new Map(
      snapshot.steps.map((outcome) => [outcome.stepId, publicDurable(outcome)])
    );
    const canonicalDocument = canonicalEvryPlanJson({
      actorUserId: exact.actorUserId,
      plantId: exact.plantId,
      expiresAt: exact.expiresAt,
      document,
    });

    for (const step of orderedSteps(document)) {
      if (results.has(step.id)) continue;

      const dependencies = step.dependsOn.map((dependency) =>
        results.get(dependency)
      );
      const durableBlocker = dependencies.find(
        (dependency) =>
          dependency?.status !== "completed" && dependency?.durable === true
      );
      const retryableBlocker = dependencies.find(
        (dependency) =>
          dependency?.status === "retryable" && dependency.durable === false
      );
      if (durableBlocker || retryableBlocker) {
        if (!durableBlocker && retryableBlocker) {
          results.set(
            step.id,
            Object.freeze({
              stepId: step.id,
              capabilityIdentity: step.capabilityIdentity,
              status: "retryable",
              durable: false,
              affectedCount: 0,
              excludedCount: 0,
            })
          );
          continue;
        }
        const skipped = await boundaries.recordStep({
          attempt,
          stepId: step.id,
          capabilityIdentity: step.capabilityIdentity,
          status: "skipped",
          effectKey: null,
          affectedCount: 0,
          excludedCount: 0,
          occurredAt: boundaries.now(),
        });
        results.set(step.id, publicDurable(skipped));
        continue;
      }

      const executionRegistration = registry.registrationFor(
        step.capabilityIdentity
      );
      if (!executionRegistration) {
        results.set(
          step.id,
          publicDurable(
            await persistRefusal(
              boundaries,
              attempt,
              step.id,
              step.capabilityIdentity
            )
          )
        );
        continue;
      }

      const effectKey: EvryAuditKey = executionEffectKey(
        exact.id,
        exact.fingerprint,
        step.id
      );
      const execution = {
        attemptId: attempt.id,
        planId: attempt.planId,
        actorUserId: attempt.actorUserId,
        plantId: attempt.plantId,
        fingerprint: attempt.fingerprint,
        correlationId: attempt.correlationId,
        stepId: step.id,
        capabilityIdentity: step.capabilityIdentity,
      };
      let reconciliation = await reconcileClaimedEffect(executionRegistration, {
        effectKey,
        execution,
        arguments: step.arguments,
      });
      let resumeStartedEffect = reconciliation?.status === "resume";
      let effect: EvryEffectResult | null =
        reconciliation?.status === "resume" ? null : reconciliation;

      if (effect === null) {
        const authorization = await boundaries.authorizeCapability(
          step.capabilityIdentity
        );
        if (!authorization) {
          if (resumeStartedEffect) {
            effect = { status: "retryable" } as const;
          } else {
            reconciliation = await reconcileClaimedEffect(
              executionRegistration,
              {
                effectKey,
                execution,
                arguments: step.arguments,
              }
            );
            resumeStartedEffect = reconciliation?.status === "resume";
            effect =
              reconciliation?.status === "resume"
                ? ({ status: "retryable" } as const)
                : reconciliation;
          }
          if (effect === null) {
            results.set(
              step.id,
              publicDurable(
                await persistRefusal(
                  boundaries,
                  attempt,
                  step.id,
                  step.capabilityIdentity
                )
              )
            );
            continue;
          }
        }

        let currentStep = resumeStartedEffect ? step : null;
        if (effect === null && !resumeStartedEffect) {
          const currentDocument = await boundaries.revalidateStep({
            attempt,
            actorUserId: authorization!.actor.userId,
            plantId: authorization!.actor.plantId,
            checkedAt: boundaries.now(),
          });
          let current: EvryActionPlanDocument | null = null;
          try {
            current = parseStoredEvryActionPlan({
              document: currentDocument,
              registry: registry.planRegistry,
            });
          } catch {
            // The same neutral refusal covers a stale confirmation, expiry,
            // actor, plant, capability registration, or stored arguments.
          }
          currentStep = current?.steps.find(({ id }) => id === step.id) ?? null;
          if (
            !current ||
            !currentStep ||
            canonicalEvryPlanJson({
              actorUserId: exact.actorUserId,
              plantId: exact.plantId,
              expiresAt: exact.expiresAt,
              document: current,
            }) !== canonicalDocument ||
            currentStep.capabilityIdentity !== step.capabilityIdentity
          ) {
            reconciliation = await reconcileClaimedEffect(
              executionRegistration,
              {
                effectKey,
                execution,
                arguments: step.arguments,
              }
            );
            resumeStartedEffect = reconciliation?.status === "resume";
            effect =
              reconciliation?.status === "resume" ? null : reconciliation;
            currentStep = resumeStartedEffect ? step : null;
            if (effect === null && !resumeStartedEffect) {
              results.set(
                step.id,
                publicDurable(
                  await persistRefusal(
                    boundaries,
                    attempt,
                    step.id,
                    step.capabilityIdentity
                  )
                )
              );
              continue;
            }
          }
        }

        if (effect === null) {
          try {
            effect = await executionRegistration.executeIfCurrent({
              authorization: authorization!,
              effectKey,
              execution,
              arguments: currentStep!.arguments,
            });
          } catch {
            // The adapter may have committed its keyed effect before
            // transport or process failure. Absence is retryable.
            effect = { status: "retryable" } as const;
          }
        }
      }

      if (effect.status === "retryable") {
        results.set(
          step.id,
          Object.freeze({
            stepId: step.id,
            capabilityIdentity: step.capabilityIdentity,
            status: "retryable",
            durable: false,
            affectedCount: 0,
            excludedCount: 0,
          })
        );
        continue;
      }

      const durable = await boundaries.recordStep({
        attempt,
        stepId: step.id,
        capabilityIdentity: step.capabilityIdentity,
        status: effect.status,
        effectKey: effect.status === "completed" ? effectKey : null,
        affectedCount: effect.status === "completed" ? effect.affectedCount : 0,
        excludedCount: effect.excludedCount,
        occurredAt: boundaries.now(),
      });
      results.set(step.id, publicDurable(durable));
    }

    const ordered = orderedSteps(document).map((step) => {
      const result = results.get(step.id);
      if (!result) throw new Error("Evry executor omitted a plan step");
      return result;
    });
    if (ordered.some(({ status }) => status === "retryable")) {
      return Object.freeze({
        status: "retryable",
        correlationId: attempt.correlationId,
        steps: ordered,
      });
    }

    const terminal = terminalStatusOf(ordered);
    const finished = await boundaries.finish({
      attempt,
      ...terminal,
      occurredAt: boundaries.now(),
    });
    return (
      resultFromSnapshot(finished, document) ?? {
        status: "unavailable",
        steps: [],
      }
    );
  };
}

const productionExecutor = createEvryExecutor(productionBoundaries);

/** Execute only through the fixed application authority and persistence seams. */
export async function executeEvryActionPlan(input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  registry: EvryExecutionCapabilityRegistry;
}): Promise<ExecuteEvryActionPlanResult> {
  return productionExecutor(input);
}

/** Execute a recipe only after matching its persisted plan to live authority. */
export async function executeEvryRecipePlan(
  input: ExecuteEvryRecipePlanInput
): Promise<ExecuteEvryActionPlanResult> {
  return productionExecutor(input);
}
