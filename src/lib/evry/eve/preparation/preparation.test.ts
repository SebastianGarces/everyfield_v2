import assert from "node:assert/strict";
import { test } from "node:test";
import { zodSchema } from "ai";
import {
  createEvePreparation,
  evePreparationInputSchema,
  evePreparations,
} from "./index";
import { createMeetingInvitationPlanResolver } from "@/lib/evry/recipes/meeting-invitation";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

const id = "10000000-0000-4000-8000-000000000001";
const orientation = {
  operation: "recipe.meeting-invite",
  arguments: {
    meetingType: "orientation",
    dateTime: { date: "2026-09-27", time: "10:00" },
    durationMinutes: 120,
    audience: "core_team",
    subject: "Core team orientation",
    body: "Hi {{first_name}}, join us for orientation.",
  },
};

test("the actual AI SDK provider schema has an object root and preserves every operation contract", async () => {
  const schema = await zodSchema(evePreparationInputSchema).jsonSchema;
  assert.equal(schema.type, "object");
  assert.equal(schema.anyOf, undefined);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["request"]);
  const request = schema.properties?.request;
  assert(request && typeof request === "object");
  assert.equal(request.anyOf?.length, evePreparations.length);
  assert.equal(evePreparationInputSchema.safeParse(orientation).success, false);
});

test("Eve derives preparation contracts from trusted domains and requires explicit compound intent", () => {
  assert.equal(
    new Set(evePreparations.map((entry) => entry.id)).size,
    evePreparations.length
  );
  assert(evePreparations.length > 100);
  assert(evePreparationInputSchema.safeParse({ request: orientation }).success);
  for (const key of [
    "meetingType",
    "dateTime",
    "durationMinutes",
    "audience",
  ]) {
    const args: Record<string, unknown> = { ...orientation.arguments };
    delete args[key];
    assert.equal(
      evePreparationInputSchema.safeParse({
        request: { ...orientation, arguments: args },
      }).success,
      false,
      key
    );
  }
  for (const extra of [
    { actorUserId: id },
    { timezone: "UTC" },
    { approved: true },
    { fingerprint: id },
  ]) {
    assert.equal(
      evePreparationInputSchema.safeParse({
        request: {
          ...orientation,
          arguments: { ...orientation.arguments, ...extra },
        },
      }).success,
      false
    );
  }
  assert.equal(
    evePreparationInputSchema.safeParse({
      operation: "actions.commit",
      arguments: {},
    }).success,
    false
  );
});

test("missing call identity, malformed input and cancellation fail before authorization or persistence", async () => {
  const preparer = createEvePreparation({
    actor: { userId: id, plantId: id, seat: "owner" } as EvryPlantActor,
    conversationId: id,
    userRequestKey: "turn",
    literalUserText: "Create orientation",
    pageContext: null,
    now: new Date("2026-09-20T12:00:00Z"),
    async authorizeRead() {
      throw new Error("Must not authorize invalid input");
    },
  });
  assert.deepEqual(
    await preparer.prepare({ request: orientation }, { callId: "" }),
    {
      status: "unavailable",
      reason: "missing_call_identity",
    }
  );
  const invalid = await preparer.prepare(
    { operation: "actions.commit" },
    { callId: "call" }
  );
  assert("status" in invalid);
  assert.equal(invalid.status, "invalid_input");
  await assert.rejects(
    preparer.prepare(
      { request: orientation },
      {
        callId: "call",
        signal: AbortSignal.abort(),
      }
    )
  );
});

test("the production compound planner passes orientation type, title and explicit team to the trusted meeting resolver", async () => {
  const marker = new Error("Observed trusted resolver boundary");
  const planner = createMeetingInvitationPlanResolver({
    async resolveMeeting(input) {
      assert.equal(input.selection.kind, "effect");
      if (input.selection.kind !== "effect") throw marker;
      assert.equal(input.selection.values.type, "orientation");
      assert.equal(input.selection.values.title, "Core team orientation");
      assert.equal(input.selection.values.datetime, "2026-09-27T10:00:00.000Z");
      assert.equal(input.selection.values.timezone, "America/New_York");
      throw marker;
    },
    async resolveGuests() {
      throw new Error("No downstream work before meeting resolves");
    },
    async resolveAudience() {
      throw new Error("No downstream work before meeting resolves");
    },
  });
  // Resolver-minted date objects are exercised in the datetime resolver suite;
  // this seam verifies the compound planner preserves the resolved meeting intent.
  await assert.rejects(
    planner({
      actor: { userId: id, plantId: id, seat: "owner" } as EvryPlantActor,
      requestKey: id as Parameters<typeof planner>[0]["requestKey"],
      now: new Date("2026-09-20T12:00:00Z"),
      resolved: {
        kind: "resolved",
        meetingType: "orientation",
        title: "Core team orientation",
        durationMinutes: 120,
        dateTime: {
          calendarDate: "2026-09-27",
          localTime: "10:00 AM",
          timeZone: "America/New_York",
        } as Parameters<typeof planner>[0]["resolved"]["dateTime"],
        location: { id: null, name: "Church", address: "123 A St" },
        guests: [],
        exclusions: [],
        subject: "Orientation",
        body: "Join us",
      },
    }),
    (error) => error === marker
  );
});
