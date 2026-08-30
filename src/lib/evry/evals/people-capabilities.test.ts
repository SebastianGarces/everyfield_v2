import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { PEOPLE_CORE_REVIEWS } from "@/lib/evry/capabilities/people/core";
import { PEOPLE_FILE_REVIEWS } from "@/lib/evry/capabilities/people/files";
import { HOUSEHOLD_REVIEWS } from "@/lib/evry/capabilities/people/households";
import generated from "@/lib/evry/capabilities/people/inventory.generated.json";
import { MILESTONE_REVIEWS } from "@/lib/evry/capabilities/people/milestones";
import { PEOPLE_EVRY_REVIEWS } from "@/lib/evry/capabilities/people/runtime";
import { TAXONOMY_REVIEWS } from "@/lib/evry/capabilities/people/taxonomies";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_READ_REGISTRATIONS,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
  productionEvryPlanTargetIsCurrent,
} from "@/lib/evry/capabilities/production";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import { EVRY_CAPABILITY_EVAL_LAYERS } from "./contracts";
import {
  assertPeopleCapabilityEvalRegistryComplete,
  PEOPLE_CAPABILITY_EVAL_FIXTURES,
} from "./people-capabilities";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;

const UUID = "30000000-0000-4000-8000-000000000001";
const PERSON = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: null,
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
};
const MEMBER = {
  personId: UUID,
  firstName: "Ada",
  lastName: "Lovelace",
  householdId: null,
  householdRole: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
};
const HOUSEHOLD = {
  name: "Lovelace",
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
};
const IMPORT_ROW = {
  rowNumber: 2,
  rowKey: "b".repeat(64),
  personId: UUID,
  firstName: "Ada",
  lastName: "Lovelace",
  email: null,
  phone: null,
  source: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
  notes: null,
  disposition: "create",
  targetPersonId: null,
  expectedTargetJson: null,
};

function jsonSchemaSample(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.anyOf)) {
    for (const option of schema.anyOf) {
      const value = jsonSchemaSample(option as Record<string, unknown>);
      if (value !== undefined) return value;
    }
  }
  switch (schema.type) {
    case "string":
      return "value";
    case "number":
    case "integer":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "array": {
      const minimum = typeof schema.minItems === "number" ? schema.minItems : 0;
      return Array.from({ length: minimum }, () =>
        jsonSchemaSample((schema.items ?? {}) as Record<string, unknown>)
      );
    }
    case "object": {
      const properties = (schema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const required = new Set(
        Array.isArray(schema.required) ? schema.required : []
      );
      return Object.fromEntries(
        Object.entries(properties)
          .filter(([key]) => required.has(key))
          .map(([key, value]) => [key, jsonSchemaSample(value)])
      );
    }
    default:
      return undefined;
  }
}

function argumentSample(name: string, schema: z.core.$ZodType): unknown {
  const special: Record<string, unknown> = {
    activitySource: "form",
    afterAddressJson: JSON.stringify({ ...HOUSEHOLD, name: undefined }),
    attachmentDigest: "a".repeat(64),
    attachmentJson: JSON.stringify(null),
    attachmentReference: "signed-reference",
    baselineJson: JSON.stringify(PERSON),
    beforeJson: JSON.stringify(HOUSEHOLD),
    contentType: "image/jpeg",
    createCount: 1,
    currentPhotoDigest: null,
    duplicateSnapshotJson: JSON.stringify([
      {
        rowNumber: 2,
        email: null,
        phone: null,
        firstName: "Ada",
        lastName: "Lovelace",
        matchIds: [],
        disposition: "create",
        targetPersonId: null,
      },
    ]),
    editedAt: "2026-08-29T12:00:00.000Z",
    entries: [
      {
        personId: UUID,
        personLabel: "Ada Lovelace",
        expectedStatus: "prospect",
        expectedOrder: 0,
        newOrder: 1,
      },
    ],
    expectedMemberIds: [],
    expectedMetadataJson: JSON.stringify({ note: "Existing note" }),
    expectedPersonIds: [],
    householdJson: JSON.stringify(HOUSEHOLD),
    membersJson: JSON.stringify([MEMBER]),
    mergeCount: 0,
    personJson: JSON.stringify(PERSON),
    photoDigest: "a".repeat(64),
    previewFingerprint: "a".repeat(64),
    rowsJson: JSON.stringify([IMPORT_ROW]),
    skipCount: 0,
    skippedStatuses: [],
    totalRows: 1,
    invalidCount: 0,
    witnessJson: JSON.stringify(null),
  };
  const jsonCandidates = [
    PERSON,
    MEMBER,
    HOUSEHOLD,
    { ...HOUSEHOLD, name: undefined },
    [MEMBER],
    null,
    { note: "Existing note" },
    [IMPORT_ROW],
  ].map((value) => JSON.stringify(value));
  const generated = jsonSchemaSample(
    z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<
      string,
      unknown
    >
  );
  const candidates = [
    special[name],
    generated,
    null,
    UUID,
    "2026-08-29",
    "2026-08-29T12:00:00.000Z",
    "a".repeat(64),
    "Ada Lovelace",
    "blue",
    "prospect",
    "attendee",
    "interviewed",
    "core_group",
    "pass",
    "qualified",
    "application/pdf",
    1,
    0,
    false,
    [],
    ...jsonCandidates,
  ];
  for (const candidate of candidates) {
    const parsed = z.safeParse(schema, candidate);
    if (parsed.success) return parsed.data;
  }
  throw new Error(`No executed People eval argument fixture for ${name}`);
}

