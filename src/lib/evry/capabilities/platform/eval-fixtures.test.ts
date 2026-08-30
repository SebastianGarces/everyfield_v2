import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EVRY_CAPABILITY_EVAL_LAYERS,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";

import inventory from "./inventory.generated.json";
import {
  PLATFORM_ARTIFACT_REVIEWS,
  PLATFORM_EXECUTION_CAPABILITIES,
} from "./effects";
import { PLATFORM_CAPABILITY_REGISTRY } from "./registrations";
import { selectPlatformEvryRequest } from "./selection";

const COMMANDS: Readonly<Record<string, string>> = {
  "dashboard.summary.get": "show dashboard summary",
  "notifications.badge.unread-count": "show unread notification count",
  "notifications.feed.list": "show notifications",
  "notifications.feed.mark-all-read": "mark all notifications read",
  "notifications.feed.mark-one-read":
    "mark notification 10000000-0000-4000-8000-000000000001 read",
  "platform.feedback.submit":
    'submit feedback {"category":"bug","description":"literal"}',
};
const LIVE_EFFECT_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "execution",
  "idempotency",
  "errors",
]);

function hasExecution(identity: string) {
  return PLATFORM_EXECUTION_CAPABILITIES.some(
    ({ planCapability }) => planCapability.identity === identity
  );
}

function hasReview(identity: string) {
  return PLATFORM_ARTIFACT_REVIEWS.some(
    ({ source }) =>
      source.kind === "generic" &&
      source.capabilityIdentities.includes(identity)
  );
}

for (const capability of inventory.capabilities) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    if (
      capability.operationKind === "effect" &&
      LIVE_EFFECT_LAYERS.has(layer)
    ) {
      continue;
    }
    if (capability.operationKind === "read" && LIVE_EFFECT_LAYERS.has(layer)) {
      continue;
    }
    test(`${capability.identity}:${layer}`, () => {
      const registration = PLATFORM_CAPABILITY_REGISTRY.registrationFor(
        capability.identity
      );
      assert.ok(registration);
      switch (layer) {
        case "policy":
          assert.equal(registration.operationKind, capability.operationKind);
          assert.doesNotMatch(
            COMMANDS[capability.identity]!,
            /database|network/i
          );
          break;
        case "selection":
          assert.ok(selectPlatformEvryRequest(COMMANDS[capability.identity]!));
          break;
        case "arguments":
          assert.equal(
            capability.operationKind === "effect",
            hasExecution(capability.identity)
          );
          break;
        case "tenancy":
          assert.ok(
            capability.surfaceIdentities.every((identity) =>
              inventory.entries.some(
                (entry) =>
                  entry.identity === identity &&
                  entry.classification.state === "supported"
              )
            )
          );
          break;
        case "permission":
          assert.equal(
            registration.applicationCapability,
            capability.applicationCapability
          );
          break;
        case "confirmation":
          assert.equal(
            hasReview(capability.identity),
            capability.operationKind === "effect"
          );
          break;
        case "execution":
          assert.equal(capability.operationKind, "read");
          assert.match(
            readFileSync("src/lib/evry/capabilities/platform/reads.ts", "utf8"),
            /authorizeEvryReadCapability/
          );
          break;
        case "idempotency":
          assert.deepEqual(
            selectPlatformEvryRequest(COMMANDS[capability.identity]!),
            selectPlatformEvryRequest(COMMANDS[capability.identity]!)
          );
          break;
        case "errors":
          assert.equal(
            selectPlatformEvryRequest(`${COMMANDS[capability.identity]} extra`),
            null
          );
          break;
        case "ui_artifact":
          assert.equal(
            capability.operationKind === "effect"
              ? hasReview(capability.identity)
              : capability.confirmation === "not_required",
            true
          );
          break;
      }
    });
  }
}
