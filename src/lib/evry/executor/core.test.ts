import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import {
  executionAttemptOutcomeKey,
  executionStepOutcomeKey,
} from "@/lib/evry/audit/identity";
import {
  EVRY_PEOPLE_READ_PROBE_IDENTITY,
  EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
  isEvryEffectCapabilityIdentity,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  defineEvryPlanCapability,
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";

import { createEvryExecutor, type EvryExecutorBoundaries } from "./core";
import type {
  EvryDurableStepOutcome,
  EvryExecutionAttemptRecord,
  EvryExecutionSnapshot,
} from "./repository";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryEffectResult,
} from "./registry";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const PLAN_ID = "30000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "50000000-0000-4000-8000-000000000001";

function authorization(actor = ACTOR): EvryEffectCapabilityAuthorization {
  return {
    actor,
    registration: {
      identity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
      parityCapability: "people.write",
      applicationCapability: "people.write",
    },
  } as unknown as EvryEffectCapabilityAuthorization;
}

function candidate(
  stepCount: number,
  finalDependencies?: readonly string[]
): unknown {
  return {
    steps: Array.from({ length: stepCount }, (_, index) => ({
      id: `step-${index + 1}`,
      capabilityIdentity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
      arguments: {
        targetId: `target-${index + 1}`,
        expectedVersion: 1,
      },
      dependsOn:
        finalDependencies && index === stepCount - 1
          ? finalDependencies
          : finalDependencies
            ? []
            : index === 0
              ? []
              : [`step-${index}`],
    })),
  };
}

type HarnessOptions = Readonly<{
  stepCount?: number;
  stale?:
    | "actor"
    | "plant"
    | "capability"
    | "confirmation"
    | "expiration"
    | "arguments"
    | "target";
  effectResultForStep?: (step: string, call: number) => EvryEffectResult;
  finalDependencies?: readonly string[];
  throwAfterCommitStep?: string;
  initiallyExpired?: boolean;
  claimDuringAuthorizationRefusal?: boolean;
  reconcileThrows?: boolean;
  resumeStartedEffectForStep?: string;
  dependencyOutputs?: boolean;
  requireExactDependencyForStep?: string;
}>;

