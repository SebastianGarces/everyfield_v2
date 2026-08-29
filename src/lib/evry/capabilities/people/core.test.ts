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

function coreReview(input: {
  identity: string;
  stepId: string;
  argumentsValue: Record<string, unknown>;
}) {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: input.stepId,
          capabilityIdentity: input.identity,
          arguments: input.argumentsValue,
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_CORE_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: input.identity }],
  });
  return trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: PLAN_ID,
      fingerprint: "c".repeat(64),
    }),
    document,
    reviewRegistry: PEOPLE_CORE_REVIEW_REGISTRY,
  });
}

function disclosedNotes(
  review: NonNullable<ReturnType<typeof coreReview>>,
  phase: "before" | "after"
) {
  return review.confirmation.steps[0]!.contentPreviews.filter(({ label }) =>
    label.startsWith(`Notes ${phase} · page `)
  )
    .map(({ content }) => content)
    .join("");
}

test("create and update disclose every legal 20k note character losslessly in bounded pages", () => {
  const beforeNotes = `  ${"b".repeat(3_997)}😀${"b".repeat(15_997)}  `;
  const afterNotes = `\n${"a".repeat(3_998)}😀${"a".repeat(15_998)}\t`;
  assert.equal(beforeNotes.length, 20_000);
  assert.equal(afterNotes.length, 20_000);

  const created = coreReview({
    identity: PEOPLE_CORE_IDENTITIES.create,
    stepId: "create-person",
    argumentsValue: {
      personJson: JSON.stringify({ ...PERSON, notes: afterNotes }),
      activitySource: "form",
      expectedHouseholdName: null,
    },
  });
  assert.ok(created);
  assert.equal(disclosedNotes(created, "after"), afterNotes);
  assert.equal(
    created.confirmation.steps[0]?.contentPreviews.every(
      ({ content }) => content.length <= 4_000
    ),
    true
  );

  const updated = coreReview({
    identity: PEOPLE_CORE_IDENTITIES.update,
    stepId: "update-person",
    argumentsValue: {
      personId: PERSON_ID,
      personLabel: "Ada Lovelace",
      baselineJson: JSON.stringify({ ...PERSON, notes: beforeNotes }),
      afterJson: JSON.stringify({ ...PERSON, notes: afterNotes }),
    },
  });
  assert.ok(updated);
  assert.equal(disclosedNotes(updated, "before"), beforeNotes);
  assert.equal(disclosedNotes(updated, "after"), afterNotes);
  assert.equal(updated.confirmation.steps[0]?.contentPreviews.length, 12);
  assert.equal(
    updated.confirmation.steps[0]?.contentPreviews.every(({ content }) => {
      const first = content.charCodeAt(0);
      const last = content.charCodeAt(content.length - 1);
      return (
        !(first >= 0xdc00 && first <= 0xdfff) &&
        !(last >= 0xd800 && last <= 0xdbff)
      );
    }),
    true
  );

  const oversizedCluster = `a${"\u0301".repeat(5_000)}`;
  const clustered = coreReview({
    identity: PEOPLE_CORE_IDENTITIES.create,
    stepId: "create-person-with-clustered-note",
    argumentsValue: {
      personJson: JSON.stringify({ ...PERSON, notes: oversizedCluster }),
      activitySource: "form",
      expectedHouseholdName: null,
    },
  });
  assert.ok(clustered);
  const clusteredPages =
    clustered.confirmation.steps[0]!.contentPreviews.filter(({ label }) =>
      label.startsWith("Notes after · page ")
    );
  assert.deepEqual(
    clusteredPages.map(({ content }) => content),
    [oversizedCluster]
  );
  assert.equal(clusteredPages[0]!.content.length > 4_000, true);
  assert.equal(clusteredPages[0]!.content.length <= 40_000, true);
});
