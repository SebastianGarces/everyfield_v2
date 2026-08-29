import generated from "@/lib/evry/capabilities/people/inventory.generated.json";

import {
  defineEvryCapabilityEvalFixture,
  type EvryCapabilityEvalFixture,
  type EvryCapabilityEvalLayer,
} from "./contracts";

export const PEOPLE_REQUIRED_FIXTURE_CLASSES = [
  "selection",
  "arguments",
  "confirmation",
  "execution",
  "idempotency",
  "failure",
] as const;

function fixtureCase(identity: string, layer: EvryCapabilityEvalLayer) {
  return Object.freeze({
    id: `${identity}:${layer}`,
    proofId: "people-capability-contract",
    testName: `${identity}:${layer}`,
  });
}

function fixtureFor(identity: string): EvryCapabilityEvalFixture {
  return defineEvryCapabilityEvalFixture({
    capabilityIdentity: identity,
    cases: {
      policy: [fixtureCase(identity, "policy")],
      selection: [fixtureCase(identity, "selection")],
      arguments: [fixtureCase(identity, "arguments")],
      tenancy: [fixtureCase(identity, "tenancy")],
      permission: [fixtureCase(identity, "permission")],
      confirmation: [fixtureCase(identity, "confirmation")],
      execution: [fixtureCase(identity, "execution")],
      idempotency: [fixtureCase(identity, "idempotency")],
      errors: [fixtureCase(identity, "errors")],
      ui_artifact: [fixtureCase(identity, "ui_artifact")],
    },
  });
}

/**
 * The fixture roster is derived from the generated authoritative inventory,
 * never a second hand-maintained list of capabilities.
 */
export const PEOPLE_CAPABILITY_EVAL_FIXTURES = Object.freeze(
  generated.capabilities.map(({ identity }) => fixtureFor(identity))
);

export function assertPeopleCapabilityEvalRegistryComplete(
  fixtures: readonly EvryCapabilityEvalFixture[] = PEOPLE_CAPABILITY_EVAL_FIXTURES
): void {
  const expected = generated.capabilities.map(({ identity }) => identity);
  const actual = fixtures.map(({ capabilityIdentity }) => capabilityIdentity);
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    expected.some((identity) => !actual.includes(identity))
  ) {
    throw new Error(
      "People capability eval fixtures must exactly cover the generated inventory"
    );
  }
  for (const capability of generated.capabilities) {
    if (
      capability.fixtureClasses.length !==
        PEOPLE_REQUIRED_FIXTURE_CLASSES.length ||
      PEOPLE_REQUIRED_FIXTURE_CLASSES.some(
        (fixtureClass, index) =>
          capability.fixtureClasses[index] !== fixtureClass
      )
    ) {
      throw new Error(
        `People capability ${capability.identity} has an incomplete fixture contract`
      );
    }
  }
  for (const fixture of fixtures) defineEvryCapabilityEvalFixture(fixture);
}
