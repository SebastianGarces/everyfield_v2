import assert from "node:assert/strict";
import { mock } from "node:test";

import { z } from "zod";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);
const EFFECT_IDENTITY =
  "action:src/app/(dashboard)/people/actions.ts → updatePersonAction";
const PLANT_USER: SessionUser = {
  id: "20000000-0000-4000-8000-000000000001",
  churchId: "30000000-0000-4000-8000-000000000001",
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
  const { defineEvryPlanCapability } = await import("@/lib/evry/plans");
  const registry = createEvryExecutionCapabilityRegistry([
    defineEvryExecutionCapability({
      planCapability: defineEvryPlanCapability({
        identity: EFFECT_IDENTITY,
        effectClass: "database_write",
        arguments: { targetId: z.string().uuid() },
      }),
      async executeIfCurrent() {
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

  process.stdout.write("Evry plan execution route proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
