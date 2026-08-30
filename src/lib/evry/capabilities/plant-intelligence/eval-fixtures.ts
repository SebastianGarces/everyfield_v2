import inventory from "./inventory.generated.json";

import {
  defineEvryCapabilityEvalFixture,
  EVRY_CAPABILITY_EVAL_LAYERS,
  type EvryEvalCase,
  type EvryCapabilityEvalFixture,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";

const LIVE_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "execution",
  "idempotency",
  "errors",
]);

function casesFor(capability: (typeof inventory.capabilities)[number]) {
  const cases: Record<EvryCapabilityEvalLayer, EvryEvalCase[]> = {
    policy: [],
    selection: [],
    arguments: [],
    tenancy: [],
    permission: [],
    confirmation: [],
    execution: [],
    idempotency: [],
    errors: [],
    ui_artifact: [],
  };
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    const live =
      capability.operationKind === "effect" && LIVE_LAYERS.has(layer);
    cases[layer].push({
      id: `${capability.identity}:${layer}`,
      proofId: live
        ? "plant-intelligence-effect-live"
        : "plant-intelligence-capability-contract",
      testName: `${capability.identity}:${layer}${live ? ":live" : ""}`,
    });
  }
  return cases;
}

export const PLANT_INTELLIGENCE_EVAL_FIXTURES: readonly EvryCapabilityEvalFixture[] =
  Object.freeze(
    inventory.capabilities.map((capability) =>
      defineEvryCapabilityEvalFixture({
        capabilityIdentity: capability.identity,
        cases: casesFor(capability),
      })
    )
  );
