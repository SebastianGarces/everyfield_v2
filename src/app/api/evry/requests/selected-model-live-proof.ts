import assert from "node:assert/strict";
import { mock } from "node:test";

const auditEvents: string[] = [];

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => ({
      user: {
        id: "selected-model-live-proof",
        churchId: "selected-model-live-proof-plant",
        sendingChurchId: null,
        sendingNetworkId: null,
        seat: "admin" as const,
      },
    }),
  },
});

mock.module("@/lib/evry/audit", {
  namedExports: {
    mintEvryAuditRequest: () => ({
      correlationId: "90000000-0000-4000-8000-000000000769",
      eventKey: "7".repeat(64),
      planRequestKey: "90000000-0000-4000-8000-000000000769",
    }),
    recordEvryRequestAudit: async ({
      result,
    }: {
      result: { eventType: string };
    }) => {
      auditEvents.push(result.eventType);
    },
  },
});

async function main(): Promise<void> {
  const [{ POST }, { EVRY_POLICY_MODEL_ID }] = await Promise.all([
    import("./route"),
    import("@/lib/evry/models/provider"),
  ]);
  const response = await POST(
    new Request("http://localhost/api/evry/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestText: "What can I buy for dinner with $10?",
      }),
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.status, "stopped");
  assert.equal(body.classification, "unrelated");
  assert.equal(body.artifact.kind, "boundary");
  assert.deepEqual(auditEvents, ["request_refused"]);

  process.stdout.write(
    `Evry selected-model production route passed (${EVRY_POLICY_MODEL_ID}).\n`
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
