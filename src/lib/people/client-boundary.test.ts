import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { stripComments } from "@/lib/testing/source-span";

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
//      the third test below is the proof it removes the KEY rather than setting
//      it to undefined — `JSON.stringify` and the RSC serializer both carry a
//      key that exists.
//   2. THE TYPE SPELLING. `PersonForClient` is `Omit<Person, "userId">`, and
//      `Person` is STRUCTURALLY ASSIGNABLE to it: a full row passes for the
//      narrow type at every call site, silently, and `tsc` says nothing. That
//      is exactly how this shipped — `checkForDuplicates` built its result by
//      SPREADING a full row into a value typed `PersonWithTags`, so the type
//      asserted the column was gone while the object carried it into
//      `quick-add-form.tsx`. A compiler that cannot see the difference is why
//      the first two tests are source-shaped scans rather than type assertions.
//
// The scans are RATCHETS. They do not prove today's rows are clean — test 3 and
// the strip do that. They fail the moment a NEW surface spells the raw row type
// where the narrow one belongs, which is the shape every instance of this bug
// has had.
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
 * A RETURN type mentioning the raw row — `): Promise<Person>`,
 * `): Promise<Person | null>`, `): Promise<ActionResult<Person>>`,
 * `): Promise<{ household: Household; person: Person }>`.
 *
 * What a boundary module HANDS OUT is the whole rule, so this is deliberately
 * blind to the type inside it: `const updateData: Partial<Person>` builds a
 * drizzle `.set()` payload and `let exactRow: Person | null` is a local in a
 * server-only read. Both are correct as `Person` and neither leaves the module.
 */
const RAW_PERSON_RETURN = /^\):\s*Promise<.*\bPerson\b/;

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

test("toPersonForClient removes the key, and nothing else", () => {
  const row = {
    id: "person-1",
    churchId: "church-1",
    userId: "account-1",
    firstName: "Jane",
    lastName: "Smith",
    email: null,
    deletedAt: null,
  };

  const forClient = toPersonForClient(row as never);

  // The KEY is gone, not merely undefined: `{ userId: undefined }` still
  // serializes as a property, so a test on the VALUE would pass on a row that
  // still ships the column name.
  assert.equal(
    Object.hasOwn(forClient, "userId"),
    false,
    "userId must not survive as a key"
  );
  assert.equal(
    JSON.stringify(forClient).includes("userId"),
    false,
    "userId must not survive serialization"
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
  });

  // The input is not mutated: `createPerson` emits `person.created` from the
  // full row it just wrote, and strips only what it RETURNS.
  assert.equal(row.userId, "account-1", "the source row keeps its link");
});
