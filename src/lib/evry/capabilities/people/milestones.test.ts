import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import generated from "./inventory.generated.json";
import {
  MILESTONE_EXECUTIONS,
  MILESTONE_IDENTITIES,
  MILESTONE_PLAN_REGISTRY,
  selectMilestoneRequest,
} from "./milestones";

const PERSON_ID = "10000000-0000-4000-8000-000000000001";

test("milestone selection is closed and serialization-stable", () => {
  const selections = [
    selectMilestoneRequest(
      "Record assessment: date=2026-08-29; committed=5; compelled=4; contagious=3; courageous=5"
    ),
    selectMilestoneRequest(
      "Record interview: date=2026-08-29; maturity=pass; gifted=pass; chemistry=concern; rightReasons=pass; season=pass; result=qualified_with_notes; next=Follow up"
    ),
    selectMilestoneRequest(
      `Record commitment: date=2026-08-29; type=core_group; witness=${PERSON_ID}; notes=Signed`
    ),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(selections)), selections);
  assert.equal(selections.every(Boolean), true);
  assert.equal(
    selectMilestoneRequest(
      "Record assessment: date=2026-08-29; committed=5; sql=drop"
    ),
    null
  );
});

test("all three milestone effects are exact generated production registrations", () => {
  const generatedEffects = new Set(
    generated.capabilities
      .filter(({ operationKind }) => operationKind === "effect")
      .map(({ identity }) => identity)
  );
  const identities = MILESTONE_EXECUTIONS.map(
    ({ planCapability }) => planCapability.identity
  );
  assert.deepEqual(
    identities.toSorted(),
    Object.values(MILESTONE_IDENTITIES).toSorted()
  );
  for (const identity of identities)
    assert.equal(generatedEffects.has(identity), true);
});

test("commitment plan requires exact witness identity and label pairing", () => {
  const identity = MILESTONE_IDENTITIES.commitment;
  const candidate = {
    personId: PERSON_ID,
    personLabel: "Ada Lovelace",
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    expectedStatus: "interviewed",
    commitmentType: "core_group",
    signedDate: "2026-08-29",
    witnessJson: JSON.stringify({ id: PERSON_ID, label: "Grace Hopper" }),
    notes: null,
    attachmentJson: "null",
    resultingStatus: "core_group",
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "commitment",
          capabilityIdentity: identity,
          arguments: candidate,
          dependsOn: [],
        },
      ],
    },
    registry: MILESTONE_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  assert.deepEqual(document.steps[0]?.arguments, candidate);
  assert.throws(() =>
    parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "commitment",
            capabilityIdentity: identity,
            arguments: {
              ...candidate,
              witnessJson: JSON.stringify({
                id: PERSON_ID,
                label: "Grace Hopper",
                plantId: PERSON_ID,
              }),
            },
            dependsOn: [],
          },
        ],
      },
      registry: MILESTONE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    })
  );
});
