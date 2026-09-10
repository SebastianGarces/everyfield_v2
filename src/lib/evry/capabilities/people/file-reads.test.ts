import assert from "node:assert/strict";
import { test } from "node:test";

import generated from "./inventory.generated.json";
import {
  PEOPLE_FILE_READ_IDENTITIES,
  PEOPLE_FILE_READ_REGISTRATIONS,
  selectPeopleFileRead,
} from "./file-reads";

const ID = "10000000-0000-4000-8000-000000000001";

test("file read selection is closed and serialization-stable", () => {
  const selected = [
    selectPeopleFileRead(`Download commitment ${ID}`),
    selectPeopleFileRead("Download the people CSV template"),
    selectPeopleFileRead(
      `Export people: status=prospect,attendee; source=website; search=Ada; tags=${ID}`
    ),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), selected);
  assert.equal(selected.every(Boolean), true);
  assert.equal(selectPeopleFileRead("Download https://example.com/file"), null);
  assert.equal(
    selectPeopleFileRead("Export people: url=https://example.com"),
    null
  );
});

test("all four file reads are exact generated production registrations", () => {
  const generatedReads = new Set(
    generated.capabilities
      .filter(({ operationKind }) => operationKind === "read")
      .map(({ identity }) => identity)
  );
  const identities = PEOPLE_FILE_READ_REGISTRATIONS.map(
    ({ capabilityIdentity }) => capabilityIdentity
  );
  assert.deepEqual(
    identities.toSorted(),
    Object.values(PEOPLE_FILE_READ_IDENTITIES).toSorted()
  );
  for (const identity of identities)
    assert.equal(generatedReads.has(identity), true);
});
