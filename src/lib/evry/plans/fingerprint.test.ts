import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalEvryPlanJson,
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
} from "./fingerprint";
import {
  ELIGIBLE_FIXTURE_CAPABILITIES,
  FIXTURE_IDS,
  fixtureCandidate,
  fixtureDocument,
  PLAN_FIXTURE_REGISTRY,
  SEND_IDENTITY,
} from "./fixtures.test-helper";
import { parseEvryActionPlanCandidate } from "./schema";

const ACTOR = "40000000-0000-4000-8000-000000000001";
const PLANT = "50000000-0000-4000-8000-000000000001";
const EXPIRES = new Date("2026-09-01T12:15:00.000Z");

function fingerprint(candidate: unknown): string {
  return fingerprintEvryActionPlan({
    actorUserId: ACTOR,
    plantId: PLANT,
    expiresAt: EXPIRES,
    document: parseEvryActionPlanCandidate({
      candidate,
      registry: PLAN_FIXTURE_REGISTRY,
      eligibleCapabilities: ELIGIBLE_FIXTURE_CAPABILITIES,
    }),
  });
}

function mutableCandidate() {
  return structuredClone(fixtureCandidate()) as {
    steps: Array<{
      id: string;
      capabilityIdentity: string;
      arguments: Record<string, unknown>;
      dependsOn: string[];
    }>;
  };
}

test("canonical JSON ignores object insertion order", () => {
  const document = fixtureDocument();
  const first = canonicalEvryPlanJson({
    actorUserId: ACTOR,
    plantId: PLANT,
    expiresAt: EXPIRES,
    document,
  });
  const second = canonicalEvryPlanJson({
    document,
    expiresAt: EXPIRES,
    plantId: PLANT,
    actorUserId: ACTOR,
  });

  assert.equal(first, second);
  assert.match(fingerprint(fixtureCandidate()), /^[0-9a-f]{64}$/);
});

test("every material plan edit produces a different fingerprint", () => {
  const original = fingerprint(fixtureCandidate());
  const mutations: Array<readonly [string, () => unknown]> = [
    [
      "date",
      () => {
        const value = mutableCandidate();
        value.steps[0].arguments.startsAt = "2026-09-03T14:00:00-04:00";
        return value;
      },
    ],
    [
      "target",
      () => {
        const value = mutableCandidate();
        value.steps[0].arguments.targetId =
          "10000000-0000-4000-8000-000000000002";
        return value;
      },
    ],
    [
      "recipient",
      () => {
        const value = mutableCandidate();
        value.steps[1].arguments.recipientIds = [FIXTURE_IDS.recipientTwo];
        return value;
      },
    ],
    [
      "body",
      () => {
        const value = mutableCandidate();
        value.steps[1].arguments.body = "The body changed.";
        return value;
      },
    ],
    [
      "argument",
      () => {
        const value = mutableCandidate();
        value.steps[0].arguments.reminderDays = 3;
        return value;
      },
    ],
    [
      "step",
      () => {
        const value = mutableCandidate();
        value.steps.push({
          id: "send-second",
          capabilityIdentity: SEND_IDENTITY,
          arguments: {
            recipientIds: [FIXTURE_IDS.recipientTwo],
            subject: "Second note",
            body: "A second exact effect.",
          },
          dependsOn: ["send-invitation"],
        });
        return value;
      },
    ],
    [
      "dependency",
      () => {
        const value = mutableCandidate();
        value.steps[1].dependsOn = [];
        return value;
      },
    ],
  ];

  for (const [label, mutate] of mutations) {
    assert.notEqual(fingerprint(mutate()), original, label);
  }
});

test("actor, plant, and expiration are part of the approval identity", () => {
  const document = fixtureDocument();
  const original = fingerprintEvryActionPlan({
    actorUserId: ACTOR,
    plantId: PLANT,
    expiresAt: EXPIRES,
    document,
  });

  assert.notEqual(
    fingerprintEvryActionPlan({
      actorUserId: "40000000-0000-4000-8000-000000000002",
      plantId: PLANT,
      expiresAt: EXPIRES,
      document,
    }),
    original
  );
  assert.notEqual(
    fingerprintEvryActionPlan({
      actorUserId: ACTOR,
      plantId: "50000000-0000-4000-8000-000000000002",
      expiresAt: EXPIRES,
      document,
    }),
    original
  );
  assert.notEqual(
    fingerprintEvryActionPlan({
      actorUserId: ACTOR,
      plantId: PLANT,
      expiresAt: new Date(EXPIRES.getTime() + 1),
      document,
    }),
    original
  );
});

test("intent identity is stable across clocks but exact across scope and bytes", () => {
  const document = fixtureDocument();
  const original = fingerprintEvryActionPlanIntent({
    actorUserId: ACTOR,
    plantId: PLANT,
    document,
  });

  assert.match(original, /^[0-9a-f]{64}$/);
  assert.equal(
    fingerprintEvryActionPlanIntent({
      actorUserId: ACTOR,
      plantId: PLANT,
      document,
    }),
    original
  );
  assert.notEqual(
    fingerprintEvryActionPlanIntent({
      actorUserId: `${ACTOR.slice(0, -1)}2`,
      plantId: PLANT,
      document,
    }),
    original
  );
  assert.notEqual(
    fingerprintEvryActionPlanIntent({
      actorUserId: ACTOR,
      plantId: PLANT,
      document: parseEvryActionPlanCandidate({
        candidate: (() => {
          const changed = mutableCandidate();
          changed.steps[1].arguments.body = "A later intentional plan.";
          return changed;
        })(),
        registry: PLAN_FIXTURE_REGISTRY,
        eligibleCapabilities: ELIGIBLE_FIXTURE_CAPABILITIES,
      }),
    }),
    original
  );
});
