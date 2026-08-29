import assert from "node:assert/strict";
import { mock } from "node:test";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const USER: SessionUser = {
  id: "10000000-0000-4000-8000-000000000001",
  churchId: "20000000-0000-4000-8000-000000000001",
  sendingChurchId: null,
  sendingNetworkId: null,
  seat: "owner",
};
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const PLAN_ID = "40000000-0000-4000-8000-000000000001";
const REQUEST_KEY = "50000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);
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

function request(body: unknown): Request {
  return new TracedRequest(
    "http://localhost/api/evry/conversations/" + CONVERSATION_ID + "/artifacts",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

async function main(): Promise<void> {
  const route = await import("./route");
  let lifecycleCalls = 0;
  const post = route.createEvryArtifactLifecyclePost({
    async runLifecycle(input) {
      events.push("lifecycle");
      lifecycleCalls++;
      assert.equal(input.actor.userId, USER.id);
      assert.equal(input.actor.plantId, USER.churchId);
      assert.equal(input.conversationId, CONVERSATION_ID);
      assert.equal(input.request.action, "execute");
      assert.equal(input.request.plan.planId, PLAN_ID);
      assert.equal(input.request.plan.fingerprint, FINGERPRINT);
      return {
        status: "unavailable",
        message:
          "This plan is no longer available. Review the conversation before trying another change.",
      };
    },
    correlationId: () => "60000000-0000-4000-8000-000000000001",
  });

  sessions = [null];
  events.length = 0;
  let response = await post(request({}), {
    params: Promise.resolve({ conversationId: "not-a-uuid" }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(events, ["auth"]);
  assert.equal(lifecycleCalls, 0);

  for (const invalid of [
    {},
    {
      action: "execute",
      requestKey: REQUEST_KEY,
      plan: { planId: PLAN_ID, fingerprint: FINGERPRINT },
      steps: [],
    },
    {
      action: "rerun",
      requestKey: REQUEST_KEY,
      plan: { planId: PLAN_ID, fingerprint: FINGERPRINT },
    },
    {
      action: "execute",
      requestKey: REQUEST_KEY,
      plan: { planId: PLAN_ID, fingerprint: FINGERPRINT.toUpperCase() },
    },
  ]) {
    sessions = [USER];
    events.length = 0;
    response = await post(request(invalid), {
      params: Promise.resolve({ conversationId: CONVERSATION_ID }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(events[0], "auth");
    assert.equal(events.includes("lifecycle"), false);
  }

  sessions = [USER];
  events.length = 0;
  response = await post(
    request({
      action: "execute",
      requestKey: REQUEST_KEY,
      plan: { planId: PLAN_ID, fingerprint: FINGERPRINT },
    }),
    { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
  );
  assert.equal(response.status, 409);
  assert.deepEqual(events, ["auth", "body", "lifecycle"]);
  assert.deepEqual(await response.json(), {
    status: "unavailable",
    error: {
      kind: "expected",
      message:
        "This plan is no longer available. Review the conversation before trying another change.",
    },
  });

  const unexpectedPost = route.createEvryArtifactLifecyclePost({
    async runLifecycle() {
      throw new Error("provider secret database stack");
    },
    correlationId: () => "60000000-0000-4000-8000-000000000001",
  });
  sessions = [USER];
  const originalError = console.error;
  console.error = () => {};
  try {
    response = await unexpectedPost(
      request({
        action: "execute",
        requestKey: REQUEST_KEY,
        plan: { planId: PLAN_ID, fingerprint: FINGERPRINT },
      }),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(response.status, 500);
  const serialized = JSON.stringify(await response.json());
  assert.match(serialized, /60000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(serialized, /provider secret|database|stack/);

  process.stdout.write("Evry artifact lifecycle route proof passed\n");
}

void main();