function validArgumentsFor(identity: string): Record<string, unknown> {
  const plan = PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity);
  assert.ok(plan);
  const shape = (plan.argumentsSchema as z.ZodObject<z.ZodRawShape>).shape;
  const candidate = Object.fromEntries(
    Object.entries(shape).map(([name, schema]) => [
      name,
      argumentSample(name, schema),
    ])
  );
  return plan.argumentsSchema.parse(candidate) as Record<string, unknown>;
}

function plannedEffect(
  identity: string,
  argumentsValue: Record<string, unknown>
) {
  return parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "people-eval-step",
          capabilityIdentity: identity,
          arguments: argumentsValue,
          dependsOn: [],
        },
      ],
    },
    registry: PRODUCTION_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
}

const reviewIdentities = [
  ...PEOPLE_EVRY_REVIEWS,
  ...PEOPLE_CORE_REVIEWS,
  ...TAXONOMY_REVIEWS,
  ...HOUSEHOLD_REVIEWS,
  ...MILESTONE_REVIEWS,
  ...PEOPLE_FILE_REVIEWS,
].flatMap((review) =>
  review.source.kind === "generic"
    ? review.source.capabilityIdentities
    : [review.source.identity]
);

test("People eval fixtures are exactly generated and reject an incomplete registry", () => {
  assert.doesNotThrow(() => assertPeopleCapabilityEvalRegistryComplete());
  assert.equal(PEOPLE_CAPABILITY_EVAL_FIXTURES.length, 52);
  assert.throws(() =>
    assertPeopleCapabilityEvalRegistryComplete(
      PEOPLE_CAPABILITY_EVAL_FIXTURES.slice(1)
    )
  );
  const [first, ...rest] = PEOPLE_CAPABILITY_EVAL_FIXTURES;
  assert.ok(first);
  assert.throws(() =>
    assertPeopleCapabilityEvalRegistryComplete([
      {
        ...first,
        cases: { ...first.cases, selection: [] },
      },
      ...rest,
    ])
  );
});

