import assert from "node:assert/strict";
import { test } from "node:test";

import generated from "./inventory.generated.json";
import {
  PEOPLE_FILE_READ_IDENTITIES,
  PEOPLE_FILE_READ_REGISTRATIONS,
  selectPeopleFileRead,
  buildPeopleImportPreviewArtifact,
} from "./file-reads";
import type { ImportPreview, ImportRow } from "@/lib/people/types";

const ID = "10000000-0000-4000-8000-000000000001";

test("CSV preview counts every displayed row once and keeps errors beside that row", () => {
  const row = (rowNumber: number): ImportRow => ({
    rowNumber,
    data: { firstName: "Ada", lastName: "Person" },
    valid: true,
    errors: [],
    duplicates: { exactMatch: null, potentialMatches: [] },
  });
  const missingName = {
    ...row(3),
    data: { lastName: "Person" },
    valid: false,
    errors: ["firstName: First name is required"],
  };
  const duplicate = {
    ...row(4),
    duplicates: {
      exactMatch: { id: ID, displayName: "Ada Existing" },
      potentialMatches: [],
    },
  };
  const preview: ImportPreview = {
    totalRows: 3,
    validRows: [row(2)],
    invalidRows: [missingName],
    duplicateRows: [duplicate],
  };
  const result = buildPeopleImportPreviewArtifact(preview, "people.csv");
  assert.deepEqual(result.counts, { matched: 3, returned: 3, excluded: 0 });
  assert.deepEqual(result.exclusions, []);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["csv-row-2", "csv-row-3", "csv-row-4"]
  );
  assert.ok(
    result.items[1]!.facts.some(
      (fact) =>
        fact.label === "Needs attention" && fact.value === "Add a first name."
    )
  );
  assert.ok(
    result.items[2]!.facts.some(
      (fact) => fact.label === "Merge target" && fact.value === "Ada Existing"
    )
  );
  assert.ok(
    !result.items[0]!.facts.some((fact) => fact.label === "Needs attention")
  );
});

test("unavailable CSV attachment remains a refusal, not an empty successful preview", () => {
  const result = buildPeopleImportPreviewArtifact(null);
  assert.equal(result.title, "Import preview unavailable");
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.exclusions, [
    { reason: "Attachment unavailable", count: 1 },
  ]);
  assert.deepEqual(result.counts, { matched: 1, returned: 0, excluded: 1 });
});

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
