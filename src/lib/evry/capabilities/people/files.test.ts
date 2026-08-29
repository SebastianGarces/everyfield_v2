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
  const createRow = {
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
    disposition: "create" as const,
    targetPersonId: null,
    expectedTargetJson: null,
  };
  const mergeTargetId = "10000000-0000-4000-8000-000000000002";
  const mergeRow = {
    ...createRow,
    rowNumber: 3,
    rowKey: "d".repeat(64),
    personId: "10000000-0000-4000-8000-000000000003",
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    disposition: "merge" as const,
    targetPersonId: mergeTargetId,
    expectedTargetJson: JSON.stringify({
      firstName: "Grace",
      lastName: "Hopper",
      email: null,
      notes: "Existing",
    }),
  };
  const snapshot = [
    {
      rowNumber: 2,
      email: createRow.email,
      phone: createRow.phone,
      firstName: createRow.firstName,
      lastName: createRow.lastName,
      matchIds: [],
      disposition: "create",
      targetPersonId: null,
    },
    {
      rowNumber: 3,
      email: mergeRow.email,
      phone: mergeRow.phone,
      firstName: mergeRow.firstName,
      lastName: mergeRow.lastName,
      matchIds: [mergeTargetId],
      disposition: "merge",
      targetPersonId: mergeTargetId,
    },
    {
      rowNumber: 4,
      email: "skip@example.com",
      phone: null,
      firstName: "Skip",
      lastName: "Row",
      matchIds: ["10000000-0000-4000-8000-000000000004"],
      disposition: "skip",
      targetPersonId: null,
    },
  ];
  const argumentsValue = {
    attachmentReference: "first-party-signed-reference",
    attachmentDigest: DIGEST,
    originalName: "people.csv",
    previewFingerprint: "c".repeat(64),
    duplicateSnapshotJson: JSON.stringify(snapshot),
    rowsJson: JSON.stringify([createRow, mergeRow]),
    totalRows: 4,
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "bulk-import",
          capabilityIdentity: identity,
          arguments: argumentsValue,
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
    { label: "CSV rows", count: 4 },
    { label: "People to create", count: 1 },
    { label: "People to merge", count: 1 },
    { label: "Rows to skip", count: 1 },
    { label: "Invalid rows", count: 1 },
  ]);
  assert.deepEqual(review.confirmation.steps[0]?.exclusions, [
    { reason: "Duplicate rows explicitly marked skip", count: 1 },
    { reason: "Invalid CSV rows", count: 1 },
  ]);
  assert.deepEqual(
    review.confirmation.steps[0]?.resolvedTargets.map(({ label }) => label),
    ["New person", "Merge target"]
  );
  assert.deepEqual(
    review.confirmation.steps[0]?.beforeAfter.map(({ before, after }) => ({
      before,
      after,
    })),
    [
      {
        before: "No person",
        after: "Person created from the exact reviewed row",
      },
      {
        before: "Exact existing merge target shown below",
        after: "Existing person receives only the exact reviewed merge fields",
      },
    ]
  );
  const exactRowDocuments =
    review.confirmation.steps[0]!.contentPreviews.filter(({ label }) =>
      /^Row \d+ (create|merge) · page /.test(label)
    ).reduce<Record<string, string>>((documents, page) => {
      const rowNumber = page.label.split(" ")[1]!;
      documents[rowNumber] = (documents[rowNumber] ?? "") + page.content;
      return documents;
    }, {});
  assert.equal(JSON.parse(exactRowDocuments["2"]!).disposition, "create");
  assert.equal(JSON.parse(exactRowDocuments["3"]!).disposition, "merge");

  assert.throws(() =>
    parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "bulk-import",
            capabilityIdentity: identity,
            arguments: { ...argumentsValue, createCount: 2 },
            dependsOn: [],
          },
        ],
      },
      registry: PEOPLE_FILE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    })
  );
});

test("import plan validation refuses two merge rows targeting one person", () => {
  const identity = PEOPLE_FILE_IDENTITIES.import;
  const targetPersonId = "10000000-0000-4000-8000-000000000002";
  const baseRow = {
    rowNumber: 2,
    rowKey: "1".repeat(64),
    personId: "10000000-0000-4000-8000-000000000003",
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
    disposition: "merge",
    targetPersonId,
    expectedTargetJson: JSON.stringify({
      firstName: "Target",
      lastName: "Person",
    }),
  };
  const rows = [
    baseRow,
    {
      ...baseRow,
      rowNumber: 3,
      rowKey: "2".repeat(64),
      personId: "10000000-0000-4000-8000-000000000004",
      email: "ada+second@example.com",
    },
  ];
  const snapshot = rows.map((row) => ({
    rowNumber: row.rowNumber,
    email: row.email,
    phone: null,
    firstName: row.firstName,
    lastName: row.lastName,
    matchIds: [targetPersonId],
    disposition: "merge",
    targetPersonId,
  }));
  assert.throws(() =>
    parseEvryActionPlanCandidate({
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
              duplicateSnapshotJson: JSON.stringify(snapshot),
              rowsJson: JSON.stringify(rows),
              totalRows: 2,
            },
            dependsOn: [],
          },
        ],
      },
      registry: PEOPLE_FILE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    })
  );
});