for (const capability of generated.capabilities) {
  const identity = capability.identity;
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    test(`${identity}:${layer}`, async () => {
      const authority = evryCapabilityRegistrationFor(identity);
      const execution =
        PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
      const plan = PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity);
      const reads = PRODUCTION_EVRY_READ_REGISTRATIONS.filter(
        (read) => read.capabilityIdentity === identity
      );
      const reviews = reviewIdentities.filter((value) => value === identity);
      const argumentsValue = execution ? validArgumentsFor(identity) : null;
      const document = argumentsValue
        ? plannedEffect(identity, argumentsValue)
        : null;

      assert.ok(authority);
      switch (layer) {
        case "policy":
          assert.equal(authority.parityCapability, "people");
          assert.equal(authority.operationKind, capability.operationKind);
          assert.deepEqual(
            [...authority.surfaceIdentities],
            capability.surfaceIdentities
          );
          break;
        case "selection":
          assert.equal(
            reads.length,
            capability.operationKind === "read" ? 1 : 0
          );
          assert.equal(
            Boolean(execution),
            capability.operationKind === "effect"
          );
          if (execution) {
            assert.equal(document?.steps[0]?.capabilityIdentity, identity);
          }
          break;
        case "arguments":
          if (plan) {
            assert.ok(argumentsValue);
            assert.equal(
              plan.argumentsSchema.safeParse(argumentsValue).success,
              true
            );
            assert.equal(
              plan.argumentsSchema.safeParse({
                ...argumentsValue,
                unexpected: true,
              }).success,
              false
            );
          } else {
            assert.equal(
              await reads[0]?.execute(
                { literalUserText: "", pageContext: null },
                { unexpected: true }
              ),
              null
            );
          }
          break;
        case "tenancy":
          assert.deepEqual(
            [...authority.surfaceIdentities],
            capability.surfaceIdentities
          );
          assert.ok(
            capability.surfaceIdentities.every((surface) => {
              const entry = generated.entries.find(
                ({ identity: entryIdentity }) => entryIdentity === surface
              );
              return (
                entry?.classification.state === "supported" &&
                entry.capabilityIdentity === identity
              );
            })
          );
          break;
        case "permission":
          assert.equal(
            authority.applicationCapability,
            capability.applicationCapability
          );
          break;
        case "confirmation":
          assert.equal(Boolean(plan), capability.confirmation === "required");
          assert.equal(
            reviews.length,
            capability.operationKind === "effect" ? 1 : 0
          );
          if (document) {
            const review = trustedReviewForEvryPlanDocument({
              plan: {
                planId: "40000000-0000-4000-8000-000000000001",
                fingerprint: "b".repeat(64) as never,
              },
              document,
              reviewRegistry: PRODUCTION_EVRY_REVIEW_REGISTRY,
            });
            assert.ok(review);
            assert.equal(review.confirmation.steps.length, 1);
            assert.equal(
              review.confirmation.steps[0]?.stepId,
              "people-eval-step"
            );
          }
          break;
        case "execution":
          if (execution && argumentsValue) {
            assert.equal(execution.planCapability.identity, identity);
            const fixture = PEOPLE_CAPABILITY_EVAL_FIXTURES.find(
              ({ capabilityIdentity }) => capabilityIdentity === identity
            );
            assert.ok(
              fixture?.cases.execution.some(
                ({ proofId, testName }) =>
                  proofId === "people-capability-live-outcomes" &&
                  testName === `${identity}:production-live-outcome`
              )
            );
          } else {
            assert.equal(
              await reads[0]?.execute(
                { literalUserText: "", pageContext: null },
                { unexpected: true }
              ),
              null
            );
          }
          break;
        case "idempotency":
          if (execution && argumentsValue) {
            assert.equal(
              execution.planCapability,
              PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity)
            );
            const fixture = PEOPLE_CAPABILITY_EVAL_FIXTURES.find(
              ({ capabilityIdentity }) => capabilityIdentity === identity
            );
            assert.ok(
              fixture?.cases.idempotency.some(
                ({ proofId, testName }) =>
                  proofId === "people-capability-live-outcomes" &&
                  testName === `${identity}:production-live-outcome`
              )
            );
          } else {
            const first = await reads[0]?.execute(
              { literalUserText: "", pageContext: null },
              { unexpected: true }
            );
            const replay = await reads[0]?.execute(
              { literalUserText: "", pageContext: null },
              { unexpected: true }
            );
            assert.equal(first, null);
            assert.equal(replay, null);
          }
          break;
        case "errors":
          if (plan && argumentsValue) {
            assert.equal(
              await productionEvryPlanTargetIsCurrent({
                actor: ACTOR,
                step: {
                  id: "invalid",
                  capabilityIdentity: identity,
                  effectClass: plan.effectClass,
                  arguments: {},
                  dependsOn: [],
                },
              }),
              false
            );
            const fixture = PEOPLE_CAPABILITY_EVAL_FIXTURES.find(
              ({ capabilityIdentity }) => capabilityIdentity === identity
            );
            assert.ok(
              fixture?.cases.errors.some(
                ({ proofId, testName }) =>
                  proofId === "people-capability-live-outcomes" &&
                  testName === `${identity}:production-live-outcome`
              )
            );
          } else {
            assert.equal(
              await reads[0]?.execute(
                { literalUserText: "", pageContext: null },
                { unexpected: true }
              ),
              null
            );
          }
          break;
        case "ui_artifact":
          assert.equal(
            reviews.length,
            capability.operationKind === "effect" ? 1 : 0
          );
          assert.equal(
            reads.length,
            capability.operationKind === "read" ? 1 : 0
          );
          if (document) {
            const review = trustedReviewForEvryPlanDocument({
              plan: {
                planId: "40000000-0000-4000-8000-000000000001",
                fingerprint: "b".repeat(64) as never,
              },
              document,
              reviewRegistry: PRODUCTION_EVRY_REVIEW_REGISTRY,
            });
            assert.ok(review?.confirmation.title);
            assert.ok(review?.confirmation.actionLabel);
          }
          break;
      }
    });
  }
}
