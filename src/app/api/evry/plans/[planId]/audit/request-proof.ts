import assert from "node:assert/strict";
import { mock } from "node:test";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const PLAN_ID = "10000000-0000-4000-8000-000000000001";
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

async function responseOf(
  get: (
    request: Request,
    context: { params: Promise<{ planId: string }> }
  ) => Promise<Response>,
  planId = PLAN_ID
) {
  const response = await get(new Request("http://localhost"), {
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
  const projection = {
    planId: PLAN_ID,
    status: "completed",
    correlationId: "90000000-0000-4000-8000-000000000001",
    events: [{ type: "plan_proposed", occurredAt: "2026-08-28T12:00:00.000Z" }],
    attempts: [],
  } as const;
  let reads = 0;
  const get = route.createEvryPlanAuditGet({
    async find(input) {
      events.push("read");
      reads++;
      assert.equal(input.actor.userId, PLANT_USER.id);
      assert.equal(input.actor.plantId, PLANT_USER.churchId);
      assert.equal(input.planId, PLAN_ID);
      return projection;
    },
  });

  sessions = [null];
  events.length = 0;
  let response = await responseOf(get, "not-a-uuid");
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { status: "unavailable" });
  assert.deepEqual(events, ["auth"]);
  assert.equal(reads, 0);

  sessions = [PLANT_USER];
  events.length = 0;
  response = await responseOf(get, "not-a-uuid");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { status: "unavailable" });
  assert.deepEqual(events, ["auth"]);
  assert.equal(reads, 0);

  sessions = [PLANT_USER];
  events.length = 0;
  response = await responseOf(get);
  assert.equal(response.status, 200);
  assert.equal(response.cacheControl, "private, no-store");
  assert.deepEqual(response.body, { status: "available", audit: projection });
  assert.deepEqual(events, ["auth", "read"]);
  assert.equal(reads, 1);

  const missing = route.createEvryPlanAuditGet({
    async find() {
      return null;
    },
  });
  for (const user of [
    PLANT_USER,
    { ...PLANT_USER, churchId: crypto.randomUUID() },
  ]) {
    sessions = [user];
    response = await responseOf(missing);
    assert.equal(response.status, 404);
    assert.equal(response.cacheControl, "private, no-store");
    assert.deepEqual(response.body, { status: "unavailable" });
  }

  process.stdout.write("Evry plan audit route proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
