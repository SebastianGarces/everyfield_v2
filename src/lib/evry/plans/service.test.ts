import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
} from "./fingerprint";
import { validateStoredEvryActionPlan } from "./integrity";
import {
  createEvryPlanCapabilityRegistry,
  defineEvryPlanCapability,
} from "./registry";
import type { StoredEvryActionPlan } from "./repository";
import { mintEvryPlanRequestKey } from "./request-key";
import type { EvryActionPlanDocument } from "./schema";

const ACTOR_ID = "20000000-0000-4000-8000-000000000001";
const PLANT_ID = "30000000-0000-4000-8000-000000000001";
const EXPIRES_AT = new Date("2026-08-28T12:15:00.000Z");
const registry = createEvryPlanCapabilityRegistry([
  defineEvryPlanCapability({
    identity: "fixture:normalized",
    effectClass: "database_write",
    arguments: {
      label: z.string().transform((value) => value.trim()),
      retries: z.number().int().default(1),
    },
  }),
]);

function stored(document: EvryActionPlanDocument): StoredEvryActionPlan {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    actorUserId: ACTOR_ID,
    plantId: PLANT_ID,
    requestKey: mintEvryPlanRequestKey(),
    intentFingerprint: fingerprintEvryActionPlanIntent({
      actorUserId: ACTOR_ID,
      plantId: PLANT_ID,
      document,
    }),
    document,
    fingerprint: fingerprintEvryActionPlan({
      actorUserId: ACTOR_ID,
      plantId: PLANT_ID,
      expiresAt: EXPIRES_AT,
      document,
    }),
    createdAt: new Date("2026-08-28T12:00:00.000Z"),
    expiresAt: EXPIRES_AT,
    supersedesPlanId: null,
    status: "awaiting_confirmation",
    stateVersion: 0,
    stateChangedAt: new Date("2026-08-28T12:00:00.000Z"),
  };
}

test("a noncanonical stored argument cannot preserve its own fingerprint", () => {
  const noncanonical = {
    version: 1,
    steps: [
      {
        id: "normalized",
        capabilityIdentity: "fixture:normalized",
        effectClass: "database_write",
        arguments: { label: "  lasting effect  " },
        dependsOn: [],
      },
    ],
  } as unknown as EvryActionPlanDocument;

  assert.equal(
    validateStoredEvryActionPlan(stored(noncanonical), registry),
    false
  );
});

test("canonical parser output retains its exact fingerprint", () => {
  const canonical = {
    version: 1,
    steps: [
      {
        id: "normalized",
        capabilityIdentity: "fixture:normalized",
        effectClass: "database_write",
        arguments: { label: "lasting effect", retries: 1 },
        dependsOn: [],
      },
    ],
  } as const satisfies EvryActionPlanDocument;

  assert.equal(validateStoredEvryActionPlan(stored(canonical), registry), true);
});
