import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { stripComments } from "@/lib/testing/source-span";
import { personPhotoSrc } from "@/lib/profile-photo";

import { toPersonForClient } from "./types";

// ----------------------------------------------------------------------------
// `persons.user_id` DOES NOT CROSS TO THE BROWSER (#378), GUARDED AT BOTH ENDS.
//
// The column is an ACCOUNT IDENTIFIER. Nothing any surface draws needs it, and
// in the App Router a person row handed to a `"use client"` component rides to
// the browser WHOLE in the RSC payload — every column, drawn or not. So the
// rule is not "don't render it", it is "don't send it".
//
// TWO ENDS, because neither one holds alone:
//
//   1. THE RUNTIME STRIP. `toPersonForClient` is the only spelling of it, and
//      the last test below is the proof it removes the KEY rather than setting
//      it to undefined — `JSON.stringify` and the RSC serializer both carry a
//      key that exists.
//   2. THE TYPE SPELLING. `PersonForClient` is `Omit<Person, "userId">`, and
//      `Person` is STRUCTURALLY ASSIGNABLE to it: a full row passes for the
//      narrow type at every call site, silently, and `tsc` says nothing. That
//      is exactly how this shipped — `checkForDuplicates` built its result by
//      SPREADING a full row into a value typed `PersonWithTags`, so the type
//      asserted the column was gone while the object carried it into
//      `quick-add-form.tsx`. A compiler that cannot see the difference is why
//      the two scans below are source-shaped rather than type assertions, and
//      why one of them carries a fixture pinning its own pattern.
//
// The scans are RATCHETS. They do not prove today's rows are clean — the
// behavioural test and the strip do that. They fail the moment a NEW surface
// spells the raw row type where the narrow one belongs, which is the shape
// every instance of this bug has had.
//
// SINCE #654 THE STRIP CARRIES A SECOND COLUMN: `photo_url`, a private-bucket
// key, traded for the route it resolves to. The last test below covers both,
// because they cross at the same moment and there is only ever one of those.
// The key's own ratchets — where it may be named at all, in either spelling —
// live in `src/lib/picture-key-boundary.test.ts` beside the account avatar's.
// One happy side effect worth knowing: `photoSrc` is a key `Person` does not
// have, so a full row NO LONGER satisfies `PersonForClient` and `tsc` finally
// catches the structural hole described above. It caught two the day it landed.
// The scans stay anyway — an excess property still survives assignment.
//
// WHAT THEY MEASURED WHEN THEY FIRST RAN, against a1a08f9, the commit before
// the fix: 15 client-component props typed `Person` across 11 files, and 19
// raw-row return lines in the six boundary modules — 18 that the fix changed
// plus `getPeopleForExport`, which stands. Both numbers are reproducible by
// running this file at that commit. The fix's own message says 13 for the
// second one and that is WRONG twice over: it was read off a `sort -u` that
// silently collapsed the repeated `): Promise<Person> {` lines, and the
// pattern it was read with still had the anchor bug described at
// RAW_PERSON_RETURN. The corrected number is recorded here because the commit
// message cannot be.
// ----------------------------------------------------------------------------

const ROOT = process.cwd();

/**
 * `Person` written as a TYPE, not as prose.
 *
 * `\b` is what keeps `PersonStatus`, `PersonWithTags`, `NewPerson` and
 * `PersonForClient` out of the match, and the leading `:` or `<` is what keeps
 * the WORD out of it — a client file is full of "Quick Add Person" and "Person
 * deleted successfully", and a scan that fed on those would be unfixable.
 */
const RAW_PERSON_TYPE = /(?::\s*|<)Person\b/;

