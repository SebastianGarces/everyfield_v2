import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evryCapabilityRegistrationFor,
  type EvryEffectCapabilityAuthorization,
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
import { EVRY_SUPPORTED_CAPABILITIES } from "@/lib/evry/policy/inventory";
import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";
import {
  ADD_GUESTS_IDENTITY,
  CREATE_MEETING_IDENTITY,
  createFixtureRecipeRegistry,
  RECIPE_IDENTITY,
  SEND_MESSAGE_IDENTITY,
} from "@/lib/evry/recipes/fixtures.test-helper";

import { EVRY_CAPABILITY_EVAL_LAYERS } from "./contracts";

const CAPABILITIES = [
  CREATE_MEETING_IDENTITY,
  ADD_GUESTS_IDENTITY,
  SEND_MESSAGE_IDENTITY,
] as const;
const ACTOR = {
  userId: "40000000-0000-4000-8000-000000000001",
  plantId: "50000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "70000000-0000-4000-8000-000000000001";
const registry = createFixtureRecipeRegistry();
const recipe = registry.registrationFor(RECIPE_IDENTITY);
assert.ok(recipe);
const golden = JSON.parse(
  readFileSync(
    new URL("../recipes/meeting-invitation.golden.json", import.meta.url),
    "utf8"
  )
) as {
  confirmation: { title: string; actionLabel: string };
  steps: Array<{
    capabilityIdentity: string;
    arguments: Record<string, unknown>;
  }>;
};

function effectAuthorization(
  identity: string,
  actor: EvryPlantActor = ACTOR
): EvryEffectCapabilityAuthorization {
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration);
  assert.equal(registration.operationKind, "effect");
  assert.ok(registration.surfaceIdentities.length > 0);
  return {
    actor,
    registration,
  } as unknown as EvryEffectCapabilityAuthorization;
}

function createBehaviorHarness(input: {
  identity: (typeof CAPABILITIES)[number];
  authorization: "allowed" | "denied" | "foreign_tenant";
  effect: "completed" | "failed";
}) {
  const goldenStep = golden.steps.find(
    (step) => step.capabilityIdentity === input.identity
  );
  assert.ok(goldenStep);
  const effectCalls: Array<{
    identity: string;
    authorization: EvryEffectCapabilityAuthorization;
    effectKey: string;
    arguments: Readonly<Record<string, unknown>>;
  }> = [];
  const behaviorRegistry = createFixtureRecipeRegistry(
    async (identity, effectInput) => {
      effectCalls.push({ identity, ...effectInput });
      return input.effect === "failed"
        ? { status: "failed", excludedCount: 1 }
        : { status: "completed", affectedCount: 1, excludedCount: 0 };
    }
  );
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "reference-step",
          capabilityIdentity: input.identity,
          arguments: goldenStep.arguments,
          dependsOn: [],
        },
      ],
    },
    registry: behaviorRegistry.executionRegistry.planRegistry,
    eligibleCapabilities: [{ identity: input.identity }],
  });
  const createdAt = new Date("2026-08-28T12:00:00.000Z");
  const expiresAt = new Date("2026-08-28T12:15:00.000Z");
  const fingerprint = fingerprintEvryActionPlan({
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    expiresAt,
    document,
  });
  const stored: StoredEvryActionPlan = {
    id: PLAN_ID,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    requestKey: mintEvryPlanRequestKey(),
    intentFingerprint: fingerprintEvryActionPlanIntent({
      actorUserId: ACTOR.userId,
      plantId: ACTOR.plantId,
      document,
    }),
    fingerprint,
    document,
    createdAt,
    expiresAt,
    supersedesPlanId: null,
    status: "approved",
    stateVersion: 1,
    stateChangedAt: createdAt,
  };
  const durable = new Map<string, EvryDurableStepOutcome>();
  let attempt: EvryExecutionAttemptRecord | null = null;
  let terminalStatus: EvryExecutionSnapshot["terminalStatus"] = null;
  let tick = 0;
  function snapshot(): EvryExecutionSnapshot | null {
    if (!attempt) return null;
    return { attempt, steps: [...durable.values()], terminalStatus };
  }
  const boundaries: EvryExecutorBoundaries = {
    async authorizeCapability() {
      if (input.authorization === "denied") return null;
      if (input.authorization === "foreign_tenant") {
        return effectAuthorization(input.identity, {
          ...ACTOR,
          plantId: "50000000-0000-4000-8000-000000000099",
        } as EvryPlantActor);
      }
      return effectAuthorization(input.identity);
    },
    async findExactPlan() {
      return stored;
    },
    async findSnapshot() {
      return snapshot();
    },
    async startOrResume() {
      attempt ??= {
        id: "80000000-0000-4000-8000-000000000001",
        planId: PLAN_ID,
        actorUserId: ACTOR.userId,
        plantId: ACTOR.plantId,
        fingerprint,
        correlationId: CORRELATION_ID,
      };
      return snapshot();
    },
    async revalidateStep(revalidation) {
      return revalidation.actorUserId === ACTOR.userId &&
        revalidation.plantId === ACTOR.plantId
        ? document
        : null;
    },
    async recordStep(outcome) {
      const existing = durable.get(outcome.stepId);
      if (existing) return existing;
      const recorded: EvryDurableStepOutcome = {
        stepId: outcome.stepId,
        capabilityIdentity: outcome.capabilityIdentity,
        status: outcome.status,
        affectedCount: outcome.affectedCount,
        excludedCount: outcome.excludedCount,
      };
      durable.set(outcome.stepId, recorded);
      return recorded;
    },
    async finish(finish) {
      terminalStatus = finish.attemptStatus;
      const finished = snapshot();
      assert.ok(finished);
      return finished;
    },
    async expirePlan() {
      return { status: "expired" };
    },
    now() {
      return new Date(createdAt.getTime() + ++tick);
    },
  };
  const execute = createEvryExecutor(boundaries);
  return {
    effectCalls,
    expectedArguments: goldenStep.arguments,
    run: () =>
      execute({
        actor: ACTOR,
        planId: PLAN_ID,
        fingerprint,
        registry: behaviorRegistry.executionRegistry,
      }),
  };
}

