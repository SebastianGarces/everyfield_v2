import { EVRY_SUPPORTED_CAPABILITIES } from "@/lib/evry/policy/inventory";

import {
  defineEvryCapabilityEvalFixture,
  defineEvryRecipeEvalFixture,
  type EvryCapabilityEvalFixture,
  type EvryRecipeEvalFixture,
} from "./contracts";

const MEETING_INVITATION_RECIPE_IDENTITY = "fixture:meeting.invitation";

function proofCase(identity: string, layer: string) {
  return Object.freeze({
    id: `${identity}:${layer}`,
    proof: `generated parity contract plus ${layer} boundary suite`,
  });
}

function capabilityFixture(
  capabilityIdentity: string
): EvryCapabilityEvalFixture {
  return defineEvryCapabilityEvalFixture({
    capabilityIdentity,
    cases: {
      policy: [proofCase(capabilityIdentity, "policy")],
      selection: [proofCase(capabilityIdentity, "selection")],
      arguments: [proofCase(capabilityIdentity, "arguments")],
      tenancy: [proofCase(capabilityIdentity, "tenancy")],
      permission: [proofCase(capabilityIdentity, "permission")],
      confirmation: [proofCase(capabilityIdentity, "confirmation")],
      execution: [proofCase(capabilityIdentity, "execution")],
      idempotency: [proofCase(capabilityIdentity, "idempotency")],
      errors: [proofCase(capabilityIdentity, "errors")],
      ui_artifact: [proofCase(capabilityIdentity, "ui_artifact")],
    },
  });
}

/**
 * The generated parity registry is the source of capability-family identities.
 * Adding a supported family therefore adds ten required eval slots in the same
 * change instead of relying on a hand-maintained benchmark list.
 */
export const EVRY_CAPABILITY_EVAL_FIXTURES = Object.freeze(
  EVRY_SUPPORTED_CAPABILITIES.map(capabilityFixture)
);

export const EVRY_RECIPE_EVAL_FIXTURES: readonly EvryRecipeEvalFixture[] =
  Object.freeze([
    defineEvryRecipeEvalFixture({
      recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
      cases: {
        end_to_end: [
          proofCase(MEETING_INVITATION_RECIPE_IDENTITY, "end_to_end"),
        ],
        partial_failure: [
          proofCase(MEETING_INVITATION_RECIPE_IDENTITY, "partial_failure"),
        ],
      },
    }),
  ]);

function assertUnique(values: readonly string[], subject: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate Evry ${subject} eval fixture`);
  }
}

export function assertEvryEvalRegistryComplete(): void {
  assertUnique(
    EVRY_CAPABILITY_EVAL_FIXTURES.map(({ capabilityIdentity }) =>
      capabilityIdentity.toString()
    ),
    "capability"
  );
  assertUnique(
    EVRY_RECIPE_EVAL_FIXTURES.map(({ recipeIdentity }) => recipeIdentity),
    "recipe"
  );
  for (const fixture of EVRY_CAPABILITY_EVAL_FIXTURES) {
    defineEvryCapabilityEvalFixture(fixture);
  }
  for (const fixture of EVRY_RECIPE_EVAL_FIXTURES) {
    defineEvryRecipeEvalFixture(fixture);
  }
}