/**
 * A RETURN type mentioning the raw row, in EVERY shape a signature takes.
 *
 * The anchor this pattern does NOT have is the point. It shipped as
 * `/^\):\s*Promise<.*\bPerson\b/`, which only ever saw a return type that began
 * its own line — the shape a multi-line parameter list happens to produce. Two
 * forms already in this codebase walked straight past it: a one-parameter
 * signature keeps everything on one line (`export async function getFoo(id:
 * string): Promise<Person> {`, and `household.ts`'s `listHouseholds` shows that
 * is house style), and a destructured object parameter closes with
 * `}): Promise<…>` (`quickAddPersonAction`). Ratchet 1 would not have caught
 * either, because it only reads `"use client"` files, and `tsc` says nothing
 * about any of it — so a future one-param boundary read returning `Person`
 * would have slipped every guard here. `PATTERN_FIXTURE` below pins all of it.
 *
 * `\):` therefore matches wherever the parameter list closes, and `.*` is
 * deliberately blind to the type between there and the row: `Promise<Person>`,
 * `Promise<Person | null>`, `Promise<ActionResult<Person>>`, the inline object
 * in `Promise<{ household: Household; person: Person }>`, and a synchronous
 * `): Person` alike. Requiring `Promise<` would re-narrow it to today's shapes,
 * and an object return type rules out matching up to the body brace.
 *
 * What a module HANDS OUT is the whole rule, which is why nothing without a
 * closing paren in front of it counts: `const updateData: Partial<Person>`
 * builds a drizzle `.set()` payload and `let exactRow: Person | null` is a
 * local in a server-only read. Both are correct as `Person`, and neither
 * leaves the module.
 */
const RAW_PERSON_RETURN = /\):.*\bPerson\b/;

/** Every source file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

/**
 * The lines of `file` that spell `Person` as a type, with comments gone first.
 *
 * Comments are stripped for the reason `cursor-pointer.test.ts` strips them: a
 * source-shaped test that matches raw text accepts PROSE as its subject, and
 * every one of these files explains the rule in a docblock that names the type.
 */
