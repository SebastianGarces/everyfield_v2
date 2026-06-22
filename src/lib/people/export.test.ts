import assert from "node:assert/strict";
import { test } from "node:test";

import type { Person } from "@/db/schema";
import {
  EXPORT_CSV_HEADERS,
  buildExportFilename,
  escapeCsvField,
  serializePeopleToCsv,
  type ExportablePerson,
} from "./export";

// ----------------------------------------------------------------------------
// People → CSV serializer (P-027). Pure function, no DB — exercised directly.
// ----------------------------------------------------------------------------

const HEADER = EXPORT_CSV_HEADERS.join(",");

/** Build a minimally-valid person for serialization tests. */
function makePerson(
  overrides: Partial<ExportablePerson> = {}
): ExportablePerson {
  const base: Person = {
    id: "00000000-0000-0000-0000-000000000000",
    churchId: "church-1",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "555-0100",
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: "US",
    status: "prospect",
    source: "website",
    sourceDetails: null,
    notes: null,
    photoUrl: null,
    householdId: null,
    householdRole: null,
    pipelineSortOrder: 0,
    createdBy: "user-1",
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
    deletedAt: null,
  } as Person;

  return { ...base, tags: [], ...overrides };
}

test("includes a header row with the expected columns", () => {
  const csv = serializePeopleToCsv([]);
  const lines = csv.split("\n");

  assert.equal(lines[0], HEADER);
  // At minimum the columns required by the acceptance criteria.
  for (const col of [
    "firstName",
    "lastName",
    "email",
    "phone",
    "status",
    "source",
    "tags",
  ]) {
    assert.ok(
      EXPORT_CSV_HEADERS.includes(col as (typeof EXPORT_CSV_HEADERS)[number]),
      `missing column: ${col}`
    );
  }
});

test("empty list produces just the header (no data rows)", () => {
  const csv = serializePeopleToCsv([]);
  assert.equal(csv, HEADER);
  assert.equal(csv.split("\n").length, 1);
});

test("given N people, produces N data rows plus the header", () => {
  const people = [
    makePerson({ firstName: "A", lastName: "One" }),
    makePerson({ firstName: "B", lastName: "Two" }),
    makePerson({ firstName: "C", lastName: "Three" }),
  ];

  const csv = serializePeopleToCsv(people);
  const lines = csv.split("\n");

  assert.equal(lines.length, people.length + 1); // header + N rows
  assert.equal(lines[0], HEADER);
  assert.ok(lines[1].startsWith("A,One,"));
  assert.ok(lines[3].startsWith("C,Three,"));
});

test("serializes tags as a single semicolon-joined cell", () => {
  const csv = serializePeopleToCsv([
    makePerson({ tags: [{ name: "Volunteer" }, { name: "Greeter" }] }),
  ]);
  const dataRow = csv.split("\n")[1];
  assert.ok(dataRow.includes("Volunteer; Greeter"));
});

test("escapes CSV special characters (comma, quote, newline)", () => {
  const csv = serializePeopleToCsv([
    makePerson({
      firstName: 'Jane "JD"',
      lastName: "Doe, Jr.",
      notes: "line1\nline2",
    }),
  ]);
  const dataRow = csv.split("\n").slice(1).join("\n");

  // Quotes are doubled and the field is wrapped in quotes.
  assert.ok(dataRow.includes('"Jane ""JD"""'));
  // Comma-containing field is wrapped.
  assert.ok(dataRow.includes('"Doe, Jr."'));
  // Newline-containing field is wrapped (so the literal newline lives inside quotes).
  assert.ok(dataRow.includes('"line1\nline2"'));
});

test("escapeCsvField handles null/undefined as empty string", () => {
  assert.equal(escapeCsvField(null), "");
  assert.equal(escapeCsvField(undefined), "");
  assert.equal(escapeCsvField("plain"), "plain");
  assert.equal(escapeCsvField("a,b"), '"a,b"');
});

test("buildExportFilename uses YYYY-MM-DD", () => {
  const name = buildExportFilename(new Date("2026-06-22T12:34:56.000Z"));
  assert.equal(name, "people-export-2026-06-22.csv");
});
