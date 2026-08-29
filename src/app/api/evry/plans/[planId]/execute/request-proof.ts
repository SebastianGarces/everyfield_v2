import assert from "node:assert/strict";
import { mock } from "node:test";

import { z } from "zod";

import type { EvryActionPlanDocument } from "@/lib/evry/plans";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);
const PLANT_ID = "30000000-0000-4000-8000-000000000001";
const EFFECT_IDENTITY = "people.crm.people.update-person";
const PLANT_USER: SessionUser = {
  id: "20000000-0000-4000-8000-000000000001",
  churchId: PLANT_ID,
  sendingChurchId: null,
  sendingNetworkId: null,
  seat: "admin",
};

const events: string[] = [];
let sessions: Array<SessionUser | null> = [];

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      events.push("auth");
      const user = sessions.shift() ?? null;
      if (!user) throw new Error("Unauthorized");
      return { user };
    },
  },
});

class TracedRequest extends Request {
  override async json(): Promise<unknown> {
    events.push("body");
    return super.json();
  }
}

function requestWithBody(body: unknown): Request {
  return new TracedRequest(
    `http://localhost/api/evry/plans/${PLAN_ID}/execute`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

async function responseOf(
  post: (
    request: Request,
    context: { params: Promise<{ planId: string }> }
  ) => Promise<Response>,
  body: unknown,
  planId = PLAN_ID
) {
  const response = await post(requestWithBody(body), {
    params: Promise.resolve({ planId }),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

async function main(): Promise<void> {
  const route = await import("./route");
  const {
    createEvryExecutionCapabilityRegistry,
    defineEvryExecutionCapability,
  } = await import("@/lib/evry/executor");
  const { createEvryExecutor } = await import("@/lib/evry/executor/core");
  const {
    defineEvryPlanCapability,
    fingerprintEvryActionPlan,
    fingerprintEvryActionPlanIntent,
  } = await import("@/lib/evry/plans");
  const { mintEvryPlanRequestKey } =
    await import("@/lib/evry/plans/request-key");
  let adapterCalls = 0;
  const registry = createEvryExecutionCapabilityRegistry([
    defineEvryExecutionCapability({
      planCapability: defineEvryPlanCapability({
        identity: EFFECT_IDENTITY,
        effectClass: "database_write",
        arguments: { targetId: z.string().uuid() },
      }),
      async executeIfCurrent() {
        adapterCalls++;
        return { status: "completed", affectedCount: 1, excludedCount: 0 };
      },
    }),
  ]);
  let executions = 0;
  const post = route.createEvryPlanExecutePost({
    registry,
    async execute(input) {
      events.push("execute");
      executions++;
      assert.equal(input.actor.userId, PLANT_USER.id);
      assert.equal(input.actor.plantId, PLANT_USER.churchId);
      assert.equal(input.planId, PLAN_ID);
      assert.equal(input.fingerprint, FINGERPRINT);
      assert.equal(input.registry, registry);
      return {
        status: "completed",
        correlationId: "40000000-0000-4000-8000-000000000001",
        steps: [
          {
            stepId: "effect",
            capabilityIdentity: EFFECT_IDENTITY,
            status: "completed",
            durable: true,
            affectedCount: 1,
            excludedCount: 0,
          },
        ],
      };
    },
  });

  sessions = [null];
  events.length = 0;
  let response = await responseOf(post, {}, "not-a-uuid");
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { status: "unavailable", steps: [] });
  assert.deepEqual(events, ["auth"]);
  assert.equal(executions, 0);

  for (const invalid of [
    { planId: "not-a-uuid", body: { fingerprint: FINGERPRINT } },
    { planId: PLAN_ID, body: {} },
    { planId: PLAN_ID, body: { fingerprint: FINGERPRINT, steps: [] } },
    { planId: PLAN_ID, body: { fingerprint: FINGERPRINT, reminder: true } },
    { planId: PLAN_ID, body: { fingerprint: "A".repeat(64) } },
  ]) {
    sessions = [PLANT_USER];
    events.length = 0;
    response = await responseOf(post, invalid.body, invalid.planId);
    assert.equal(response.status, 400);
    assert.equal(response.cacheControl, "private, no-store");
    assert.equal(executions, 0);
    assert.equal(events[0], "auth");
    assert.equal(events.includes("execute"), false);
  }

  sessions = [PLANT_USER];
  events.length = 0;
  response = await responseOf(post, { fingerprint: FINGERPRINT });
  assert.equal(response.status, 200);
  assert.equal(response.cacheControl, "private, no-store");
  assert.equal(response.body.status, "completed");
  assert.deepEqual(events, ["auth", "body", "execute"]);
  assert.equal(executions, 1);

  const staleRecipeDocument: EvryActionPlanDocument = {
    version: 1 as const,
    recipe: {
      identity: "fixture:recipe-definition-removed",
      preconditionIdentities: [],
      safeRetryStepIds: ["effect"],
    },
    confirmation: {
      title: "Stale recipe confirmation",
      actionLabel: "Run stale recipe",
    },
    steps: [
      {
        id: "effect",
        capabilityIdentity: EFFECT_IDENTITY,
        effectClass: "database_write" as const,
        arguments: {
          targetId: "50000000-0000-4000-8000-000000000001",
        },
        dependsOn: [],
        disclosure: {
          title: "Stale recipe effect",
          items: [{ label: "Target", value: "Removed recipe target" }],
          consequences: ["Would update one target."],
        },
      },
    ],
  };
  const createdAt = new Date("2026-08-28T12:00:00.000Z");
  const expiresAt = new Date("2026-08-28T12:15:00.000Z");
  const staleFingerprint = fingerprintEvryActionPlan({
    actorUserId: PLANT_USER.id,
    plantId: PLANT_ID,
    expiresAt,
    document: staleRecipeDocument,
  });
  const storedStaleRecipe = {
    id: PLAN_ID,
    actorUserId: PLANT_USER.id,
    plantId: PLANT_ID,
    requestKey: mintEvryPlanRequestKey(),
    intentFingerprint: fingerprintEvryActionPlanIntent({
      actorUserId: PLANT_USER.id,
      plantId: PLANT_ID,
      document: staleRecipeDocument,
    }),
    fingerprint: staleFingerprint,
    document: staleRecipeDocument,
    createdAt,
    expiresAt,
    supersedesPlanId: null,
    status: "approved" as const,
    stateVersion: 1,
    stateChangedAt: createdAt,
  };
  let postValidationBoundaryCalls = 0;
  const guardedExecutor = createEvryExecutor({
    async authorizeCapability() {
      postValidationBoundaryCalls++;
      throw new Error("stale recipe reached authorization");
    },
    async findExactPlan() {
      return storedStaleRecipe;
    },
    async findSnapshot() {
      postValidationBoundaryCalls++;
      throw new Error("stale recipe reached snapshot lookup");
    },
    async startOrResume() {
      postValidationBoundaryCalls++;
      throw new Error("stale recipe reached execution persistence");
    },
    async revalidateStep() {
      postValidationBoundaryCalls++;
      throw new Error("stale recipe reached revalidation");
    },
    async recordStep() {
      postValidationBoundaryCalls++;
      throw new Error("stale recipe reached outcome persistence");
    },
    async finish() {
      postValidationBoundaryCalls++;
      throw new Error("stale recipe reached terminal persistence");
    },
    async expirePlan() {
      postValidationBoundaryCalls++;
      throw new Error("stale recipe reached expiry persistence");
    },
    now() {
      return new Date("2026-08-28T12:01:00.000Z");
    },
  });
  const guardedPost = route.createEvryPlanExecutePost({
    registry,
    async execute(input) {
      events.push("execute-recipe-guard");
      return guardedExecutor(input);
    },
  });
  sessions = [PLANT_USER];
  events.length = 0;
  response = await responseOf(guardedPost, {
    fingerprint: staleFingerprint,
  });
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { status: "unavailable", steps: [] });
  assert.deepEqual(events, ["auth", "body", "execute-recipe-guard"]);
  assert.equal(postValidationBoundaryCalls, 0);
  assert.equal(adapterCalls, 0);

  process.stdout.write("Evry plan execution route proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