function rawPersonLines(file: string, pattern: RegExp): string[] {
  return stripComments(readFileSync(file, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => pattern.test(line));
}

test("no client component takes the raw person row", () => {
  const offenders: string[] = [];

  for (const dir of ["src/components", "src/app"]) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const source = readFileSync(file, "utf8");
      if (!/^["']use client["']/m.test(source)) continue;

      for (const line of rawPersonLines(file, RAW_PERSON_TYPE)) {
        offenders.push(`${path.relative(ROOT, file)}: ${line}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a "use client" component must take PersonForClient, never Person — the raw row carries user_id into the browser:\n${offenders.join("\n")}`
  );
});

/**
 * The modules that hand a person row OUT — the four domain reads and the two
 * server-action files above them. Everything a page or an action can put in
 * front of a client component comes from one of these.
 */
const BOUNDARY_MODULES = [
  "src/lib/people/service.ts",
  "src/lib/people/household.ts",
  "src/lib/people/duplicates.ts",
  "src/lib/people/status.ts",
  "src/app/(dashboard)/people/actions.ts",
  "src/app/(dashboard)/people/household-actions.ts",
];

/**
 * The ONE read in those modules that still hands back a full row, and why.
 *
 * `getPeopleForExport` feeds `export.ts`, which projects the CSV columns by
 * name — `EXPORT_CSV_HEADERS` has no account column and the only thing that
 * leaves the server is the rendered string. It is a server-side bulk read that
 * never reaches a component, so it keeps `Person` and says so here rather than
 * paying for a strip nothing observes.
 */
const SERVER_ONLY_READS = ["src/lib/people/service.ts: ): Promise<Person[]> {"];

/**
 * What the ratchet must see, and what it must not — the scan is only worth its
 * green if the pattern behind it bites.
 *
 * A ratchet that reads real files can go quiet in two ways, and the tree makes
 * neither visible: the pattern stops matching a shape nobody has written YET
 * (the anchor bug above — every form in the tree was multi-line, so the tree
 * agreed with a broken pattern), or it starts matching a local and gets
 * "fixed" by loosening the rule. Both are answered here rather than on the
 * source, so the failure names the pattern instead of a file.
 */
const PATTERN_FIXTURE = {
  catch: [
    // The hole this fixture exists for: one parameter, one line.
    "export async function getFoo(id: string): Promise<Person> {",
    // A destructured object parameter closes the list with `}`.
    "}): Promise<ActionResult<Person>> {",
    // The multi-line shapes, which are what the tree happened to contain.
    "): Promise<Person> {",
    "): Promise<Person | null> => {",
    "): Promise<Person[]> {",
    "): Promise<ActionResult<Person>> {",
    "): Promise<{ household: Household; person: Person }> {",
    // Nothing says a future boundary read has to be async.
    "export function headOf(rows: Row[]): Person {",
    "const pick = (rows: Row[]): Person => rows[0];",
  ],
  ignore: [
    // Locals and payloads. Correct as `Person`; they never leave the module.
    "const updateData: Partial<Person> = {",
    "let exactRow: Person | null = null;",
    // The narrow row, which is the whole point.
    "): Promise<PersonForClient> {",
    "): Promise<ActionResult<PersonForClient[]>> {",
    // Other rows, and no row at all.
    "): Promise<Household[]> {",
    "): Promise<void> {",
    // `Person` before the `):`, never after — a parameter, not a return.
    "function getInitials(person: Person): string {",
    "  person: Person;",
  ],
};

test("the return-type pattern catches every shape a signature takes", () => {
  const missed = PATTERN_FIXTURE.catch.filter(
    (line) => !RAW_PERSON_RETURN.test(line)
  );
  assert.deepEqual(
    missed,
    [],
    `RAW_PERSON_RETURN must catch a raw-row return in any signature shape — these slipped:\n${missed.join("\n")}`
  );

  const falsePositives = PATTERN_FIXTURE.ignore.filter((line) =>
    RAW_PERSON_RETURN.test(line)
  );
  assert.deepEqual(
    falsePositives,
    [],
    `RAW_PERSON_RETURN must ignore parameters, locals and the narrow row — these matched:\n${falsePositives.join("\n")}`
  );
});

test("the people boundary hands out PersonForClient, not Person", () => {
  const offenders: string[] = [];

  for (const module of BOUNDARY_MODULES) {
    for (const line of rawPersonLines(
      path.join(ROOT, module),
      RAW_PERSON_RETURN
    )) {
      offenders.push(`${module}: ${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    SERVER_ONLY_READS,
    `a read that crosses to a client surface must return PersonForClient and strip through toPersonForClient — a server-only read belongs in SERVER_ONLY_READS with its reason:\n${offenders.join("\n")}`
  );
});

test("toPersonForClient removes both keys, and nothing else", () => {
  const photoKey = "people/church-1/person-1/abc-123.png";

  const row = {
    id: "person-1",
    churchId: "church-1",
    userId: "account-1",
    photoUrl: photoKey,
    firstName: "Jane",
    lastName: "Smith",
    email: null,
    deletedAt: null,
  };

  const forClient = toPersonForClient(row as never);

  // The KEYS are gone, not merely undefined: `{ userId: undefined }` still
  // serializes as a property, so a test on the VALUE would pass on a row that
  // still ships the column name.
  for (const column of ["userId", "photoUrl"]) {
    assert.equal(
      Object.hasOwn(forClient, column),
      false,
      `${column} must not survive as a key`
    );
    assert.equal(
      JSON.stringify(forClient).includes(column),
      false,
      `${column} must not survive serialization`
    );
  }

  // Nor may the photo key survive as a VALUE under another name. This is the
  // whole point of trading it for a route rather than dropping it: the route is
  // built FROM the key, so a careless version of that trade ships the key
  // inside the string it returns. Only the last segment rides along, which
  // names no church and no bucket path (#654).
  assert.equal(
    JSON.stringify(forClient).includes("people/church-1"),
    false,
    "the bucket path must not survive inside the resolved route"
  );

  // Every other column rides through untouched — the strip is a boundary, not
  // a projection, so a column added to `persons` needs no edit here.
  assert.deepEqual(forClient, {
    id: "person-1",
    churchId: "church-1",
    firstName: "Jane",
    lastName: "Smith",
    email: null,
    deletedAt: null,
    photoSrc: personPhotoSrc("person-1", photoKey),
  });

  // A person with no photo gets `undefined`, which is what makes the initials
  // fallback render — the ONE fact a client surface needs beyond the address.
  assert.equal(
    toPersonForClient({ ...row, photoUrl: null } as never).photoSrc,
    undefined
  );

  // The input is not mutated: `createPerson` emits `person.created` from the
  // full row it just wrote, and strips only what it RETURNS.
  assert.equal(row.userId, "account-1", "the source row keeps its link");
  assert.equal(row.photoUrl, photoKey, "the source row keeps its photo key");
});
