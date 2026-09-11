import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { db } from "@/db";
import { persons, users } from "@/db/schema";

import { personHoldsLoginFilter, personIsUserInChurch } from "./person-user";

// ============================================================================
// The person↔user bridge has ONE spelling.
//
// It shipped as two verbatim copies in one PR — `guestListUserIdsQuery` and
// `coreGroupUserIdsQuery` — each with a `.toSQL()` test that would have stayed
// green on its own file while the other drifted. That is a TENANCY decision with
// two owners on day one: the copy that later forgets `users.church_id` mails one
// plant's meeting to another plant's planter.
//
// §1 pins what the condition SAYS. §2 pins that nothing else says it.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const ROOT = path.join(process.cwd(), "src");

/** The condition, rendered — a bare `SQL` has no `.toSQL()` of its own. */
function renderedJoin(): { sql: string; params: unknown[] } {
  return db
    .selectDistinct({ userId: users.id })
    .from(persons)
    .innerJoin(users, personIsUserInChurch(CHURCH))
    .where(personHoldsLoginFilter(CHURCH))
    .toSQL();
}

// ----------------------------------------------------------------------------
// §1 — both sides of the bridge carry the church id
// ----------------------------------------------------------------------------

test("the join matches on address and scopes the user to the church", () => {
  const { sql, params } = renderedJoin();

  assert.match(sql, /lower\("users"\."email"\) = lower\("persons"\."email"\)/);
  assert.match(sql, /"users"\."church_id" = \$\d/);
  assert.match(sql, /"users"\."sending_church_id" is null/);
  assert.match(sql, /"users"\."sending_network_id" is null/);
  assert.equal(
    params.filter((value) => value === CHURCH).length,
    2,
    "both sides of the bridge carry the church id"
  );
});

test("the persons-side guards exclude deleted people and null addresses", () => {
  const { sql } = renderedJoin();

  assert.match(sql, /"persons"\."church_id" = \$\d/);
  assert.match(sql, /"persons"\."deleted_at" is null/);
  assert.match(sql, /"persons"\."email" is not null/);
});

test("neither helper can return undefined", () => {
  // drizzle DROPS an undefined condition. A dropped JOIN condition is a cross
  // product of two tenants' tables, which is why these are composed as one
  // `sql` fragment rather than through `and(...)`, whose type is `SQL |
  // undefined`. Asserted at runtime as well as in the signature, because a
  // future edit back to `and(...)!` would type-check.
  assert.ok(personIsUserInChurch(CHURCH));
  assert.ok(personHoldsLoginFilter(CHURCH));
});

// ----------------------------------------------------------------------------
// §2 — and nothing else in `src/` spells it
// ----------------------------------------------------------------------------

/** Every shipped `.ts`/`.tsx` under `src/`, absolute. Suites are skipped. */
function sourceFiles(dir: string = ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      found.push(full);
    }
  }
  return found;
}

test("exactly one module in src/ compares a person's address to a user's", () => {
  // The property, not the instance: a second spelling is a second owner of a
  // tenancy rule, and every consumer's own `.toSQL()` test would still pass.
  const owner = path.join(ROOT, "lib", "people", "person-user.ts");
  const spellings = sourceFiles().filter((file) =>
    /lower\(\$\{users\.email\}\)\s*=\s*lower\(\$\{persons\.email\}\)/.test(
      readFileSync(file, "utf8")
    )
  );

  assert.deepEqual(
    spellings,
    [owner],
    "the person↔user bridge is spelled outside `src/lib/people/person-user.ts` — declare it once and join through it"
  );
});

test("no module rebuilds the persons-side guards beside a users join", () => {
  // The narrower half of the same rule: a reader that crosses the bridge and
  // re-derives "not deleted, has an address" has re-taken the decision, and the
  // one that forgets `isNotNull(persons.email)` resolves nobody at all —
  // silently, as an empty audience rather than an error.
  const owner = path.join(ROOT, "lib", "people", "person-user.ts");
  const offenders = sourceFiles().filter((file) => {
    if (file === owner) return false;
    const source = readFileSync(file, "utf8");
    return (
      /isNotNull\(persons\.email\)/.test(source) && /\busers\b/.test(source)
    );
  });

  assert.deepEqual(
    offenders.map((file) => path.relative(ROOT, file)),
    [],
    "a bridged read rebuilt the persons-side guards instead of calling `personHoldsLoginFilter`"
  );
});