for (const identity of CAPABILITIES) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    test(`${identity}:${layer}`, async () => {
      const capabilityRegistration = evryCapabilityRegistrationFor(identity);
      const definitionStep = recipe.steps.find(
        (step) => step.capabilityIdentity === identity
      );
      const goldenStep = golden.steps.find(
        (step) => step.capabilityIdentity === identity
      );
      const execution = registry.executionRegistry.registrationFor(identity);
      const plan =
        registry.executionRegistry.planRegistry.registrationFor(identity);

      assert.ok(capabilityRegistration);
      assert.equal(capabilityRegistration.operationKind, "effect");
      assert.ok(capabilityRegistration.surfaceIdentities.length > 0);
      assert.ok(definitionStep);
      assert.ok(goldenStep);
      assert.ok(execution);
      assert.ok(plan);

      switch (layer) {
        case "policy":
          assert.ok(
            capabilityRegistration.parityCapability &&
              EVRY_SUPPORTED_CAPABILITIES.includes(
                capabilityRegistration.parityCapability
              )
          );
          break;
        case "selection":
          assert.ok(recipe.eligibleCapabilities.includes(identity));
          break;
        case "arguments":
          assert.equal(
            plan.argumentsSchema.safeParse(goldenStep.arguments).success,
            true
          );
          assert.equal(
            plan.argumentsSchema.safeParse({
              ...goldenStep.arguments,
              unauthorizedExtra: true,
            }).success,
            false
          );
          break;
        case "tenancy":
          {
            const harness = createBehaviorHarness({
              identity,
              authorization: "foreign_tenant",
              effect: "completed",
            });
            const result = await harness.run();
            assert.equal(result.status, "refused");
            assert.equal(result.steps[0]?.status, "refused");
            assert.equal(harness.effectCalls.length, 0);
          }
          break;
        case "permission":
          {
            const harness = createBehaviorHarness({
              identity,
              authorization: "denied",
              effect: "completed",
            });
            const result = await harness.run();
            assert.equal(result.status, "refused");
            assert.equal(result.steps[0]?.status, "refused");
            assert.equal(harness.effectCalls.length, 0);
          }
          break;
        case "confirmation":
          assert.ok(golden.confirmation.title);
          assert.ok(golden.confirmation.actionLabel);
          assert.ok(definitionStep.disclosure.consequences.length > 0);
          break;
        case "execution":
          {
            const harness = createBehaviorHarness({
              identity,
              authorization: "allowed",
              effect: "completed",
            });
            const result = await harness.run();
            assert.equal(result.status, "completed");
            assert.equal(harness.effectCalls.length, 1);
            assert.equal(harness.effectCalls[0]?.identity, identity);
            assert.equal(
              harness.effectCalls[0]?.authorization.registration.identity,
              identity
            );
            assert.deepEqual(
              harness.effectCalls[0]?.arguments,
              harness.expectedArguments
            );
          }
          break;
        case "idempotency":
          {
            const harness = createBehaviorHarness({
              identity,
              authorization: "allowed",
              effect: "completed",
            });
            assert.equal((await harness.run()).status, "completed");
            assert.equal((await harness.run()).status, "completed");
            assert.equal(harness.effectCalls.length, 1);
            assert.match(
              harness.effectCalls[0]?.effectKey ?? "",
              /^[0-9a-f]{64}$/
            );
          }
          break;
        case "errors":
          {
            const harness = createBehaviorHarness({
              identity,
              authorization: "allowed",
              effect: "failed",
            });
            const result = await harness.run();
            assert.equal(result.status, "failed");
            assert.equal(result.steps[0]?.status, "failed");
            assert.equal(result.steps[0]?.durable, true);
            assert.equal(harness.effectCalls.length, 1);
          }
          break;
        case "ui_artifact": {
          const disclosed = definitionStep.disclosure.items.flatMap((item) =>
            item.value.kind === "argument" ? [item.value.argumentKey] : []
          );
          assert.deepEqual(
            disclosed.toSorted(),
            Object.keys(definitionStep.arguments).toSorted()
          );
          break;
        }
      }
    });
  }
}
