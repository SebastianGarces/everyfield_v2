import {
  defineEvryCapabilityEvalFixture,
  type EvryCapabilityEvalFixture,
  type EvryCapabilityEvalLayer,
  type EvryEvalProof,
} from "@/lib/evry/evals/contracts";

import inventory from "./inventory.generated.json";

export const TASK_EVAL_PROOFS: readonly EvryEvalProof[] = Object.freeze([
  {
    id: "tasks-capability-contract",
    testFile: "src/lib/evry/capabilities/tasks/eval-fixtures.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "tasks-effect-live",
    testFile: "src/lib/evry/capabilities/tasks/effect-live.test.ts",
    lane: "live_database",
    safetyGates: [],
  },
]);

const EFFECT_LIVE_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "tenancy",
  "permission",
  "execution",
  "idempotency",
  "errors",
]);
const READ_LIVE_LAYERS = new Set<EvryCapabilityEvalLayer>([
  ...EFFECT_LIVE_LAYERS,
  "ui_artifact",
]);

function evalCase(input: {
  identity: string;
  operationKind: "read" | "effect";
  layer: EvryCapabilityEvalLayer;
}) {
  const live = (
    input.operationKind === "read" ? READ_LIVE_LAYERS : EFFECT_LIVE_LAYERS
  ).has(input.layer);
  return Object.freeze({
    id: `${input.identity}:${input.layer}`,
    proofId: live ? "tasks-effect-live" : "tasks-capability-contract",
    testName: live
      ? `${input.identity} owns ${input.layer} live proof`
      : `${input.identity}:${input.layer}`,
  });
}

export const TASK_CAPABILITY_EVAL_FIXTURES: readonly EvryCapabilityEvalFixture[] =
  Object.freeze(
    inventory.capabilities.map(({ identity, operationKind }) => {
      if (operationKind !== "read" && operationKind !== "effect") {
        throw new Error(
          `Task capability ${identity} has an invalid operation kind`
        );
      }
      const cases = (layer: EvryCapabilityEvalLayer) => [
        evalCase({ identity, operationKind, layer }),
      ];
      return defineEvryCapabilityEvalFixture({
        capabilityIdentity: identity,
        cases: {
          policy: cases("policy"),
          selection: cases("selection"),
          arguments: cases("arguments"),
          tenancy: cases("tenancy"),
          permission: cases("permission"),
          confirmation: cases("confirmation"),
          execution: cases("execution"),
          idempotency: cases("idempotency"),
          errors: cases("errors"),
          ui_artifact: cases("ui_artifact"),
        },
      });
    })
  );
