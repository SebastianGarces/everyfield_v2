import assert from "node:assert/strict";
import { test } from "node:test";

import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import generated from "./inventory.generated.json";
import {
  selectTaxonomyRequest,
  TAXONOMY_EXECUTIONS,
  TAXONOMY_IDENTITIES,
  TAXONOMY_PLAN_REGISTRY,
  TAXONOMY_REVIEW_REGISTRY,
} from "./taxonomies";

const TAG_ID = "10000000-0000-4000-8000-000000000001";
const SKILL_ID = "20000000-0000-4000-8000-000000000001";

test("tag and skill selection is closed and serialization-stable", () => {
  const selections = [
    selectTaxonomyRequest("Create tag: Follow-up | blue"),
    selectTaxonomyRequest(`Update tag ${TAG_ID}: Visitor | #123abc`),
    selectTaxonomyRequest(`Delete tag ${TAG_ID}`),
    selectTaxonomyRequest(`Assign tag ${TAG_ID}`),
    selectTaxonomyRequest(`Remove tag ${TAG_ID}`),
    selectTaxonomyRequest("Add skill: tech | Sound | advanced | FOH"),
    selectTaxonomyRequest(
      `Update skill ${SKILL_ID}: worship | Keys | expert | Sunday`
    ),
    selectTaxonomyRequest(`Remove skill ${SKILL_ID}`),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(selections)), selections);
  assert.equal(selections.every(Boolean), true);
  assert.equal(selectTaxonomyRequest("Delete all tags"), null);
  assert.equal(
    selectTaxonomyRequest("Create tag: Name | javascript:red"),
    null
  );
});

test("all eight taxonomy effects are exact generated production registrations", () => {
  const generatedEffects = new Set(
    generated.capabilities
      .filter(({ operationKind }) => operationKind === "effect")
      .map(({ identity }) => identity)
  );
  const identities = TAXONOMY_EXECUTIONS.map(
    ({ planCapability }) => planCapability.identity
  );
  assert.deepEqual(
    identities.toSorted(),
    Object.values(TAXONOMY_IDENTITIES).toSorted()
  );
  for (const identity of identities)
    assert.equal(generatedEffects.has(identity), true);
});

test("taxonomy plans require their exact immutable baselines", () => {
  const identity = TAXONOMY_IDENTITIES.updateSkill;
  const argumentsValue = {
    skillId: SKILL_ID,
    personId: TAG_ID,
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    expectedCategory: "tech",
    expectedName: "Sound",
    expectedProficiency: "advanced",
    expectedNotes: "FOH",
    category: "worship",
    name: "Keys",
    proficiency: "expert",
    notes: "Sunday",
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "update-skill",
          capabilityIdentity: identity,
          arguments: argumentsValue,
          dependsOn: [],
        },
      ],
    },
    registry: TAXONOMY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  assert.deepEqual(document.steps[0]?.arguments, argumentsValue);
  assert.throws(() =>
    parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "update-skill",
            capabilityIdentity: identity,
            arguments: { ...argumentsValue, plantId: TAG_ID },
            dependsOn: [],
          },
        ],
      },
      registry: TAXONOMY_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    })
  );
});

test("destructive taxonomy reviews disclose cascades and exact before/after", () => {
  const identity = TAXONOMY_IDENTITIES.deleteTag;
  const personIds = [TAG_ID, SKILL_ID];
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "delete-tag",
          capabilityIdentity: identity,
          arguments: {
            tagId: TAG_ID,
            expectedTagName: "Follow-up",
            expectedTagColor: "blue",
            expectedPersonIds: personIds,
          },
          dependsOn: [],
        },
      ],
    },
    registry: TAXONOMY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: SKILL_ID,
      fingerprint: "a".repeat(64),
    }),
    document,
    reviewRegistry: TAXONOMY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.equal(review.confirmation.steps[0]?.effectKind, "destructive");
  assert.equal(review.confirmation.steps[0]?.reversibility, "irreversible");
  assert.deepEqual(
    review.confirmation.steps[0]?.resolvedTargets.map(({ value }) => value),
    ["Follow-up", ...personIds]
  );
  assert.deepEqual(review.confirmation.steps[0]?.counts, [
    { label: "Tags to delete", count: 1 },
    { label: "Assignments to remove", count: 2 },
  ]);
  assert.deepEqual(review.confirmation.steps[0]?.beforeAfter, [
    { label: "Tag", before: "Follow-up", after: "Deleted", count: 1 },
  ]);
});