function createHarness(options: HarnessOptions = {}) {
  const planCapability = defineEvryPlanCapability({
    identity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
    effectClass: "database_write",
    arguments: {
      targetId: z.string().min(1),
      expectedVersion: z.number().int().nonnegative(),
    },
  });
  const durable = new Map<string, EvryDurableStepOutcome>();
  const effectClaims = new Map<string, EvryEffectResult>();
  const effectCalls = new Map<string, number>();
  let terminalStatus: EvryExecutionSnapshot["terminalStatus"] = null;
  let attempt: EvryExecutionAttemptRecord | null = null;
  let starts = 0;
  let finishes = 0;
  const checks: string[] = [];
  const seenDependencyOutputs = new Map<string, readonly unknown[]>();
  let nowTick = 0;
  let clockOffsetMs = 0;
  let targetCurrent = options.stale !== "target";
  let lastEffectKey: EvryAuditKey | null = null;

  const registry = createEvryExecutionCapabilityRegistry([
    defineEvryExecutionCapability({
      planCapability,
      ...(options.dependencyOutputs
        ? {
            dependencyOutputSchema: z.strictObject({
              targetId: z.string(),
              expectedVersion: z.number().int().nonnegative(),
            }),
          }
        : {}),
      async reconcileClaimed(input) {
        checks.push("claim");
        lastEffectKey = input.effectKey;
        if (options.reconcileThrows) {
          throw new Error("claim store temporarily unavailable");
        }
        const claimed = effectClaims.get(input.effectKey);
        if (claimed) return claimed;
        const targetId = String(input.arguments.targetId);
        return options.resumeStartedEffectForStep === targetId &&
          (effectCalls.get(targetId) ?? 0) > 0
          ? { status: "resume" as const }
          : null;
      },
      async executeIfCurrent(input) {
        const targetId = String(input.arguments.targetId);
        seenDependencyOutputs.set(targetId, input.dependencyOutputs ?? []);
        checks.push(`target:${targetId}`);
        const existing = effectClaims.get(input.effectKey);
        if (existing) return existing;
        if (!targetCurrent) return { status: "refused", excludedCount: 1 };
        const call = (effectCalls.get(targetId) ?? 0) + 1;
        effectCalls.set(targetId, call);
        let result = options.effectResultForStep?.(targetId, call) ?? {
          status: "completed",
          affectedCount: 1,
          excludedCount: 0,
        };
        if (options.requireExactDependencyForStep === targetId) {
          const [dependency] = input.dependencyOutputs ?? [];
          const value = dependency?.value as
            | { targetId?: unknown; expectedVersion?: unknown }
            | undefined;
          if (
            dependency?.stepId !== "step-1" ||
            dependency.capabilityIdentity !==
              EVRY_PEOPLE_WRITE_PROBE_IDENTITY ||
            value?.targetId !== "target-1" ||
            value.expectedVersion !== 1
          ) {
            return { status: "refused", excludedCount: 1 };
          }
        }
        if (result.status === "completed" && options.dependencyOutputs) {
          result = {
            ...result,
            dependencyOutput: { targetId, expectedVersion: 1 },
          };
        }
        if (result.status === "completed") {
          effectClaims.set(input.effectKey, result);
          if (options.throwAfterCommitStep === targetId && call === 1) {
            throw new Error("transport failed after the keyed commit");
          }
        }
        return result;
      },
    }),
  ]);
  const document = parseEvryActionPlanCandidate({
    candidate: candidate(options.stepCount ?? 1, options.finalDependencies),
    registry: registry.planRegistry,
    eligibleCapabilities: [{ identity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY }],
  });
  const createdAt = new Date("2026-08-28T12:00:00.000Z");
  const expiresAt = new Date(
    options.initiallyExpired
      ? "2026-08-28T11:59:59.000Z"
      : "2026-08-28T12:15:00.000Z"
  );
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

  function snapshot(): EvryExecutionSnapshot | null {
    if (!attempt) return null;
    return {
      attempt,
      steps: [...durable.values()],
      terminalStatus,
    };
  }

  const boundaries: EvryExecutorBoundaries = {
    async authorizeCapability() {
      checks.push("capability");
      if (options.claimDuringAuthorizationRefusal) {
        assert.ok(lastEffectKey);
        effectClaims.set(lastEffectKey, {
          status: "completed",
          affectedCount: 1,
          excludedCount: 0,
        });
        return null;
      }
      if (options.stale === "capability") return null;
      if (options.stale === "actor") {
        return authorization({
          ...ACTOR,
          userId: "10000000-0000-4000-8000-000000000099",
        } as EvryPlantActor);
      }
      if (options.stale === "plant") {
        return authorization({
          ...ACTOR,
          plantId: "20000000-0000-4000-8000-000000000099",
        } as EvryPlantActor);
      }
      return authorization();
    },
    async findExactPlan() {
      checks.push("plan");
      return stored;
    },
    async findSnapshot() {
      return snapshot();
    },
    async startOrResume() {
      starts++;
      attempt ??= {
        id: "50000000-0000-4000-8000-000000000001",
        planId: PLAN_ID,
        actorUserId: ACTOR.userId,
        plantId: ACTOR.plantId,
        fingerprint,
        correlationId: CORRELATION_ID,
      };
      return snapshot();
    },
    async revalidateStep(input) {
      checks.push("confirmation-expiry-args");
      if (
        options.stale === "confirmation" ||
        options.stale === "expiration" ||
        input.checkedAt >= expiresAt ||
        input.actorUserId !== ACTOR.userId ||
        input.plantId !== ACTOR.plantId
      ) {
        return null;
      }
      if (options.stale === "arguments") {
        const changed = structuredClone(document) as unknown as {
          steps: Array<{ arguments: Record<string, unknown> }>;
        };
        changed.steps[0].arguments.expectedVersion = 2;
        return changed;
      }
      return document;
    },
    async recordStep(input) {
      const existing = durable.get(input.stepId);
      if (existing) return existing;
      const outcome: EvryDurableStepOutcome = {
        stepId: input.stepId,
        capabilityIdentity: input.capabilityIdentity,
        status: input.status,
        affectedCount: input.affectedCount,
        excludedCount: input.excludedCount,
        effectKey: input.effectKey,
        dependencyOutput: input.dependencyOutput ?? null,
      };
      durable.set(input.stepId, outcome);
      return outcome;
    },
    async finish(input) {
      finishes++;
      terminalStatus ??= input.attemptStatus;
      const current = snapshot();
      assert.ok(current);
      return current;
    },
    async expirePlan() {
      checks.push("expired-audit");
      return { status: "expired" };
    },
    now() {
      return new Date(createdAt.getTime() + clockOffsetMs + ++nowTick);
    },
  };

  return {
    execute: createEvryExecutor(boundaries),
    input: { actor: ACTOR, planId: PLAN_ID, fingerprint, registry },
    durable,
    effectCalls,
    checks,
    seenDependencyOutputs,
    replaceDurable(stepId: string, outcome: EvryDurableStepOutcome) {
      durable.set(stepId, outcome);
    },
    staleTarget() {
      targetCurrent = false;
    },
    advancePastExpiry() {
      clockOffsetMs = 16 * 60 * 1_000;
    },
    stats: () => ({ starts, finishes }),
  };
}

