import {
  defineEvryCapabilityEvalFixture,
  type EvryCapabilityEvalFixture,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";

import { MEETINGS_OPERATION_REGISTRATIONS } from "./registrations";

function fixtureFor(
  registration: (typeof MEETINGS_OPERATION_REGISTRATIONS)[number]
): EvryCapabilityEvalFixture {
  const proofCase = (layer: EvryCapabilityEvalLayer) => {
    if (layer === "selection") {
      return [
        {
          id: `${registration.identity}:${layer}`,
          proofId: "meetings-selection",
          testName:
            registration.operationKind === "effect"
              ? "the closed Meetings grammar selects every registered effect exactly"
              : "the closed Meetings grammar selects each read without confirmation",
        },
      ];
    }
    if (layer === "policy") {
      return [
        {
          id: `${registration.identity}:${layer}`,
          proofId: "meetings-selection",
          testName:
            "the closed Meetings application policy admits each named capability and rejects non-application requests",
        },
      ];
    }
    if (
      registration.operationKind === "effect" &&
      (layer === "arguments" ||
        layer === "confirmation" ||
        layer === "ui_artifact")
    ) {
      return [
        {
          id: `${registration.identity}:${layer}`,
          proofId: "meetings-capability-contract",
          testName:
            layer === "arguments"
              ? "every authoritative effect has one strict complete fingerprint contract"
              : "every Meetings effect renders its exact complete confirmation",
        },
      ];
    }
    return [
      {
        id: `${registration.identity}:${layer}`,
        proofId:
          registration.operationKind === "effect"
            ? "meetings-effect-live"
            : "meetings-read-live",
        testName: `${registration.identity}:${layer}`,
      },
    ];
  };
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
