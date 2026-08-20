import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { accountPersonName, accountPersonValues } from "./account-person";

// ----------------------------------------------------------------------------
// AS-013 (#378) — WHAT THE PLANTER'S OWN PERSON ROW SAYS.
//
// Hermetic: `account-person.ts` is an import-free leaf that decides values and
// writes nothing, so this suite needs no database.
//
// The last two tests pin it to the two places that must agree with it — the
// church-gain batch, and migration 0052's SQL twin of the same rule. Those are
// the drifts nothing else would catch: a name split that disagrees with the
// backfill leaves one plant's Owner named differently from the next one's, for
// no reason a reader could ever reconstruct.
// ----------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHURCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("the first word is the given name and the whole rest is the family name", () => {
  assert.deepEqual(accountPersonName("John Planter", "j@t.test"), {
    firstName: "John",
    lastName: "Planter",
  });

  // Four of five words stay together rather than three being dropped.
  assert.deepEqual(accountPersonName("Mary Anne Van Der Berg", "m@t.test"), {
    firstName: "Mary",
    lastName: "Anne Van Der Berg",
  });

  // Runs of whitespace are one separator, and the outside is trimmed.
  assert.deepEqual(accountPersonName("  Ada   Lovelace  ", "a@t.test"), {
    firstName: "Ada",
    lastName: "Lovelace",
  });
});

test("a one-word name keeps an EMPTY family name rather than an invented one", () => {
  // `last_name` is NOT NULL so it needs a value, and anything other than empty
  // would be a word on the planter's record they never typed.
  assert.deepEqual(accountPersonName("Cher", "cher@t.test"), {
    firstName: "Cher",
    lastName: "",
  });
});

test("no name at all falls back to the address, never to a blank row", () => {
  // A person row with an empty `first_name` renders as a blank line in the
  // assignment list — the one surface this whole link exists to reach.
  for (const empty of [null, "", "   "]) {
    assert.deepEqual(accountPersonName(empty, "grace.hopper@navy.test"), {
      firstName: "grace.hopper",
      lastName: "",
    });
  }

  // An address with no local part is the degenerate case; the whole string is
  // still better than nothing.
  assert.deepEqual(accountPersonName(null, "@t.test"), {
    firstName: "@t.test",
    lastName: "",
  });
});

test("the row is the account: linked, self-created, and at the top of the pipeline", () => {
  const values = accountPersonValues({
    userId: USER_ID,
    churchId: CHURCH_ID,
    name: "John Planter",
    email: "john@t.test",
  });

  assert.equal(values.userId, USER_ID, "the link");
  assert.equal(values.churchId, CHURCH_ID, "the tenancy");
  assert.equal(values.email, "john@t.test");

  // `created_by` is the account itself — the row exists because that account
  // gained this plant, and there is no other actor to name.
  assert.equal(values.createdBy, USER_ID);

  // NOT `prospect`. The status column is a recruitment pipeline and the planter
  // is not a recruit; `leader` is also the value that survives the team
  // assignment this row exists for, because `autoAdvanceStatus` moves a person
  // only from an exact `from`.
  assert.equal(values.status, "leader");

  // The source vocabulary is about how a CONTACT reached the plant, and none of
  // its seven words is true of the planter.
  assert.equal(values.source, undefined);
});

test("the church-gain batch is the ONE writer, and it is idempotent there", () => {
  // `churchCreationStatements` is spread whole by BOTH church-gain paths —
  // onboarding step 1 and an invited planter's registration (ruling 408-4B) —
  // so this being the only caller is what makes "one spelling" true.
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/onboarding/create-church.ts"),
    "utf8"
  );

  assert.match(source, /accountPersonValues\(\{/);
  assert.match(source, /onConflictDoNothing\(\{[\s\S]*?persons\.churchId/);
});

test("migration 0052's backfill spells the same rule in SQL", () => {
  // The backfill and the runtime path have to agree or a plant migrated today
  // gets a differently-shaped Owner from one created tomorrow — for no reason a
  // reader could reconstruct. Neither can be derived from the other (one is
  // TypeScript, one is DDL), so what is asserted is that the SAME three
  // decisions are visible in both.
  const migration = readFileSync(
    path.join(process.cwd(), "src/db/migrations/0052_person_user_link.sql"),
    "utf8"
  );

  // The status.
  assert.match(migration, /'leader'/);
  // The self-authorship: church_id, user_id, created_by, and the last two are
  // the same column.
  assert.match(
    migration,
    /"church_id",\s*"user_id",\s*"created_by",\s*"first_name",\s*"last_name",\s*"email",\s*"status"/
  );
  // The split: first word out, the remainder after the first space, and the
  // address's local part when there is no name.
  assert.match(migration, /split_part\(n\."clean", ' ', 1\)/);
  assert.match(migration, /split_part\(u\."email", '@', 1\)/);
  assert.match(migration, /position\(' ' IN n\."clean"\)/);
});
