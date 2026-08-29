import assert from "node:assert/strict";
import test from "node:test";

import communicationInventory from "@/lib/evry/capabilities/communication/inventory.generated.json";
import taskInventory from "@/lib/evry/capabilities/tasks/inventory.generated.json";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import { continueCommunicationEvryConversation } from "./communication/conversation";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
} from "./production";
import { continueTaskEvryConversation } from "./tasks/conversation";
import { TASK_ACTION_CONTRACTS } from "./tasks/contracts";
import type { TaskEffectExport } from "./tasks/effect-contracts";
import {
  TASK_EFFECT_SELECTION_FIXTURES,
  taskEffectPlanFixture,
} from "./tasks/test-fixtures";

test("production composes every Communication and Task effect exactly once", () => {
  for (const capability of [
    ...communicationInventory.capabilities,
    ...taskInventory.capabilities,
  ]) {
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

test("Task and Communication selection remain disjoint in production", () => {
  for (const text of Object.values(TASK_EFFECT_SELECTION_FIXTURES)) {
    const input = { literalUserText: text } as never;
    assert.equal(continueTaskEvryConversation.matches(input), true, text);
    assert.equal(
      continueCommunicationEvryConversation.matches(input),
      false,
      text
    );
  }
});
