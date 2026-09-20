import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { createEveToolRegistry, type EveToolContext } from "./registry";
import { EVE_CAPABILITY_CATALOG, EVE_WORKFLOW_COVERAGE } from "./catalog";
import {
  selectEveInvitationTemplate,
  type EveHelperDependencies,
} from "./helpers";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import { isEvryReadCapabilityIdentity } from "@/lib/evry/eligibility/capabilities";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { buildEvryReadArtifact } from "@/lib/evry/artifacts/core";

const actor = {
  userId: "20000000-0000-4000-8000-000000000001",
  plantId: "30000000-0000-4000-8000-000000000001",
};
const context: EveToolContext = {
  actor,
  literalUserText: "Create an orientation",
  pageContext: null,
  now: new Date("2026-09-20T14:00:00Z"),
};
// The test controls the authorization dependency. Production can only obtain this brand from auth.
const authority = (identity: string, overrides: Partial<typeof actor> = {}) =>
  ({
    actor: { ...actor, seat: "owner", ...overrides },
    registration: { identity },
  }) as EvryReadCapabilityAuthorization;
const helpers: EveHelperDependencies = {
  readTimeZone: async () => "America/New_York",
  listLocations: async () => [
    {
      id: "40000000-0000-4000-8000-000000000001",
      name: "Church",
      address: "123 A St, North Ridgeville, OH 44039",
      capacity: 80,
      isActive: true,
    },
  ],
  getLocation: async () => null,
  listTemplates: async () => [],
};

test("registry carries all 23 baseline contracts with one schema source and no execution tool", () => {
  const registry = createEveToolRegistry({
    context,
    authorizeRead: async () => null,
    helperDependencies: helpers,
    preparation: {
      inputSchema: z.strictObject({
        operation: z.literal("example"),
        arguments: z.strictObject({}),
      }),
      prepare: async () => ({ status: "prepared" }),
    },
  });
  const names = registry.describe().map((entry) => entry.name);
  for (const [name] of EVE_CAPABILITY_CATALOG)
    assert.ok(names.includes(name), name);
  assert.equal(EVE_CAPABILITY_CATALOG.length, 23);
  assert.equal(names.length, 28);
  assert.equal(new Set(names).size, names.length);
  assert.equal(
    names.some((name) => /execute|confirm|commit|send$/.test(name)),
    false
  );
  for (const description of registry.describe())
    assert.doesNotThrow(
      () => z.toJSONSchema(description.inputSchema, { io: "input" }),
      description.name
    );
});

test("unavailable preparation cannot be advertised as functioning", () => {
  const registry = createEveToolRegistry({
    context,
    authorizeRead: async () => null,
    helperDependencies: helpers,
  });
  assert.equal(
    registry.describe().some((entry) => entry.name === "actions.prepare"),
    false
  );
});

test("every invocation refreshes exact authority and rejects switched tenant or account before reading", async () => {
  let calls = 0;
  let authorizations = 0;
  let authorized = true;
  const read = defineEvryReadRegistration({
    id: "people.query",
    capabilityIdentity: "people.read.list",
    inputShape: { label: z.string() },
    async run(_context, input) {
      calls++;
      return buildEvryReadArtifact({
        title: input.label,
        filters: [],
        exclusions: [],
        items: [],
        sourceLinks: [],
      });
    },
  });
  const registry = createEveToolRegistry({
    context,
    reads: [read],
    helperDependencies: helpers,
    authorizeRead: async (id) => {
      authorizations++;
      return authorized ? authority(id) : null;
    },
  });
  assert.equal(
    (await registry.invoke("people.query", { label: "People" })) !== null,
    true
  );
  authorized = false;
  assert.deepEqual(await registry.invoke("people.query", { label: "People" }), {
    status: "unavailable",
    reason: "not_authorized",
  });
  assert.equal(calls, 1);
  assert.equal(authorizations, 2);
  for (const wrong of [{ plantId: "foreign" }, { userId: "another-account" }]) {
    const switched = createEveToolRegistry({
      context,
      reads: [read],
      helperDependencies: helpers,
      authorizeRead: async (id) => authority(id, wrong),
    });
    assert.deepEqual(
      await switched.invoke("people.query", { label: "People" }),
      { status: "unavailable", reason: "not_authorized" }
    );
  }
  assert.equal(calls, 1);
});

