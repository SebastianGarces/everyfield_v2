import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createEveToolRegistry } from "./registry";

const requested: string[] = [];
const registry = createEveToolRegistry({
  context: {
    actor: { userId: "owner", plantId: "plant" },
    literalUserText: "",
    pageContext: null,
    now: new Date(),
  },
  authorizeRead: async (identity) => {
    requested.push(identity);
    return null;
  },
});

test("extended readers preserve object-root provider schemas", () => {
  for (const name of ["intelligence.query", "tasks.query"]) {
    const tool = registry.describe().find((entry) => entry.name === name)!;
    assert.equal(
      z.toJSONSchema(tool.inputSchema, { io: "input" }).type,
      "object"
    );
  }
});

test("extended resources require their exact leaf permission, including private check-ins", async () => {
  const cases = [
    [
      "intelligence.query",
      { query: { resource: "checkins" } },
      "plant-intelligence.checkins.read",
    ],
    [
      "intelligence.query",
      { query: { resource: "feedback" } },
      "plant-intelligence.feedback.read",
    ],
    [
      "intelligence.query",
      { query: { resource: "signals" } },
      "plant-intelligence.signals.read",
    ],
    ["tasks.query", { resource: "templates" }, "tasks.read.templates"],
    [
      "tasks.query",
      { resource: "phase_prompt" },
      "tasks.read.phase-template-prompt",
    ],
  ] as const;
  for (const [name, input, identity] of cases) {
    assert.deepEqual(await registry.invoke(name, input), {
      status: "unavailable",
      reason: "not_authorized",
    });
    assert.equal(requested.at(-1), identity);
  }
});

test("catalog filters and malformed opaque cursors are rejected before authorization", async () => {
  const before = requested.length;
  for (const [name, input] of [
    ["tasks.query", { resource: "templates", where: { all: [] } }],
    ["intelligence.query", { query: { resource: "feedback", cursor: "bad" } }],
    [
      "intelligence.query",
      { query: { resource: "checkins", plantId: "foreign" } },
    ],
  ] as const) {
    assert.equal(
      z.object({ status: z.string() }).parse(await registry.invoke(name, input))
        .status,
      "invalid_input"
    );
  }
  assert.equal(requested.length, before);
});

test("opaque continuation round-trips the authoritative leaf cursor shape", async () => {
  const cursor = Buffer.from(
    JSON.stringify({
      kind: "feedback",
      recordId: "00000000-0000-4000-8000-000000000001",
      offset: 20,
      sourceFingerprint: "a".repeat(64),
    })
  ).toString("base64url");
  assert.deepEqual(
    await registry.invoke("intelligence.query", {
      query: { resource: "feedback", cursor },
    }),
    { status: "unavailable", reason: "not_authorized" }
  );
  assert.equal(requested.at(-1), "plant-intelligence.feedback.read");
});
