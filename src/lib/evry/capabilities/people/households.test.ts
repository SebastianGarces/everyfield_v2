import assert from "node:assert/strict";
import { test } from "node:test";

import generated from "./inventory.generated.json";
import {
  HOUSEHOLD_EXECUTIONS,
  HOUSEHOLD_IDENTITIES,
  HOUSEHOLD_PLAN_REGISTRY,
  selectHouseholdRequest,
} from "./households";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";

test("household selection is closed and serialization-stable", () => {
  const selections = [
    selectHouseholdRequest(
      "Create household: name=Lovelace; usePersonAddress=true"
    ),
    selectHouseholdRequest(
      `Update household ${HOUSEHOLD_ID}: name=Byron; city=London`
    ),
    selectHouseholdRequest(`Delete household ${HOUSEHOLD_ID}`),
    selectHouseholdRequest(
      `Add this person to household ${HOUSEHOLD_ID} as spouse`
    ),
    selectHouseholdRequest("Remove this person from household"),
    selectHouseholdRequest(`Propagate address for household ${HOUSEHOLD_ID}`),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(selections)), selections);
  assert.equal(selections.every(Boolean), true);
  assert.equal(
    selectHouseholdRequest(`Delete household ${HOUSEHOLD_ID}; force=true`),
    null
  );
});

test("all six household effects are exact generated production registrations", () => {
  const generatedEffects = new Set(
    generated.capabilities
      .filter(({ operationKind }) => operationKind === "effect")
      .map(({ identity }) => identity)
  );
  const identities = HOUSEHOLD_EXECUTIONS.map(
    ({ planCapability }) => planCapability.identity
  );
  assert.deepEqual(
    identities.toSorted(),
    Object.values(HOUSEHOLD_IDENTITIES).toSorted()
  );
  for (const identity of identities)
    assert.equal(generatedEffects.has(identity), true);
});

test("propagation arguments bind the exact full member roster", () => {
  const identity = HOUSEHOLD_IDENTITIES.propagate;
  const household = {
    name: "Lovelace",
    addressLine1: "1 Main St",
    addressLine2: null,
    city: "London",
    state: null,
    postalCode: null,
    country: "GB",
  };
  const member = {
    personId: HOUSEHOLD_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    householdId: HOUSEHOLD_ID,
    householdRole: "head",
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: "US",
  };
  const argumentsValue = {
    householdId: HOUSEHOLD_ID,
    householdJson: JSON.stringify(household),
    membersJson: JSON.stringify([member]),
  };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "propagate",
          capabilityIdentity: identity,
          arguments: argumentsValue,
          dependsOn: [],
        },
      ],
    },
    registry: HOUSEHOLD_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  assert.deepEqual(document.steps[0]?.arguments, argumentsValue);
  assert.throws(() =>
    parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "propagate",
            capabilityIdentity: identity,
            arguments: {
              ...argumentsValue,
              membersJson: JSON.stringify([
                { ...member, plantId: HOUSEHOLD_ID },
              ]),
            },
            dependsOn: [],
          },
        ],
      },
      registry: HOUSEHOLD_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    })
  );
});
