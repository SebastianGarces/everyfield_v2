import assert from "node:assert/strict";
import { test } from "node:test";

import generated from "./inventory.generated.json";
import {
  PEOPLE_DOMAIN_READ_REGISTRATIONS,
  PEOPLE_READ_IDENTITIES,
  selectPeopleRead,
} from "./reads";

const PERSON_ID = "10000000-0000-4000-8000-000000000001";

test("People domain read selectors are closed and serialization-stable", () => {
  const selected = [
    selectPeopleRead("Show this person"),
    selectPeopleRead(`Load more people after ${PERSON_ID}`),
    selectPeopleRead("Show the people pipeline"),
    selectPeopleRead("List households"),
    selectPeopleRead(`Show household ${PERSON_ID} members`),
    selectPeopleRead("Show this person's assessments"),
    selectPeopleRead(
      "Check duplicates: ada@example.com; Ada; Lovelace; 5550100"
    ),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), selected);
  assert.deepEqual(selected, [
    { kind: "person" },
    { kind: "more_people", cursor: PERSON_ID },
    { kind: "pipeline" },
    { kind: "households" },
    { kind: "household_members", householdId: PERSON_ID },
    { kind: "person_assessments" },
    {
      kind: "duplicates",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "5550100",
    },
  ]);
  assert.equal(selectPeopleRead("Fetch https://example.com"), null);
  assert.equal(selectPeopleRead("Run people read with arbitrary JSON"), null);
  assert.equal(selectPeopleRead("Check duplicates: ; ; ;"), null);
});

test("every implemented domain read is an exact generated read identity", () => {
  const generatedReads = new Set(
    generated.capabilities
      .filter(({ operationKind }) => operationKind === "read")
      .map(({ identity }) => identity)
  );
  const identities = PEOPLE_DOMAIN_READ_REGISTRATIONS.map(
    ({ capabilityIdentity }) => capabilityIdentity
  );
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(identities.length, Object.keys(PEOPLE_READ_IDENTITIES).length);
  for (const identity of identities)
    assert.equal(generatedReads.has(identity), true);
});
