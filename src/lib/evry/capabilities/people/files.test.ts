import assert from "node:assert/strict";
import { test } from "node:test";

import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import generated from "./inventory.generated.json";
import {
  PEOPLE_FILE_EXECUTIONS,
  PEOPLE_FILE_IDENTITIES,
  PEOPLE_FILE_PLAN_REGISTRY,
  PEOPLE_FILE_REVIEW_REGISTRY,
} from "./files";

const PERSON_ID = "10000000-0000-4000-8000-000000000001";
const PLAN_ID = "20000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

test("both file effects are exact generated production registrations", () => {
  const generatedEffects = new Set(
    generated.capabilities
      .filter(({ operationKind }) => operationKind === "effect")
      .map(({ identity }) => identity)
  );
  const identities = PEOPLE_FILE_EXECUTIONS.map(
    ({ planCapability }) => planCapability.identity
  );
  assert.deepEqual(
    identities.toSorted(),
    Object.values(PEOPLE_FILE_IDENTITIES).toSorted()
  );
  for (const identity of identities)
    assert.equal(generatedEffects.has(identity), true);
});

test("photo plan binds exact private reference metadata and rejects generic URLs", () => {
  const identity = PEOPLE_FILE_IDENTITIES.photo;
  const candidate = {
    personId: PERSON_ID,
    personLabel: "Ada Lovelace",
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    currentPhotoDigest: null,
    attachmentReference: "first-party-signed-reference",
    attachmentDigest: DIGEST,
    contentType: "image/png",
    size: 3,
    originalName: "ada.png",
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "upload-photo",
          capabilityIdentity: identity,
          arguments: candidate,
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_FILE_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  assert.deepEqual(document.steps[0]?.arguments, candidate);
  assert.throws(() =>
    parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "upload-photo",
            capabilityIdentity: identity,
            arguments: { ...candidate, url: "https://example.com/ada.png" },
            dependsOn: [],
          },
        ],
      },
      registry: PEOPLE_FILE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    })
  );
});

test("import review discloses every exact row, exclusion, and file fingerprint", () => {
  const identity = PEOPLE_FILE_IDENTITIES.import;
  const row = {
    rowNumber: 2,
    rowKey: "b".repeat(64),
    personId: PERSON_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: null,
    source: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: "US",
    notes: null,
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "bulk-import",
          capabilityIdentity: identity,
          arguments: {
            attachmentReference: "first-party-signed-reference",
            attachmentDigest: DIGEST,
            originalName: "people.csv",
            previewFingerprint: "c".repeat(64),
            rowsJson: JSON.stringify([row]),
            totalRows: 3,
            createCount: 1,
            skipCount: 1,
            invalidCount: 1,
          },
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_FILE_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: PLAN_ID,
      fingerprint: DIGEST,
    }),
    document,
    reviewRegistry: PEOPLE_FILE_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.equal(review.confirmation.steps[0]?.effectKind, "file_import");
  assert.deepEqual(review.confirmation.steps[0]?.counts, [
    { label: "CSV rows", count: 3 },
    { label: "People to create", count: 1 },
    { label: "Rows to skip", count: 1 },
    { label: "Invalid rows", count: 1 },
  ]);
  assert.deepEqual(review.confirmation.steps[0]?.exclusions, [
    { reason: "Duplicate rows explicitly marked skip", count: 1 },
    { reason: "Invalid CSV rows", count: 1 },
  ]);
  assert.equal(review.confirmation.steps[0]?.beforeAfter.length, 1);
});
