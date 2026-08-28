import assert from "node:assert/strict";
import { mock } from "node:test";

import { z } from "zod";

import {
  createEvryPlanCapabilityRegistry,
  defineEvryPlanCapability,
} from "@/lib/evry/plans";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);
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
    `http://localhost/api/evry/plans/${PLAN_ID}/confirm`,
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
  const registry = createEvryPlanCapabilityRegistry([
    defineEvryPlanCapability({
      identity: "fixture:write",
      effectClass: "database_write",
      arguments: { targetId: z.string().uuid() },
    }),
  ]);
  const decidedAt = new Date("2026-08-28T12:00:00.000Z");
  let confirmations = 0;
  const post = route.createEvryPlanConfirmPost({
    registry,
    now: () => decidedAt,
    async confirm(input) {
      events.push("confirm");
      confirmations++;
      assert.equal(input.actor.userId, PLANT_USER.id);
      assert.equal(input.actor.plantId, PLANT_USER.churchId);
      assert.equal(input.planId, PLAN_ID);
      assert.equal(input.fingerprint, FINGERPRINT);
      assert.equal(input.decidedAt, decidedAt);
      assert.equal(input.registry, registry);
      return { status: "approved", confirmationId: "confirmation-1" };
    },
  });

  // A session refusal wins even when both public inputs are invalid.
  sessions = [null];
  events.length = 0;
  let response = await responseOf(post, {}, "not-a-uuid");
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { status: "unavailable" });
  assert.deepEqual(events, ["auth"]);
  assert.equal(confirmations, 0);

  for (const invalid of [
    { planId: "not-a-uuid", body: { fingerprint: FINGERPRINT } },
    { planId: PLAN_ID, body: {} },
    { planId: PLAN_ID, body: { fingerprint: FINGERPRINT, actor: "caller" } },
    { planId: PLAN_ID, body: { fingerprint: "A".repeat(64) } },
  ]) {
    sessions = [PLANT_USER];
    events.length = 0;
    response = await responseOf(post, invalid.body, invalid.planId);
    assert.equal(response.status, 400);
    assert.equal(response.cacheControl, "private, no-store");
    assert.equal(confirmations, 0);
    assert.equal(events[0], "auth");
    assert.equal(events.includes("confirm"), false);
  }

  sessions = [PLANT_USER];
  events.length = 0;
  response = await responseOf(post, { fingerprint: FINGERPRINT });
  assert.equal(response.status, 200);
  assert.equal(response.cacheControl, "private, no-store");
  assert.deepEqual(response.body, {
    status: "approved",
    confirmationId: "confirmation-1",
  });
  assert.deepEqual(events, ["auth", "body", "confirm"]);
  assert.equal(confirmations, 1);

  process.stdout.write("Evry plan confirmation route proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