test("each independently stale precondition refuses before an effect", async (t) => {
  for (const stale of [
    "actor",
    "plant",
    "capability",
    "confirmation",
    "expiration",
    "arguments",
    "target",
  ] as const) {
    await t.test(stale, async () => {
      const harness = createHarness({ stale });
      const result = await harness.execute(harness.input);
      assert.equal(result.status, "refused");
      assert.equal(result.steps[0]?.status, "refused");
      assert.equal(result.steps[0]?.durable, true);
      assert.equal(
        [...harness.effectCalls.values()].reduce(
          (sum, count) => sum + count,
          0
        ),
        stale === "target" ? 0 : 0
      );
      assert.equal(harness.stats().finishes, 1);
    });
  }
});

test("an initially expired approval emits explicit expiry evidence", async () => {
  const harness = createHarness({ initiallyExpired: true });
  const result = await harness.execute(harness.input);
  assert.deepEqual(result, { status: "expired", steps: [] });
  assert.equal(harness.checks.includes("expired-audit"), true);
  assert.equal(harness.stats().starts, 0);
  assert.equal(harness.durable.size, 0);
});

test("concurrent replay and process-style restart apply one effect and keep one result", async () => {
  const harness = createHarness();
  const [first, second] = await Promise.all([
    harness.execute(harness.input),
    harness.execute(harness.input),
  ]);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(harness.effectCalls.get("target-1"), 1);
  assert.equal(harness.durable.size, 1);
  assert.equal(harness.stats().starts, 2);

  const afterRestart = await harness.execute(harness.input);
  assert.equal(afterRestart.status, "completed");
  assert.equal(harness.effectCalls.get("target-1"), 1);
  assert.equal(harness.durable.size, 1);
});

