import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  EvryEffectCapabilityAuthorization,
  EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutor,
  type EvryExecutorBoundaries,
} from "@/lib/evry/executor/core";
import type {
  EvryDurableStepOutcome,
  EvryExecutionAttemptRecord,
  EvryExecutionSnapshot,
} from "@/lib/evry/executor/repository";
import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";

import { createEvryRecipeCompiler } from "./compiler";
import {
  createFixtureRecipeRegistry,
  FIXTURE_RECIPE_VALUES,
  fixtureRecipeDefinition,
  RECIPE_IDENTITY,
  SEND_MESSAGE_IDENTITY,
} from "./fixtures.test-helper";
import { createEvryRecipeRunner } from "./runner";

const ACTOR = {
  userId: "40000000-0000-4000-8000-000000000001",
  plantId: "50000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const PLAN_ID = "60000000-0000-4000-8000-000000000001";

function readAuthorization(): EvryReadCapabilityAuthorization {
  return { actor: ACTOR } as unknown as EvryReadCapabilityAuthorization;
}

function effectAuthorization(
  identity: string
): EvryEffectCapabilityAuthorization {
  return {
    actor: ACTOR,
    registration: {
      identity,
      parityCapability: "fixture.write",
      applicationCapability: "manage_settings",
    },
  } as unknown as EvryEffectCapabilityAuthorization;
}

type FinalBehavior = "retry-once" | "retry-always" | "throw-after-commit";

async function createHarness(input: {
  finalBehavior: FinalBehavior;
  finalRetry: "same_plan" | "never";
}) {
  const effectCalls = new Map<string, number>();
  const committedEffectKeys = new Set<string>();
  const observedEffectKeys = new Map<string, Set<string>>();
  const definition = fixtureRecipeDefinition();
  const steps = definition.steps as Array<{
    id: string;
    failurePolicy: { retry: "same_plan" | "never" };
  }>;
  const finalStep = steps.find(({ id }) => id === "send-invitations");
  assert.ok(finalStep);
  finalStep.failurePolicy = { retry: input.finalRetry };

  const registry = createFixtureRecipeRegistry(
    async (identity, effectInput) => {
      const call = (effectCalls.get(identity) ?? 0) + 1;
      effectCalls.set(identity, call);
      const keys = observedEffectKeys.get(identity) ?? new Set<string>();
      keys.add(effectInput.effectKey);
      observedEffectKeys.set(identity, keys);

      if (identity !== SEND_MESSAGE_IDENTITY) {
        return { status: "completed", affectedCount: 1, excludedCount: 0 };
      }
      if (committedEffectKeys.has(effectInput.effectKey)) {
        return { status: "completed", affectedCount: 1, excludedCount: 0 };
      }
      if (input.finalBehavior === "retry-always") {
        return { status: "retryable" };
      }
      if (input.finalBehavior === "retry-once" && call === 1) {
        return { status: "retryable" };
      }
      if (input.finalBehavior === "throw-after-commit") {
        committedEffectKeys.add(effectInput.effectKey);
        throw new Error("fixture response was lost after commit");
      }
      return { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
    [definition]
  );
  const registeredDefinition = registry.registrationFor(RECIPE_IDENTITY);
  assert.ok(registeredDefinition);
  const compile = createEvryRecipeCompiler({
    async authorizeResolver() {
      return readAuthorization();
    },
  });
  const compiled = await compile({
    actor: ACTOR,
    registry,
    recipeIdentity: RECIPE_IDENTITY,
    inputValues: FIXTURE_RECIPE_VALUES,
    eligibleCapabilities: registeredDefinition.eligibleCapabilities.map(
      (identity) => ({ identity })
    ),
  });
  const createdAt = new Date("2026-08-28T12:00:00.000Z");
  const expiresAt = new Date("2026-08-28T12:15:00.000Z");
  const fingerprint = fingerprintEvryActionPlan({
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    expiresAt,
    document: compiled.document,
  });
  const stored: StoredEvryActionPlan = Object.freeze({
    id: PLAN_ID,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    requestKey: mintEvryPlanRequestKey(),
    intentFingerprint: fingerprintEvryActionPlanIntent({
      actorUserId: ACTOR.userId,
      plantId: ACTOR.plantId,
      document: compiled.document,
    }),
    fingerprint,
    document: compiled.document,
    createdAt,
    expiresAt,
    supersedesPlanId: null,
    status: "approved",
    stateVersion: 1,
    stateChangedAt: createdAt,
  });

  const durable = new Map<string, EvryDurableStepOutcome>();
  let attempt: EvryExecutionAttemptRecord | null = null;
  let terminalStatus: EvryExecutionSnapshot["terminalStatus"] = null;
  function snapshot(): EvryExecutionSnapshot | null {
    if (!attempt) return null;
    return {
      attempt,
      steps: [...durable.values()],
      terminalStatus,
    };
  }
  const boundaries: EvryExecutorBoundaries = {
    async authorizeCapability(identity) {
      return effectAuthorization(identity);
    },
    async findExactPlan() {
      return stored;
    },
    async findSnapshot() {
      return snapshot();
    },
    async startOrResume() {
      attempt ??= {
        id: "70000000-0000-4000-8000-000000000001",
        planId: PLAN_ID,
        actorUserId: ACTOR.userId,
        plantId: ACTOR.plantId,
        fingerprint,
        correlationId: "80000000-0000-4000-8000-000000000001",
      };
      return snapshot();
    },
    async revalidateStep() {
      return compiled.document;
    },
    async recordStep(input) {
      const previous = durable.get(input.stepId);
      if (previous) return previous;
      const outcome: EvryDurableStepOutcome = Object.freeze({
        stepId: input.stepId,
        capabilityIdentity: input.capabilityIdentity,
        status: input.status,
        affectedCount: input.affectedCount,
        excludedCount: input.excludedCount,
      });
      durable.set(input.stepId, outcome);
      return outcome;
    },
    async finish(input) {
      terminalStatus = input.attemptStatus;
      const finished = snapshot();
      assert.ok(finished);
      return finished;
    },
    async expirePlan() {
      return { status: "expired" };
    },
    now() {
      return new Date("2026-08-28T12:01:00.000Z");
    },
  };
  const runner = createEvryRecipeRunner({
    async findExactPlan() {
      return stored;
    },
    execute: createEvryExecutor(boundaries),
  });

  return {
    durable,
    effectCalls,
    observedEffectKeys,
    async run() {
      return runner({
        actor: ACTOR,
        planId: PLAN_ID,
        fingerprint,
        registry,
      });
    },
  };
}

test("a safe final communication retry reuses every completed dependency", async () => {
  const harness = await createHarness({
    finalBehavior: "retry-once",
    finalRetry: "same_plan",
  });

  const first = await harness.run();
  assert.equal(first.status, "retryable");
  assert.deepEqual(first.safeRetryStepIds, ["send-invitations"]);
  assert.deepEqual(
    first.steps.map(({ status }) => status),
    ["completed", "completed", "retryable"]
  );

  const second = await harness.run();
  assert.equal(second.status, "completed");
  assert.deepEqual(second.safeRetryStepIds, []);
  assert.deepEqual(
    [...harness.effectCalls.values()],
    [1, 1, 2],
    "the two completed dependencies execute once; only communication retries"
  );
  assert.equal(harness.durable.size, 3);
});

test("a never-retry result becomes durable and the adapter runs once across two calls", async () => {
  const harness = await createHarness({
    finalBehavior: "retry-always",
    finalRetry: "never",
  });

  const first = await harness.run();
  assert.equal(first.status, "partially_failed");
  assert.deepEqual(first.safeRetryStepIds, []);
  assert.deepEqual(
    first.steps.map(({ status, durable }) => [status, durable]),
    [
      ["completed", true],
      ["completed", true],
      ["failed", true],
    ]
  );

  const second = await harness.run();
  assert.equal(second.status, "partially_failed");
  assert.deepEqual(second.safeRetryStepIds, []);
  assert.deepEqual(
    [...harness.effectCalls.values()],
    [1, 1, 1],
    "the explicit never-retry result is not sent to its adapter twice"
  );
  assert.equal(harness.durable.size, 3);
});

test("a never-retry step may replay the same effect key after a lost commit response", async () => {
  const harness = await createHarness({
    finalBehavior: "throw-after-commit",
    finalRetry: "never",
  });

  const first = await harness.run();
  assert.equal(first.status, "retryable");
  assert.deepEqual(first.safeRetryStepIds, []);
  assert.equal(harness.durable.size, 2);

  const second = await harness.run();
  assert.equal(second.status, "completed");
  assert.deepEqual([...harness.effectCalls.values()], [1, 1, 2]);
  assert.equal(
    harness.observedEffectKeys.get(SEND_MESSAGE_IDENTITY)?.size,
    1,
    "transport recovery reuses the exact idempotency key"
  );
  assert.equal(harness.durable.size, 3);
});