test("unknown, malformed and cancelled invocations cannot reach helpers", async () => {
  let queries = 0;
  const registry = createEveToolRegistry({
    context,
    reads: [],
    helperDependencies: {
      ...helpers,
      listLocations: async () => {
        queries++;
        return [];
      },
    },
    authorizeRead: async (id) => authority(id),
  });
  assert.deepEqual(await registry.invoke("executeApprovedPlan", {}), {
    status: "unavailable",
    reason: "unknown_tool",
  });
  const malformed = await registry.invoke("locations.query", {
    plantId: "foreign",
  });
  assert.equal(
    typeof malformed === "object" &&
      malformed !== null &&
      !Array.isArray(malformed) &&
      malformed.status,
    "invalid_input"
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    registry.invoke("locations.query", {}, { signal: abort.signal }),
    { name: "AbortError" }
  );
  assert.equal(queries, 0);
});

test("prepare receives the trusted composition call identity and cannot accept a model key", async () => {
  const received: string[] = [];
  const registry = createEveToolRegistry({
    context,
    reads: [],
    helperDependencies: helpers,
    authorizeRead: async () => null,
    preparation: {
      inputSchema: z.strictObject({ operation: z.literal("meeting.create") }),
      prepare: async (_input, invocation) => {
        received.push(invocation.callId);
        return { status: "prepared" };
      },
    },
  });
  assert.deepEqual(
    await registry.invoke("actions.prepare", { operation: "meeting.create" }),
    { status: "unavailable", reason: "missing_call_identity" }
  );
  await registry.invoke(
    "actions.prepare",
    { operation: "meeting.create", callId: "model-key" },
    { callId: "real:tool-0" }
  );
  assert.equal(received.length, 0);
  await registry.invoke(
    "actions.prepare",
    { operation: "meeting.create" },
    { callId: "real:tool-0" }
  );
  assert.deepEqual(received, ["real:tool-0"]);
});

test("helpers expose valid inventory-backed reads and minimal scoped operational data", async () => {
  const registry = createEveToolRegistry({
    context,
    reads: [],
    helperDependencies: helpers,
    authorizeRead: async (id) => {
      assert.ok(isEvryReadCapabilityIdentity(id), id);
      return authority(id);
    },
  });
  assert.deepEqual(await registry.invoke("context.get", {}), {
    referenceInstant: "2026-09-20T14:00:00.000Z",
    today: "2026-09-20",
    timeZone: "America/New_York",
  });
  assert.deepEqual(
    await registry.invoke("locations.get", {
      id: "40000000-0000-4000-8000-000000000099",
    }),
    { status: "unavailable" }
  );
  const locations = await registry.invoke("locations.query", {
    search: "church",
  });
  assert.match(JSON.stringify(locations), /123 A St/);
  assert.doesNotMatch(JSON.stringify(locations), /churchId|contactEmail/);
  const template = await registry.invoke("templates.for_meeting", {
    meetingType: "orientation",
  });
  assert.match(JSON.stringify(template), /Orientation/);
});

test("orientation gets its full template and a renamed church override wins by source identity", () => {
  const system = selectEveInvitationTemplate("orientation", []);
  assert.equal(system.status, "available");
  if (system.status !== "available") return;
  assert.equal(system.meetingType, "orientation");
  assert.match(system.body, /\{\{/);
  const custom = selectEveInvitationTemplate("orientation", [
    {
      id: "template-id",
      name: "Welcome to the team",
      sourceName: system.name,
      category: "meeting_invitation",
      subject: "A personal welcome",
      body: "Hello {{first_name}}, see you at {{meeting_time}}.",
      bodyHtml: null,
      mergeFields: ["first_name", "meeting_time"],
    },
  ]);
  assert.equal(custom.status, "available");
  if (custom.status !== "available") return;
  assert.equal(custom.templateId, "template-id");
  assert.equal(custom.subject, "A personal welcome");
  assert.match(custom.body, /Hello \{\{first_name\}\}/);
  assert.notEqual(custom.version, system.version);
});

test("workflow coverage files exist and together account for all 19 capability areas", () => {
  assert.equal(EVE_WORKFLOW_COVERAGE.length, 11);
  const areas = new Set(
    EVE_WORKFLOW_COVERAGE.flatMap((workflow) => [...workflow.areas])
  );
  assert.equal(areas.size, 19);
  for (const workflow of EVE_WORKFLOW_COVERAGE) {
    const body = readFileSync(`agent/skills/${workflow.name}/SKILL.md`, "utf8");
    assert.ok(body.startsWith(`---\nname: ${workflow.name}\n`));
    assert.match(body, /description: .+/);
    assert.ok(body.length < 5000, `${workflow.name} should stay concise`);
  }
});
