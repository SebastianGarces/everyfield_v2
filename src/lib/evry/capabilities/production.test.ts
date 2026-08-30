import assert from "node:assert/strict";
import test from "node:test";

import communicationInventory from "./communication/inventory.generated.json";
import meetingsInventory from "./meetings/inventory.generated.json";
import peopleInventory from "./people/inventory.generated.json";
import {
  createProductionEvryPlanTargetValidator,
  PRODUCTION_EVRY_ARTIFACT_REVIEWS,
  PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS,
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
} from "./production";

test("production installs every Communication, Meetings, and People effect together", () => {
  const effectIdentities = [
    ...communicationInventory.capabilities,
    ...meetingsInventory.capabilities,
    ...peopleInventory.capabilities,
  ]
    .filter(({ operationKind }) => operationKind === "effect")
    .map(({ identity }) => identity);

  assert.equal(new Set(effectIdentities).size, effectIdentities.length);
  for (const identity of effectIdentities) {
    assert.ok(
      PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity),
      `missing production plan registration for ${identity}`
    );
    assert.ok(
      PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity),
      `missing production execution registration for ${identity}`
    );
  }
});

test("production composes every Communication, Meetings, and People review exactly once", () => {
  const effectIdentities = [
    ...communicationInventory.capabilities,
    ...meetingsInventory.capabilities,
    ...peopleInventory.capabilities,
  ]
    .filter(({ operationKind }) => operationKind === "effect")
    .map(({ identity }) => identity)
    .toSorted();
  const reviewIdentities = PRODUCTION_EVRY_ARTIFACT_REVIEWS.flatMap(
    ({ source }) =>
      source.kind === "generic"
        ? [...source.capabilityIdentities]
        : [source.identity]
  ).toSorted();

  assert.deepEqual(reviewIdentities, effectIdentities);
});

test("production continuation selection keeps Communication and Meetings disjoint", () => {
  const matching = (literalUserText: string) =>
    PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS.filter(({ matches }) =>
      matches({
        actor: {} as never,
        conversation: {} as never,
        userRequestKey: "request",
        literalUserText,
        pageContext: null,
        requestPageContext: null,
        now: new Date("2026-08-29T12:00:00.000Z"),
      })
    ).map(({ identity }) => identity);

  assert.deepEqual(matching("Send email to group leaders: Hello | Welcome"), [
    "communication",
  ]);
  assert.deepEqual(matching("show meeting analytics"), ["meetings"]);
  assert.deepEqual(matching("run arbitrary SQL"), []);
});

test("production target validation dispatches only registered capability families", async () => {
  const calls: string[] = [];
  const validate = createProductionEvryPlanTargetValidator({
    async communication(input) {
      calls.push(`communication:${input.step.capabilityIdentity}`);
      return true;
    },
    async meetings(input) {
      calls.push(`meetings:${input.step.capabilityIdentity}`);
      return true;
    },
  });
  const target = async (capabilityIdentity: string) =>
    validate({
      actor: {} as never,
      plan: {} as never,
      step: {
        id: capabilityIdentity,
        capabilityIdentity,
        effectClass: "database_write",
        arguments: {},
        dependsOn: [],
      },
      checkedAt: new Date("2026-08-29T12:00:00.000Z"),
    });

  assert.equal(await target("communication.templates.create"), true);
  assert.equal(await target("meetings.lifecycle.delete"), true);
  assert.equal(await target("people.delete"), false);
  assert.deepEqual(calls, [
    "communication:communication.templates.create",
    "meetings:meetings.lifecycle.delete",
  ]);
});
