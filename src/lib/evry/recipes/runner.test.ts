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

test("a final communication retry reuses every completed dependency", async () => {
  const effectCalls = new Map<string, number>();
  const registry = createFixtureRecipeRegistry(async (identity) => {
    const call = (effectCalls.get(identity) ?? 0) + 1;
    effectCalls.set(identity, call);
    if (identity === SEND_MESSAGE_IDENTITY && call === 1) {
      return { status: "retryable" };
    }
    return { status: "completed", affectedCount: 1, excludedCount: 0 };
  });
  const definition = registry.registrationFor(RECIPE_IDENTITY);
  assert.ok(definition);
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
    eligibleCapabilities: definition.eligibleCapabilities.map((identity) => ({
      identity,
    })),
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

  const first = await runner({
    actor: ACTOR,
    planId: PLAN_ID,
    fingerprint,
    registry,
  });
  assert.equal(first.status, "retryable");
  assert.deepEqual(first.safeRetryStepIds, ["send-invitations"]);
  assert.deepEqual(
    first.steps.map(({ status }) => status),
    ["completed", "completed", "retryable"]
  );

  const second = await runner({
    actor: ACTOR,
    planId: PLAN_ID,
    fingerprint,
    registry,
  });
  assert.equal(second.status, "completed");
  assert.deepEqual(second.safeRetryStepIds, []);
  assert.deepEqual(
    [...effectCalls.values()],
    [1, 1, 2],
    "the two completed dependencies execute once; only communication retries"
  );
  assert.equal(durable.size, 3);
});
