import {
  defineEvryCapabilityEvalFixture,
  type EvryCapabilityEvalFixture,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";

import { MEETINGS_OPERATION_REGISTRATIONS } from "./registrations";

const LIVE_EFFECT_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "execution",
  "idempotency",
  "errors",
]);

function fixtureFor(
  registration: (typeof MEETINGS_OPERATION_REGISTRATIONS)[number]
): EvryCapabilityEvalFixture {
  const proofCase = (layer: EvryCapabilityEvalLayer) => [
    {
      id: `${registration.identity}:${layer}`,
      proofId:
        registration.operationKind === "effect" && LIVE_EFFECT_LAYERS.has(layer)
          ? "meetings-effect-live"
          : "meetings-capability-contract",
      testName: `${registration.identity}:${layer}`,
    },
  ];
  const cases: EvryCapabilityEvalFixture["cases"] = {
    policy: proofCase("policy"),
    selection: proofCase("selection"),
    arguments: proofCase("arguments"),
    tenancy: proofCase("tenancy"),
    permission: proofCase("permission"),
    confirmation: proofCase("confirmation"),
    execution: proofCase("execution"),
    idempotency: proofCase("idempotency"),
    errors: proofCase("errors"),
    ui_artifact: proofCase("ui_artifact"),
  };
  return defineEvryCapabilityEvalFixture({
    capabilityIdentity: registration.identity,
    cases,
  });
}

/**
 * Derived from production registrations: adding a Meetings operation creates
 * ten missing named proof cases in the same diff instead of relying on a
 * separately maintained release roster.
 */
export const MEETINGS_CAPABILITY_EVAL_FIXTURES: readonly EvryCapabilityEvalFixture[] =
  Object.freeze(MEETINGS_OPERATION_REGISTRATIONS.map(fixtureFor));
