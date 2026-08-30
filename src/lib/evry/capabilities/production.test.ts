import assert from "node:assert/strict";
import test from "node:test";

import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import { continueCommunicationEvryConversation } from "./communication/conversation";
import communicationInventory from "./communication/inventory.generated.json";
import meetingsInventory from "./meetings/inventory.generated.json";
import peopleInventory from "./people/inventory.generated.json";
import {
  createProductionEvryPlanTargetValidator,
  PRODUCTION_EVRY_ARTIFACT_REVIEWS,
  PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS,
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
} from "./production";
import { continueTaskEvryConversation } from "./tasks/conversation";
import { TASK_ACTION_CONTRACTS } from "./tasks/contracts";
import type { TaskEffectExport } from "./tasks/effect-contracts";
import taskInventory from "./tasks/inventory.generated.json";
import {
  TASK_EFFECT_SELECTION_FIXTURES,
  taskEffectPlanFixture,
} from "./tasks/test-fixtures";

const PRODUCTION_CAPABILITIES = [
  ...communicationInventory.capabilities,
  ...meetingsInventory.capabilities,
  ...peopleInventory.capabilities,
  ...taskInventory.capabilities,
];

test("production installs every Communication, Meetings, People, and Tasks effect together", () => {
  const identities = PRODUCTION_CAPABILITIES.map(({ identity }) => identity);
  assert.equal(new Set(identities).size, identities.length);

  for (const capability of PRODUCTION_CAPABILITIES) {
    const execution = PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(
      capability.identity
    );
    const plan = PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(
      capability.identity
    );
    assert.equal(Boolean(execution), capability.operationKind === "effect");
    assert.equal(Boolean(plan), capability.operationKind === "effect");
  }
});

test("production composes every Communication, Meetings, People, and Tasks review exactly once", () => {
  const effectIdentities = PRODUCTION_CAPABILITIES.filter(
    ({ operationKind }) => operationKind === "effect"
  )
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

test("every Task effect has its trusted review in the production registry", () => {
  for (const [exportName, contract] of Object.entries(TASK_ACTION_CONTRACTS)) {
    if (contract.operationKind !== "effect") continue;
    const identity = contract.operationId;
    const document = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: identity,
            capabilityIdentity: identity,
            arguments: taskEffectPlanFixture(exportName as TaskEffectExport),
            dependsOn: [],
          },
        ],
      },
      registry: PRODUCTION_EVRY_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    });
    assert.ok(PRODUCTION_EVRY_REVIEW_REGISTRY.registrationFor(document));
  }
});

test("Task selection remains disjoint from every installed production family", () => {
  for (const text of [
    ...Object.values(TASK_EFFECT_SELECTION_FIXTURES),
    "Show the pending phase checklist prompt",
    "Load more tasks after 10000000-0000-4000-8000-000000000001",
    "Show checklist items for task 10000000-0000-4000-8000-000000000001",
    "Load more prerequisites for task 10000000-0000-4000-8000-000000000001 after 10000000-0000-4000-8000-000000000002",
    "Show task assignees for task 10000000-0000-4000-8000-000000000001 matching owner",
    "Load more task prerequisites for task 10000000-0000-4000-8000-000000000001 matching launch after 10000000-0000-4000-8000-000000000002",
  ]) {
    const input = {
      actor: {} as never,
      conversation: {} as never,
      userRequestKey: "request",
      literalUserText: text,
      pageContext: null,
      requestPageContext: null,
      now: new Date("2026-08-29T12:00:00.000Z"),
    };
    assert.equal(continueTaskEvryConversation.matches(input), true, text);
    assert.equal(
      continueCommunicationEvryConversation.matches(input),
      false,
      text
    );
    assert.deepEqual(
      PRODUCTION_EVRY_CAPABILITY_CONTINUATIONS.filter(({ matches }) =>
        matches(input)
      ).map(({ identity }) => identity),
      ["tasks"],
      text
    );
  }
});
