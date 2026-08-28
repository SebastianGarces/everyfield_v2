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
import type { EvryExecutionCapabilityRegistry } from "./registry";

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
  return async function execute(input: {
    actor: EvryPlantActor;
    planId: string;
    fingerprint: string;
    registry: EvryExecutionCapabilityRegistry;
  }): Promise<ExecuteEvryActionPlanResult> {
    const exact = await boundaries.findExactPlan({
      planId: input.planId,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      fingerprint: input.fingerprint,
    });
    if (!exact) return { status: "unavailable", steps: [] };

    const document = parseExactPlan(exact, input.registry);
    if (!document) return { status: "unavailable", steps: [] };

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

      const executionRegistration = input.registry.registrationFor(
        step.capabilityIdentity
      );
      const authorization = await boundaries.authorizeCapability(
        step.capabilityIdentity
      );
      if (!executionRegistration || !authorization) {
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

      const currentDocument = await boundaries.revalidateStep({
        attempt,
        actorUserId: authorization.actor.userId,
        plantId: authorization.actor.plantId,
        checkedAt: boundaries.now(),
      });
      let current: EvryActionPlanDocument | null = null;
      try {
        current = parseStoredEvryActionPlan({
          document: currentDocument,
          registry: input.registry.planRegistry,
        });
      } catch {
        // The same neutral refusal covers a stale confirmation, expiry, actor,
        // plant, capability registration, or stored argument contract.
      }
      const currentStep = current?.steps.find(({ id }) => id === step.id);
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
      let effect;
      try {
        effect = await executionRegistration.executeIfCurrent({
          authorization,
          effectKey,
          arguments: currentStep.arguments,
        });
      } catch {
        // The adapter may have committed its keyed effect before transport or
        // process failure. Absence of a closed result is therefore retryable,
        // never evidence of a terminal failure.
        effect = { status: "retryable" } as const;
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
