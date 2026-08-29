import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";

import { cleanupEvryPeoplePlanAttachments } from "./cleanup";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "30000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});

function stored(document: unknown): StoredEvryActionPlan {
  return {
    id: PLAN.planId,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    requestKey: "40000000-0000-4000-8000-000000000001" as never,
    intentFingerprint: "b".repeat(64),
    fingerprint: PLAN.fingerprint,
    document,
    createdAt: new Date("2026-08-29T08:00:00.000Z"),
    expiresAt: new Date("2026-08-29T08:30:00.000Z"),
    supersedesPlanId: null,
    status: "cancelled",
    stateVersion: 1,
    stateChangedAt: new Date("2026-08-29T08:01:00.000Z"),
  };
}

test("terminal cleanup reads only the exact scoped plan and closed People file fields", async () => {
  const removed: unknown[] = [];
  const loadCalls: unknown[] = [];
  const result = await cleanupEvryPeoplePlanAttachments({
    actor: ACTOR,
    plan: PLAN,
    loadPlan: async (input) => {
      loadCalls.push(input);
      return stored({
        steps: [
          {
            capabilityIdentity: "people.crm.people.upload-person-photo",
            arguments: {
              attachmentReference: "photo-reference",
              personId: "50000000-0000-4000-8000-000000000001",
            },
          },
          {
            capabilityIdentity: "people.crm.imports.execute-bulk-import",
            arguments: { attachmentReference: "csv-reference" },
          },
          {
            capabilityIdentity: "people.crm.assessments.create-commitment",
            arguments: {
              personId: "60000000-0000-4000-8000-000000000001",
              attachmentJson: JSON.stringify({
                reference: "commitment-reference",
              }),
            },
          },
          {
            capabilityIdentity: "people.crm.people.update-person",
            arguments: { attachmentReference: "must-not-be-selected" },
          },
        ],
      });
    },
    remove: async (input) => {
      removed.push(input);
      return true;
    },
    sweepPhotos: async (input) => {
      removed.push({ sweep: input });
      return { removed: 0, failed: 0 };
    },
    sweepCommitments: async (input) => {
      removed.push({ commitmentSweep: input });
      return { removed: 0, failed: 0 };
    },
  });

  assert.deepEqual(loadCalls, [
    {
      planId: PLAN.planId,
      actorUserId: ACTOR.userId,
      plantId: ACTOR.plantId,
      fingerprint: PLAN.fingerprint,
    },
  ]);
  assert.deepEqual(result, { removed: 3, failed: 0 });
  assert.deepEqual(removed, [
    {
      actor: ACTOR,
      reference: "photo-reference",
      expectedKind: "person_photo",
    },
    {
      sweep: {
        plantId: ACTOR.plantId,
        personId: "50000000-0000-4000-8000-000000000001",
      },
    },
    { actor: ACTOR, reference: "csv-reference", expectedKind: "people_csv" },
    {
      actor: ACTOR,
      reference: "commitment-reference",
      expectedKind: "commitment_document",
    },
    {
      commitmentSweep: {
        plantId: ACTOR.plantId,
        personId: "60000000-0000-4000-8000-000000000001",
      },
    },
  ]);
});

test("cleanup failure stays retryable and does not select malformed plan content", async () => {
  const result = await cleanupEvryPeoplePlanAttachments({
    actor: ACTOR,
    plan: PLAN,
    loadPlan: async () =>
      stored({
        steps: [
          {
            capabilityIdentity: "people.crm.people.upload-person-photo",
            arguments: {
              attachmentReference: "photo-reference",
              personId: "50000000-0000-4000-8000-000000000001",
            },
          },
          {
            capabilityIdentity: "people.crm.assessments.create-commitment",
            arguments: { attachmentJson: "not-json" },
          },
        ],
      }),
    remove: async () => {
      throw new Error("temporary object-store failure");
    },
    sweepPhotos: async () => ({ removed: 0, failed: 0 }),
    sweepCommitments: async () => ({ removed: 0, failed: 0 }),
  });

  assert.deepEqual(result, { removed: 0, failed: 1 });
});
