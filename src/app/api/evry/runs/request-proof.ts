import assert from "node:assert/strict";
import { mock } from "node:test";

const events: string[] = [];
class ViewerRefusal extends Error {}

mock.module("@/lib/evry/eligibility/viewer", {
  namedExports: {
    EvryPlantViewerRefusalError: ViewerRefusal,
    requireEvryPlantViewer: async () => {
      events.push("auth");
      return {
        userId: "10000000-0000-4000-8000-000000000001",
        plantId: "20000000-0000-4000-8000-000000000001",
        seat: "owner",
      };
    },
  },
});

const REQUEST_ID = "30000000-0000-4000-8000-000000000001";

async function main() {
  const route = await import("./[requestId]/route");
  events.length = 0;
  const get = route.createEvryRunRecoveryGet({
    recover: async ({ requestKey }) => {
      events.push(`read:${requestKey}`);
      return { status: "unavailable", requestId: requestKey };
    },
  });
  const response = await get(new Request("https://example.test"), {
    params: Promise.resolve({ requestId: REQUEST_ID }),
  });
  assert.deepEqual(events, ["auth", `read:${REQUEST_ID}`]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    status: "unavailable",
    requestId: REQUEST_ID,
  });

  events.length = 0;
  const invalidGet = await get(new Request("https://example.test"), {
    params: Promise.resolve({ requestId: "forged" }),
  });
  assert.deepEqual(events, ["auth"]);
  assert.equal(invalidGet.status, 400);

  const post = route.createEvryRunResumePost({
    resume: async ({ requestKey }) => {
      events.push(`resume:${requestKey}`);
      return { status: "unavailable", requestId: requestKey };
    },
  });
  events.length = 0;
  const resumed = await post(
    new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    }),
    { params: Promise.resolve({ requestId: REQUEST_ID }) }
  );
  assert.deepEqual(events, ["auth", `resume:${REQUEST_ID}`]);
  assert.equal(resumed.status, 200);

  events.length = 0;
  const invalidPost = await post(
    new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    }),
    { params: Promise.resolve({ requestId: REQUEST_ID }) }
  );
  assert.deepEqual(events, ["auth"]);
  assert.equal(invalidPost.status, 400);
  process.stdout.write("Evry active-run request proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
