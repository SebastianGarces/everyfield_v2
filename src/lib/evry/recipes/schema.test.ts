import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADD_GUESTS_IDENTITY,
  createFixtureRecipeRegistry,
  fixtureRecipeDefinition,
} from "./fixtures.test-helper";
import { EvryRecipeRegistrationError } from "./schema";

function steps(
  definition: Record<string, unknown>
): Array<Record<string, unknown>> {
  return definition.steps as Array<Record<string, unknown>>;
}

function rejectsRegistration(
  mutate: (definition: Record<string, unknown>) => void,
  pattern: RegExp
): void {
  const definition = fixtureRecipeDefinition();
  mutate(definition);
  assert.throws(
    () => createFixtureRecipeRegistry(undefined, [definition]),
    (error: unknown) => {
      assert.ok(error instanceof EvryRecipeRegistrationError);
      assert.match(error.message, pattern);
      return true;
    }
  );
}

test("registered recipes declare inputs, resolvers, capabilities, dependencies, and failure policy", () => {
  const recipe = createFixtureRecipeRegistry().registrationFor(
    "fixture:meeting.invitation"
  );
  assert.ok(recipe);
  assert.equal(recipe.requiredInputs.length, 6);
  assert.equal(recipe.optionalInputs.length, 1);
  assert.deepEqual(recipe.recordResolvers, [
    {
      inputKey: "person_ids",
      resolverIdentity: "fixture:people.resolve",
    },
  ]);
  assert.equal(
    recipe.steps.every((step) => step.failurePolicy),
    true
  );
  assert.equal(Object.isFrozen(recipe), true);
  assert.equal(Object.isFrozen(recipe.steps), true);
});

test("registration rejects unknown capabilities, cycles, hidden effects, and missing disclosure", () => {
  rejectsRegistration((definition) => {
    const capabilities = definition.eligibleCapabilities as string[];
    capabilities[0] = "fixture:unknown";
    steps(definition)[0].capabilityIdentity = "fixture:unknown";
  }, /Unknown Evry recipe capability/);

  rejectsRegistration((definition) => {
    steps(definition)[0].dependsOn = ["send-invitations"];
  }, /cycle/);

  rejectsRegistration((definition) => {
    definition.eligibleCapabilities = [
      ADD_GUESTS_IDENTITY,
      "communication.messages.send",
    ];
  }, /hidden effect/);

  rejectsRegistration((definition) => {
    delete steps(definition)[1].disclosure;
  }, /invalid shape/);

  rejectsRegistration((definition) => {
    const disclosure = steps(definition)[1].disclosure as {
      items: unknown[];
    };
    disclosure.items.pop();
  }, /does not disclose argument personIds/);

  rejectsRegistration((definition) => {
    const disclosure = steps(definition)[1].disclosure as {
      consequences: unknown[];
    };
    disclosure.consequences = [];
  }, /invalid shape/);
});

test("a recipe has no permission, confirmation, executor, or eval override field", () => {
  const bypasses: Array<(definition: Record<string, unknown>) => void> = [
    (definition) => {
      definition.permission = "allow";
    },
    (definition) => {
      const confirmation = definition.confirmation as Record<string, unknown>;
      confirmation.required = false;
    },
    (definition) => {
      steps(definition)[0].executor = async () => ({ status: "completed" });
    },
    (definition) => {
      definition.evaluation = { skipCapabilitySuites: true };
    },
  ];

  for (const bypass of bypasses) {
    rejectsRegistration(bypass, /invalid shape/);
  }
});