test("retryable middle work leaves its attempt open and resumes only uncompleted work", async () => {
  let middleRetry = true;
  const harness = createHarness({
    stepCount: 3,
    effectResultForStep(step) {
      if (step === "target-2" && middleRetry) {
        middleRetry = false;
        return { status: "retryable" };
      }
      return { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
  });

  const first = await harness.execute(harness.input);
  assert.equal(first.status, "retryable");
  assert.deepEqual(
    first.steps.map(({ status, durable }) => [status, durable]),
    [
      ["completed", true],
      ["retryable", false],
      ["retryable", false],
    ]
  );
  assert.equal(harness.durable.size, 1);
  assert.equal(harness.stats().finishes, 0);

  const replay = await harness.execute(harness.input);
  assert.equal(replay.status, "completed");
  assert.deepEqual(
    replay.steps.map(({ status }) => status),
    ["completed", "completed", "completed"]
  );
  assert.equal(harness.effectCalls.get("target-1"), 1);
  assert.equal(harness.effectCalls.get("target-2"), 2);
  assert.equal(harness.effectCalls.get("target-3"), 1);
  assert.equal(harness.durable.size, 3);
  assert.equal(harness.stats().finishes, 1);
});

test("dependency outputs reach only exact direct successors", async (t) => {
  await t.test("forwards an exact schema-checked output", async () => {
    const harness = createHarness({
      stepCount: 2,
      dependencyOutputs: true,
      requireExactDependencyForStep: "target-2",
    });
    const result = await harness.execute(harness.input);
    assert.equal(result.status, "completed");
    assert.equal(harness.seenDependencyOutputs.get("target-1")?.length, 0);
    assert.equal(harness.seenDependencyOutputs.get("target-2")?.length, 1);
  });

  for (const corruption of ["foreign-key", "missing", "mismatched"] as const) {
    await t.test(`refuses ${corruption} predecessor output`, async () => {
      let retry = true;
      const harness = createHarness({
        stepCount: 2,
        dependencyOutputs: true,
        requireExactDependencyForStep: "target-2",
        effectResultForStep(step) {
          if (step === "target-2" && retry) {
            retry = false;
            return { status: "retryable" };
          }
          return { status: "completed", affectedCount: 1, excludedCount: 0 };
        },
      });
      assert.equal((await harness.execute(harness.input)).status, "retryable");
      const predecessor = harness.durable.get("step-1");
      assert.ok(predecessor);
      harness.replaceDurable("step-1", {
        ...predecessor,
        ...(corruption === "foreign-key"
          ? { effectKey: "0".repeat(64) as EvryAuditKey }
          : {}),
        ...(corruption === "missing" ? { dependencyOutput: null } : {}),
        ...(corruption === "mismatched"
          ? {
              dependencyOutput: {
                targetId: "foreign-target",
                expectedVersion: 1,
              },
            }
          : {}),
      });

      const result = await harness.execute(harness.input);
      assert.equal(result.status, "partially_failed");
      assert.equal(result.steps[1]?.status, "refused");
    });
  }
});

test("an open attempt crossing expiry closes from per-step revalidation", async () => {
  const harness = createHarness({
    stepCount: 3,
    effectResultForStep(step) {
      return step === "target-2"
        ? { status: "retryable" }
        : { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
  });

  const first = await harness.execute(harness.input);
  assert.equal(first.status, "retryable");
  assert.deepEqual(
    first.steps.map(({ status }) => status),
    ["completed", "retryable", "retryable"]
  );

  harness.advancePastExpiry();
  const replay = await harness.execute(harness.input);
  assert.equal(replay.status, "partially_failed");
  assert.deepEqual(
    replay.steps.map(({ status, durable }) => [status, durable]),
    [
      ["completed", true],
      ["refused", true],
      ["skipped", true],
    ]
  );
  assert.equal(harness.effectCalls.get("target-1"), 1);
  assert.equal(harness.effectCalls.get("target-2"), 1);
  assert.equal(harness.effectCalls.has("target-3"), false);
  assert.equal(harness.stats().finishes, 1);
  assert.equal(harness.checks.includes("expired-audit"), false);
});

test("an irreversible started effect resumes from immutable inputs after expiry", async () => {
  const harness = createHarness({
    resumeStartedEffectForStep: "target-1",
    effectResultForStep(_step, call) {
      return call === 1
        ? { status: "retryable" }
        : { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
  });

  assert.equal((await harness.execute(harness.input)).status, "retryable");
  harness.advancePastExpiry();
  const replay = await harness.execute(harness.input);
  assert.equal(replay.status, "completed");
  assert.equal(replay.steps[0]?.status, "completed");
  assert.equal(harness.effectCalls.get("target-1"), 2);
  assert.equal(
    harness.checks.filter((check) => check === "confirmation-expiry-args")
      .length,
    1,
    "recovery reuses the exact stored step instead of reopening mutable plan freshness"
  );
});

test("a terminal middle failure durably skips its dependent and blocks follow-on work", async () => {
  const harness = createHarness({
    stepCount: 3,
    effectResultForStep(step) {
      return step === "target-2"
        ? { status: "failed", excludedCount: 1 }
        : { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
  });
  const result = await harness.execute(harness.input);
  assert.equal(result.status, "partially_failed");
  assert.deepEqual(
    result.steps.map(({ status }) => status),
    ["completed", "failed", "skipped"]
  );
  assert.equal(harness.effectCalls.has("target-3"), false);
  assert.equal(harness.durable.size, 3);
});

test("durable dependency blockers win over retryable blockers regardless of order", async () => {
  for (const finalDependencies of [
    ["step-1", "step-2"],
    ["step-2", "step-1"],
  ] as const) {
    const harness = createHarness({
      stepCount: 3,
      finalDependencies,
      effectResultForStep(step) {
        if (step === "target-1") return { status: "retryable" };
        if (step === "target-2") return { status: "failed", excludedCount: 1 };
        return { status: "completed", affectedCount: 1, excludedCount: 0 };
      },
    });
    const result = await harness.execute(harness.input);
    assert.equal(result.status, "retryable");
    assert.deepEqual(
      result.steps.map(({ status, durable }) => [status, durable]),
      [
        ["retryable", false],
        ["failed", true],
        ["skipped", true],
      ]
    );
    assert.equal(harness.effectCalls.has("target-3"), false);
  }
});

test("a throw after keyed commit retries and recovers one completed effect", async () => {
  const harness = createHarness({ throwAfterCommitStep: "target-1" });
  const interrupted = await harness.execute(harness.input);
  assert.equal(interrupted.status, "retryable");
  assert.equal(harness.durable.size, 0);
  assert.equal(harness.stats().finishes, 0);
  const authorizationsBeforeRecovery = harness.checks.filter(
    (check) => check === "capability"
  ).length;

  harness.staleTarget();
  const recovered = await harness.execute(harness.input);
  assert.equal(recovered.status, "completed");
  assert.equal(harness.effectCalls.get("target-1"), 1);
  assert.equal(harness.durable.size, 1);
  assert.equal(harness.stats().finishes, 1);
  assert.equal(
    harness.checks.filter((check) => check === "capability").length,
    authorizationsBeforeRecovery,
    "an exact domain claim must reconcile before mutable authorization"
  );
});

test("a claim committed during authorization is rechecked before refusal", async () => {
  const harness = createHarness({ claimDuringAuthorizationRefusal: true });
  const result = await harness.execute(harness.input);
  assert.equal(result.status, "completed");
  assert.equal(result.steps[0]?.status, "completed");
  assert.equal(harness.effectCalls.size, 0);
  assert.equal(harness.checks.filter((check) => check === "claim").length, 2);
});

test("claim-store lookup failures remain non-durable and retryable", async () => {
  const harness = createHarness({ reconcileThrows: true });
  const result = await harness.execute(harness.input);
  assert.equal(result.status, "retryable");
  assert.deepEqual(
    result.steps.map(({ status, durable }) => [status, durable]),
    [["retryable", false]]
  );
  assert.equal(harness.effectCalls.size, 0);
  assert.equal(harness.durable.size, 0);
  assert.equal(harness.stats().finishes, 0);
});

test("terminal replay returns immutable plan order despite reverse commit order", async () => {
  const harness = createHarness({ stepCount: 3 });
  const completed = await harness.execute(harness.input);
  assert.equal(completed.status, "completed");

  const reverseCommitOrder = [...harness.durable.values()].reverse();
  harness.durable.clear();
  for (const outcome of reverseCommitOrder) {
    harness.durable.set(outcome.stepId, outcome);
  }

  const replay = await harness.execute(harness.input);
  assert.deepEqual(
    replay.steps.map(({ stepId }) => stepId),
    ["step-1", "step-2", "step-3"]
  );
});

test("read registrations cannot enter the effect registry", () => {
  assert.equal(
    isEvryEffectCapabilityIdentity(EVRY_PEOPLE_READ_PROBE_IDENTITY),
    false
  );
  const readPlanCapability = defineEvryPlanCapability({
    identity: EVRY_PEOPLE_READ_PROBE_IDENTITY,
    effectClass: "database_write",
    arguments: {},
  });
  assert.throws(
    () =>
      defineEvryExecutionCapability({
        planCapability: readPlanCapability,
        async executeIfCurrent() {
          return { status: "completed", affectedCount: 0, excludedCount: 0 };
        },
      }),
    /not an authoritative effect/
  );
});

test("a legal step named attempt cannot collide with the terminal outcome", () => {
  const fingerprint = "a".repeat(64);
  assert.notEqual(
    executionStepOutcomeKey(PLAN_ID, fingerprint, "attempt"),
    executionAttemptOutcomeKey(PLAN_ID, fingerprint)
  );
});

test("effect counters outside PostgreSQL int4 are refused at the adapter boundary", async () => {
  const planCapability = defineEvryPlanCapability({
    identity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
    effectClass: "database_write",
    arguments: {},
  });
  const registration = defineEvryExecutionCapability({
    planCapability,
    async executeIfCurrent() {
      return {
        status: "completed",
        affectedCount: 2_147_483_648,
        excludedCount: 0,
      };
    },
  });
  await assert.rejects(
    () =>
      registration.executeIfCurrent({
        authorization: authorization(),
        effectKey: "b".repeat(64) as EvryAuditKey,
        execution: {
          attemptId: ATTEMPT_ID,
          planId: PLAN_ID,
          actorUserId: ACTOR.userId,
          plantId: ACTOR.plantId,
          fingerprint: "a".repeat(64),
          correlationId: CORRELATION_ID,
          stepId: "step-1",
          capabilityIdentity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
        },
        arguments: {},
      }),
    /2147483647/
  );
});

test("terminal lifecycle counts stay representable while exact totals remain derivable", async () => {
  const harness = createHarness({
    stepCount: 2,
    effectResultForStep() {
      return {
        status: "completed",
        affectedCount: 2_147_483_647,
        excludedCount: 2_147_483_647,
      };
    },
  });

  const result = await harness.execute(harness.input);
  assert.equal(result.status, "completed");
  assert.equal(
    result.steps.reduce((sum, step) => sum + step.affectedCount, 0),
    4_294_967_294
  );
  assert.equal(
    result.steps.reduce((sum, step) => sum + step.excludedCount, 0),
    4_294_967_294
  );
  assert.equal(harness.stats().finishes, 1);
});

test("effect results cannot append fields or follow-on work", async () => {
  const planCapability = defineEvryPlanCapability({
    identity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
    effectClass: "database_write",
    arguments: {},
  });
  const registration = defineEvryExecutionCapability({
    planCapability,
    async executeIfCurrent() {
      return {
        status: "completed",
        affectedCount: 1,
        excludedCount: 0,
        steps: [{ id: "unconfirmed-follow-on" }],
      };
    },
  });
  await assert.rejects(
    () =>
      registration.executeIfCurrent({
        authorization: authorization(),
        effectKey: "c".repeat(64) as EvryAuditKey,
        execution: {
          attemptId: ATTEMPT_ID,
          planId: PLAN_ID,
          actorUserId: ACTOR.userId,
          plantId: ACTOR.plantId,
          fingerprint: "a".repeat(64),
          correlationId: CORRELATION_ID,
          stepId: "step-1",
          capabilityIdentity: EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
        },
        arguments: {},
      }),
    /unrecognized key/i
  );
});
