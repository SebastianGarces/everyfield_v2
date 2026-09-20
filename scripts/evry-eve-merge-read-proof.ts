import assert from "node:assert/strict";
import { mock } from "node:test";
import { z } from "zod";

const actorId = "10000000-0000-4000-8000-000000000001";
const plantId = "20000000-0000-4000-8000-000000000001";
const foreignPlant = "20000000-0000-4000-8000-000000000099";
let currentPlant = plantId;
let currentSeat = "owner";
let active = true;
let failReader = false;
let authorizations = 0;
const reads: string[] = [];

// Only transport authentication and the domain reader are isolated. Registry,
// branded actor mint, generated permission, schema and artifact paths are real.
mock.module("@/lib/auth/session-token", {
  namedExports: {
    async validateSessionId() {
      authorizations++;
      return {
        user: active
          ? {
              id: actorId,
              churchId: currentPlant,
              sendingChurchId: null,
              sendingNetworkId: null,
              seat: currentSeat,
            }
          : null,
      };
    },
  },
});
mock.module("@/lib/communication/church-merge", {
  namedExports: {
    async getChurchMergeData(id: string) {
      reads.push(id);
      assert.equal(id, plantId);
      if (failReader) throw new Error("Fixture reader unavailable");
      return {
        church_name: "Fixture Church",
        pastor_name: "Fixture Pastor",
        launch_date: "Oct 11, 2026",
      };
    },
  },
});

async function main() {
  const { createEveToolRegistry } =
    await import("@/lib/evry/eve/capabilities/registry");
  const { eveRuntimeToolSchema } =
    await import("@/lib/evry/eve/runtime/tool-schemas");
  const { authorizeEvryReadCapabilityForSession } =
    await import("@/lib/evry/eligibility/capabilities");
  const { parseEvryConversationArtifactDocument } =
    await import("@/lib/evry/conversations/artifacts");
  const identity = "communication.compose.get-church-merge-data";
  const registry = createEveToolRegistry({
    context: {
      actor: { userId: actorId, plantId },
      literalUserText: "Read the church fields",
      pageContext: null,
      now: new Date(0),
    },
    authorizeRead: (requested) => {
      assert.equal(requested, identity);
      return authorizeEvryReadCapabilityForSession(
        requested,
        "fixture-session"
      );
    },
  });
  const input = { query: { resource: "merge_context" } };
  const tool = registry
    .describe()
    .find((entry) => entry.name === "communication.query")!;
  assert.ok(tool.capabilityIdentities?.includes(identity));
  assert.equal(tool.effect, "read");
  assert.deepEqual(
    z.toJSONSchema(tool.inputSchema, { io: "input" }),
    z.toJSONSchema(eveRuntimeToolSchema(tool.name), { io: "input" })
  );
  const first = await registry.invoke(tool.name, input);
  const second = await registry.invoke(tool.name, input);
  assert.deepEqual(first, second);
  assert.match(JSON.stringify(first), /Fixture Pastor/);
  const stored = parseEvryConversationArtifactDocument(first);
  assert.equal(stored.kind, "read");
  assert.equal(reads.length, 2);
  const before = authorizations;
  assert.equal(
    z
      .object({ status: z.string() })
      .parse(
        await registry.invoke(tool.name, {
          query: { resource: "merge_context", plantId: foreignPlant },
        })
      ).status,
    "invalid_input"
  );
  assert.equal(authorizations, before);
  currentPlant = foreignPlant;
  assert.deepEqual(await registry.invoke(tool.name, input), {
    status: "unavailable",
    reason: "not_authorized",
  });
  assert.equal(reads.length, 2);
  currentPlant = plantId;
  currentSeat = "member";
  assert.deepEqual(await registry.invoke(tool.name, input), first);
  assert.equal(reads.length, 3);
  failReader = true;
  await assert.rejects(
    registry.invoke(tool.name, input),
    /Fixture reader unavailable/
  );
  failReader = false;
  active = false;
  await assert.rejects(registry.invoke(tool.name, input), {
    digest: "EF_SESSION_EXPIRED",
  });
  assert.equal(reads.length, 4);
  assert.equal(
    registry.describe().some((entry) => entry.effect === "prepare"),
    false
  );
  process.stdout.write(
    `EVRY_COMMUNICATION_READ_OUTCOMES=${JSON.stringify({ [identity]: { execution: true, idempotency: true, arguments: true, tenancy: true, permission: true, confirmation: true, errors: true, uiArtifact: true } })}\n`
  );
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
