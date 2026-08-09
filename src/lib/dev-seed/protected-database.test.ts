import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ALLOW_PROTECTED_DB_FLAG,
  decideWipe,
  matchProtectedAccounts,
  PROTECTED_ACCOUNTS,
} from "./protected-database";

// ----------------------------------------------------------------------------
// The dev-seed guard (#326, ruled 2026-08-09).
//
// `pnpm db:seed` deletes ALL users and ALL churches. The ruling required a HARD
// CODE guard against the shared development database, because the previous
// guard was a comment — and because the same track that made the seed converge
// also removed the crash that had been protecting that database by accident.
//
// The decision is a pure function precisely so it can be pinned here: the only
// way to test the wired-up version end to end is to run the wipe this guard
// exists to prevent, which is not a test anyone should write.
// ----------------------------------------------------------------------------

const PLANTER = "planter1@everyfield.app";

test("a database with none of the sentinels wipes freely", () => {
  const accountsFound = matchProtectedAccounts([
    PLANTER,
    "coach1@everyfield.app",
  ]);
  assert.deepEqual(accountsFound, []);
  assert.deepEqual(decideWipe({ accountsFound, overrideRequested: false }), {
    verdict: "proceed",
  });
});

test("an empty database wipes freely", () => {
  assert.deepEqual(
    decideWipe({
      accountsFound: matchProtectedAccounts([]),
      overrideRequested: false,
    }),
    { verdict: "proceed" }
  );
});

test("the override on an unprotected database changes nothing", () => {
  // Nothing to override, so nothing to warn about — the flag must not turn an
  // ordinary run into one that looks dangerous in the log.
  assert.deepEqual(decideWipe({ accountsFound: [], overrideRequested: true }), {
    verdict: "proceed",
  });
});

test("ONE sentinel is enough to refuse", () => {
  // The cohort is a sample, not an inventory: the shared database also holds
  // ~67 hand-registered plants that no sentinel names.
  const accountsFound = matchProtectedAccounts([
    PLANTER,
    PROTECTED_ACCOUNTS[1],
  ]);
  const decision = decideWipe({ accountsFound, overrideRequested: false });

  assert.equal(decision.verdict, "refuse");
  assert.deepEqual(decision.accounts, [PROTECTED_ACCOUNTS[1]]);
});

test("the refusal names the accounts and the exact way past it", () => {
  const decision = decideWipe({
    accountsFound: matchProtectedAccounts([...PROTECTED_ACCOUNTS]),
    overrideRequested: false,
  });

  assert.equal(decision.verdict, "refuse");
  if (decision.verdict !== "refuse") return;

  for (const account of PROTECTED_ACCOUNTS) {
    assert.ok(
      decision.message.includes(account),
      `the refusal must name ${account} so the operator can tell which database this is`
    );
  }
  assert.ok(
    decision.message.includes(ALLOW_PROTECTED_DB_FLAG),
    "the refusal must name the override flag — a dead end sends people to edit the script instead"
  );
  assert.ok(
    /ALL users and ALL churches/.test(decision.message),
    "the refusal must say what the wipe actually deletes, not just that it declined"
  );
});

test("the override runs the wipe, loudly", () => {
  const decision = decideWipe({
    accountsFound: matchProtectedAccounts([...PROTECTED_ACCOUNTS]),
    overrideRequested: true,
  });

  assert.equal(decision.verdict, "proceed-with-override");
  if (decision.verdict !== "proceed-with-override") return;

  assert.deepEqual(decision.accounts, [...PROTECTED_ACCOUNTS]);
  for (const account of PROTECTED_ACCOUNTS) {
    assert.ok(
      decision.warning.includes(account),
      `the override warning must still name ${account} — it is the last thing printed before they are deleted`
    );
  }
});

test("matching is on the whole address, so a lookalike domain does not trip the guard", () => {
  // A guard that refuses on `brett@firstfamily.church.example.com` teaches
  // people to pass the override without reading it.
  assert.deepEqual(
    matchProtectedAccounts([
      `${PROTECTED_ACCOUNTS[0]}.example.com`,
      `x${PROTECTED_ACCOUNTS[0]}`,
      PROTECTED_ACCOUNTS[0].replace("@", "+alpha@"),
    ]),
    []
  );
});

test("matching survives case and stray whitespace", () => {
  assert.deepEqual(
    matchProtectedAccounts([
      `  ${PROTECTED_ACCOUNTS[0].toUpperCase()} `,
      PROTECTED_ACCOUNTS[0],
    ]),
    [PROTECTED_ACCOUNTS[0]]
  );
});

test("the result is deduplicated and ordered, so the message is deterministic", () => {
  const shuffled = [
    PROTECTED_ACCOUNTS[2],
    PROTECTED_ACCOUNTS[0],
    PROTECTED_ACCOUNTS[2],
    PROTECTED_ACCOUNTS[1],
  ];
  assert.deepEqual(matchProtectedAccounts(shuffled), [...PROTECTED_ACCOUNTS]);
});

// ----------------------------------------------------------------------------
// The wiring. The guard is only a guard if the seed actually consults it before
// its first DELETE, and that is a property of `scripts/seed-dev-db.ts`, not of
// the module above — so it is asserted on the source, the same technique as
// `seeded-churches.test.ts` and for the same reason: running the seed needs a
// database and CI has none.
// ----------------------------------------------------------------------------

const SEED_SCRIPT = "scripts/seed-dev-db.ts";

test("the seed script consults the guard before it deletes anything", () => {
  const source = readFileSync(path.join(process.cwd(), SEED_SCRIPT), "utf8");

  assert.match(
    source,
    /from "\.\.\/src\/lib\/dev-seed\/protected-database"/,
    `${SEED_SCRIPT} must import the guard rather than re-implement the sentinel list`
  );
  assert.ok(
    source.includes(`process.argv.includes(ALLOW_PROTECTED_DB_FLAG)`),
    `${SEED_SCRIPT} must read the override from argv rather than an env var — a flag is typed on purpose, an env var is inherited by accident`
  );

  // Scoped to the wiping function, so the guard's own declaration higher up the
  // file cannot satisfy this by sitting above the DELETE.
  const start = source.indexOf("async function cleanDatabase(");
  assert.notEqual(start, -1, `${SEED_SCRIPT} no longer has a cleanDatabase()`);
  const body = source.slice(start);

  const guardCall = body.indexOf("await assertDatabaseIsWipeable(");
  const firstDelete = body.indexOf("DELETE FROM");
  assert.notEqual(guardCall, -1, `cleanDatabase() no longer awaits the guard`);
  assert.notEqual(
    firstDelete,
    -1,
    `cleanDatabase() no longer deletes anything`
  );
  assert.ok(
    guardCall < firstDelete,
    "the guard must be awaited before the first DELETE — refusing after the users are gone is not refusing"
  );
});
