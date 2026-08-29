import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  parseStoredEvryActionPlan,
  type EvryActionPlanDocument,
} from "@/lib/evry/plans";
import {
  createFixtureRecipeRegistry,
  RECIPE_IDENTITY,
} from "@/lib/evry/recipes/fixtures.test-helper";

import { EVRY_CONFIRMATION_FIXTURES } from "./fixtures";
import { confirmationMatchesTrustedPlan } from "./lifecycle";
import { buildEvryConfirmationArtifact } from "./review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  trustedReviewForEvryPlanDocument,
} from "./trusted-plan-review";

const confirmation = EVRY_CONFIRMATION_FIXTURES.destructiveAction;
const displayedStep = confirmation.steps[0];
if (!displayedStep) throw new Error("Destructive fixture needs one step");

const genericDocument: EvryActionPlanDocument = {
  version: 1,
  steps: [
    {
      id: displayedStep.stepId,
      capabilityIdentity: "fixture.task.delete",
      effectClass: "database_write",
      arguments: { taskId: "task-1" },
      dependsOn: [],
    },
  ],
};

function genericRegistryFor() {
  return createEvryArtifactReviewRegistry([
    defineEvryArtifactReview({
      source: {
        kind: "generic",
        capabilityIdentities: ["fixture.task.delete"],
      },
      build: () => confirmation,
    }),
  ]);
}

test("generic capability packs derive complete review from exact plan arguments", () => {
  const review = trustedReviewForEvryPlanDocument({
    plan: confirmation.plan,
    document: genericDocument,
    reviewRegistry: createEvryArtifactReviewRegistry([
      defineEvryArtifactReview({
        source: {
          kind: "generic",
          capabilityIdentities: ["fixture.task.delete"],
        },
        build: ({ document: exact }) => {
          assert.deepEqual(exact.steps[0]?.arguments, { taskId: "task-1" });
          return confirmation;
        },
      }),
    ]),
  });
  assert.deepEqual(review, { confirmation });
  assert.equal(Object.isFrozen(review?.confirmation.steps[0]), true);
});

test("trusted generic review and exact matching refuse extra rich disclosure", () => {
  const expanded = buildEvryConfirmationArtifact({
    ...confirmation,
    consequences: [...confirmation.consequences, "Also deletes another task."],
    steps: confirmation.steps.map((step) => ({
      ...step,
      resolvedTargets: [
        ...step.resolvedTargets,
        { label: "Task", value: "Second task", sourceLink: null },
      ],
    })),
  });
  const authoritative = trustedReviewForEvryPlanDocument({
    plan: confirmation.plan,
    document: genericDocument,
    reviewRegistry: genericRegistryFor(),
  });
  assert.ok(authoritative);
  assert.equal(confirmationMatchesTrustedPlan(expanded, authoritative), false);
});

test("recipe review accepts only the live registered recipe disclosure", () => {
  const recipeRegistry = createFixtureRecipeRegistry();
  const document = parseStoredEvryActionPlan({
    document: JSON.parse(
      readFileSync(
        new URL("../recipes/meeting-invitation.golden.json", import.meta.url),
        "utf8"
      )
    ),
    registry: recipeRegistry.executionRegistry.planRegistry,
  });
  const plan = confirmation.plan;
  const reviewRegistry = createEvryArtifactReviewRegistry([
    defineEvryArtifactReview({
      source: {
        kind: "recipe",
        identity: RECIPE_IDENTITY,
        registry: recipeRegistry,
      },
      build: ({ document: exact }) =>
        buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: exact.confirmation?.title ?? "Unavailable",
          actionLabel: exact.confirmation?.actionLabel ?? "Unavailable",
          steps: exact.steps.map((step) => ({
            stepId: step.id,
            title: step.disclosure?.title ?? "Unavailable",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets:
              step.disclosure?.items.map((item) => ({
                ...item,
                sourceLink: null,
              })) ?? [],
            counts: [{ label: "Effects", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: [],
          })),
          consequences: exact.steps.flatMap(
            (step) => step.disclosure?.consequences ?? []
          ),
        }),
    }),
  ]);

  assert.ok(
    trustedReviewForEvryPlanDocument({ plan, document, reviewRegistry })
  );
  const firstStep = document.steps[0];
  const disclosure = firstStep.disclosure;
  const firstItem = disclosure?.items[0];
  if (!disclosure || !firstItem) {
    throw new Error("Recipe fixture needs disclosure");
  }
  const changed: EvryActionPlanDocument = {
    ...document,
    steps: [
      {
        ...firstStep,
        disclosure: {
          ...disclosure,
          items: [
            { ...firstItem, value: "another meeting" },
            ...disclosure.items.slice(1),
          ],
        },
      },
      ...document.steps.slice(1),
    ],
  };
  assert.equal(
    trustedReviewForEvryPlanDocument({
      plan,
      document: changed,
      reviewRegistry,
    }),
    null
  );
});
