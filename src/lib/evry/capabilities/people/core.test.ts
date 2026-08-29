import assert from "node:assert/strict";
import { test } from "node:test";

import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import generated from "./inventory.generated.json";
import {
  PEOPLE_CORE_EXECUTIONS,
  PEOPLE_CORE_IDENTITIES,
  PEOPLE_CORE_PLAN_REGISTRY,
  PEOPLE_CORE_REVIEW_REGISTRY,
  selectPeopleCoreRequest,
} from "./core";

const PERSON_ID = "10000000-0000-4000-8000-000000000001";
const PLAN_ID = "20000000-0000-4000-8000-000000000001";

const PERSON = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
  status: "prospect",
  backgroundCheckStatus: "not_started",
  source: null,
  sourceDetails: null,
  notes: null,
  householdId: null,
  householdRole: null,
} as const;

test("People core selection is closed and serialization-stable", () => {
  const selections = [
    selectPeopleCoreRequest(
      "Create person: first=Ada; last=Lovelace; email=ada@example.com"
    ),
    selectPeopleCoreRequest("Quick add person: first=Ada; last=Lovelace"),
    selectPeopleCoreRequest("Update this person: phone=555-0100; city=London"),
    selectPeopleCoreRequest("Delete this person"),
    selectPeopleCoreRequest("Change this person's status to attendee"),
    selectPeopleCoreRequest(
      "Change this person's status to attendee: Background check complete"
    ),
    selectPeopleCoreRequest(`Reorder pipeline: ${PERSON_ID}`),
    selectPeopleCoreRequest("Remove this person's photo"),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(selections)), selections);
  assert.equal(selections.every(Boolean), true);
  assert.equal(
    selectPeopleCoreRequest("Create person: first=Ada; admin=true"),
    null
  );
  assert.equal(selectPeopleCoreRequest("Delete everyone"), null);
});

test("all eight core effects are exact generated production registrations", () => {
  const generatedEffects = new Set(
    generated.capabilities
      .filter(({ operationKind }) => operationKind === "effect")
      .map(({ identity }) => identity)
  );
  const identities = PEOPLE_CORE_EXECUTIONS.map(
    ({ planCapability }) => planCapability.identity
  );
  assert.deepEqual(
    identities.toSorted(),
    Object.values(PEOPLE_CORE_IDENTITIES).toSorted()
  );
  for (const identity of identities)
    assert.equal(generatedEffects.has(identity), true);
});

test("destructive person review binds the complete immutable baseline", () => {
  const identity = PEOPLE_CORE_IDENTITIES.delete;
  const argumentsValue = {
    personId: PERSON_ID,
    personLabel: "Ada Lovelace",
    baselineJson: JSON.stringify(PERSON),
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "delete-person",
          capabilityIdentity: identity,
          arguments: argumentsValue,
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_CORE_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: PLAN_ID,
      fingerprint: "a".repeat(64),
    }),
    document,
    reviewRegistry: PEOPLE_CORE_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.equal(review.confirmation.steps[0]?.effectKind, "destructive");
  assert.equal(review.confirmation.steps[0]?.reversibility, "reversible");
  assert.deepEqual(review.confirmation.steps[0]?.counts, [
    { label: "People to delete", count: 1 },
  ]);
  assert.deepEqual(review.confirmation.steps[0]?.beforeAfter, [
    { label: "Visibility", before: "Active", after: "Deleted", count: 1 },
  ]);

  assert.throws(() =>
    parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "delete-person",
            capabilityIdentity: identity,
            arguments: {
              ...argumentsValue,
              baselineJson: JSON.stringify({ ...PERSON, churchId: PLAN_ID }),
            },
            dependsOn: [],
          },
        ],
      },
      registry: PEOPLE_CORE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    })
  );
});
