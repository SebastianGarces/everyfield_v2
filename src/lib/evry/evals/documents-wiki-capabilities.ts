import generated from "@/lib/evry/capabilities/documents-wiki/inventory.generated.json";

import {
  defineEvryCapabilityEvalFixture,
  type EvryCapabilityEvalFixture,
  type EvryCapabilityEvalLayer,
} from "./contracts";

const LIVE_OUTCOME_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "tenancy",
  "permission",
  "execution",
  "idempotency",
  "errors",
  "ui_artifact",
]);

function proofCase(identity: string, layer: EvryCapabilityEvalLayer) {
  const live = LIVE_OUTCOME_LAYERS.has(layer);
  return Object.freeze({
    id: `${identity}:${layer}${live ? ":live-database" : ""}`,
    proofId: live
      ? "documents-wiki-capability-live-outcomes"
      : "documents-wiki-capability-contract",
    testName: `${identity}:${layer}${live ? ":live" : ""}`,
  });
}

function fixtureFor(
  capability: (typeof generated.capabilities)[number]
): EvryCapabilityEvalFixture {
  const cases = (layer: EvryCapabilityEvalLayer) => [
    proofCase(capability.identity, layer),
  ];
  return defineEvryCapabilityEvalFixture({
    capabilityIdentity: capability.identity,
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
}

export const DOCUMENTS_WIKI_CAPABILITY_EVAL_FIXTURES = Object.freeze(
  generated.capabilities.map(fixtureFor)
);

export function assertDocumentsWikiCapabilityEvalRegistryComplete(
  fixtures: readonly EvryCapabilityEvalFixture[] = DOCUMENTS_WIKI_CAPABILITY_EVAL_FIXTURES
) {
  const expected = generated.capabilities
    .map(({ identity }) => identity)
    .toSorted();
  const actual = fixtures
    .map(({ capabilityIdentity }) => capabilityIdentity)
    .toSorted();
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "Documents/wiki eval fixtures must exactly cover the generated inventory"
    );
  }
  for (const fixture of fixtures) defineEvryCapabilityEvalFixture(fixture);
}
