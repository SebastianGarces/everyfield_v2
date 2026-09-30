import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsvString } from "./import";
import { serializePeopleToCsv, type ExportablePerson } from "./export";

test("exported multiline notes reimport as one intact person", () => {
  const csv = serializePeopleToCsv([
    {
      firstName: 'Jane "JD"',
      lastName: "Doe, Jr.",
      notes: "First line\n\nSecond line",
      createdAt: new Date("2026-09-30T00:00:00Z"),
    } as ExportablePerson,
  ]);
  const rows = parseCsvString(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstName, 'Jane "JD"');
  assert.equal(rows[0].lastName, "Doe, Jr.");
  assert.equal(rows[0].notes, "First line\n\nSecond line");
});

test("BOM, display headers, CRLF records and embedded CRLF are supported", () => {
  const rows = parseCsvString(
    '\uFEFFFirst Name *,Last Name *,Notes\r\nJane,Doe,"One\r\nTwo"\r\n\r\nJohn,Smith,"Comma, and ""quote"""\r\n'
  );
  assert.deepEqual(rows, [
    { firstName: "Jane", lastName: "Doe", notes: "One\r\nTwo" },
    { firstName: "John", lastName: "Smith", notes: 'Comma, and "quote"' },
  ]);
});

test("empty input and header-only CSV produce no import rows", () => {
  for (const csv of [
    "",
    "\r\n",
    "firstName,lastName",
    "firstName,lastName\n\n",
  ])
    assert.deepEqual(parseCsvString(csv), []);
});

test("malformed quotes reject the whole file without phantom people", () => {
  for (const line of [
    'Jane,Doe,"unfinished\nJohn,Smith,other',
    'Jane,Doe,"closed"tail',
    'Jane,Doe,un"quoted',
  ])
    assert.throws(
      () => parseCsvString(`firstName,lastName,notes\n${line}`),
      /Invalid CSV/
    );
});

test("trailing empty fields and repeated parsing remain stable", () => {
  const csv = 'firstName,lastName,email,notes\nJane,Doe,,\nJohn,Smith,,""';
  const expected = [
    { firstName: "Jane", lastName: "Doe" },
    { firstName: "John", lastName: "Smith" },
  ];
  assert.deepEqual(parseCsvString(csv), expected);
  assert.deepEqual(parseCsvString(csv), expected);
});
