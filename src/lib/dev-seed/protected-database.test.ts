import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ALLOW_PROTECTED_DB_FLAG,
  decideSeedAccounts,
  decideWipe,
  matchProtectedAccounts,
  PROTECTED_ACCOUNTS,
  SEED_ADMIN_PASSWORD_ENV,
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

const SEED_SOURCE = readFileSync(path.join(process.cwd(), SEED_SCRIPT), "utf8");

// ----------------------------------------------------------------------------
// The ADDITIVE mode's guard (#304 round 8, ruled 2026-08-10).
//
// Round 7 found what "no wipe" had been standing in for: `--oversight-orgs-only`
// deleted nothing, three comments in the seed script therefore called it safe on
// the shared development database, and it INSERTED a `sending_church_admin`
// login whose password was a constant in this repository. Additive is not safe.
// The account it created there was neutralised by hand on 2026-08-10; these
// tests are why it cannot come back.
// ----------------------------------------------------------------------------

const A_PASSWORD = "a-password-the-operator-chose";

test("the additive mode refuses a protected database outright", () => {
  const decision = decideSeedAccounts({
    accountsFound: matchProtectedAccounts([...PROTECTED_ACCOUNTS]),
    password: A_PASSWORD,
  });

  assert.equal(decision.verdict, "refuse");
  if (decision.verdict !== "refuse") return;
  assert.equal(decision.reason, "protected-database");

  for (const account of PROTECTED_ACCOUNTS) {
    assert.ok(
      decision.message.includes(account),
      `the refusal must name ${account} so the operator can tell which database this is`
    );
  }
});

test("a good password does not buy a way onto a protected database", () => {
  // The sentinel is asked FIRST, so the answer cannot depend on the password
  // being present, absent or excellent. A well-chosen password on a database
  // real people use is still an account on that database.
  for (const password of [undefined, "", A_PASSWORD]) {
    const decision = decideSeedAccounts({
      accountsFound: [PROTECTED_ACCOUNTS[0]],
      password,
    });
    assert.equal(decision.verdict, "refuse");
    if (decision.verdict !== "refuse") return;
    assert.equal(decision.reason, "protected-database", String(password));
  }
});

test("there is no override for the additive refusal", () => {
  // `decideWipe` takes `overrideRequested` because "wipe this anyway" is a
  // thing an operator can legitimately mean. This decision has no such input at
  // all: its one argument is the two questions and nothing else, so there is no
  // flag a runbook could grow the habit of passing.
  const decision = decideSeedAccounts({
    accountsFound: [PROTECTED_ACCOUNTS[0]],
    password: A_PASSWORD,
  });

  assert.equal(decision.verdict, "refuse");
  if (decision.verdict !== "refuse") return;

  assert.doesNotMatch(
    decision.message,
    new RegExp(ALLOW_PROTECTED_DB_FLAG.replace(/-/g, "\\-")),
    "the additive refusal must not point at the wipe's override — it does not apply here"
  );
  assert.match(
    decision.message,
    /no override/i,
    "the refusal must say there is no way past it, or the reader goes looking for one"
  );
});

test("the additive mode refuses when the password env var is unset", () => {
  for (const password of [undefined, "", "   "]) {
    const decision = decideSeedAccounts({ accountsFound: [], password });

    assert.equal(decision.verdict, "refuse", JSON.stringify(password));
    if (decision.verdict !== "refuse") return;
    assert.equal(decision.reason, "no-password");
    assert.ok(
      decision.message.includes(SEED_ADMIN_PASSWORD_ENV),
      "the refusal must name the variable to set — a dead end sends people to edit the script"
    );
  }
});

test("an unprotected database plus a chosen password proceeds with that password", () => {
  const decision = decideSeedAccounts({
    accountsFound: [],
    password: `  ${A_PASSWORD}  `,
  });

  assert.deepEqual(decision, { verdict: "proceed", password: A_PASSWORD });
});

test("no in-repo constant is the additive mode's password", () => {
  // The property the ruling states: the mode's password comes from the
  // environment and from nowhere else. `DEV_PASSWORD` still exists for the FULL
  // seed — which cannot run at all on a protected database, because the wipe
  // guard refuses first — but it must not be reachable from the branch that
  // writes an account additively.
  const start = SEED_SOURCE.indexOf("if (oversightOrgsOnly) {");
  assert.notEqual(
    start,
    -1,
    `${SEED_SCRIPT} no longer has the additive branch`
  );
  const branch = SEED_SOURCE.slice(
    start,
    SEED_SOURCE.indexOf("await cleanDatabase(")
  );

  assert.ok(
    branch.includes("await passwordForSeededAccounts()"),
    "the additive branch must take its password from the guard"
  );
  assert.doesNotMatch(
    branch,
    /DEV_PASSWORD/,
    "the additive branch must not fall back to the in-repo constant"
  );

  // And the guard reads the environment rather than a literal.
  assert.match(
    SEED_SOURCE,
    /password: process\.env\[SEED_ADMIN_PASSWORD_ENV\]/,
    "the guard must read the password from the environment"
  );
});

test("the additive branch asks the sentinel before it writes a row", () => {
  // The same shape as the wipe's assertion below, for the mode that has no
  // DELETE to anchor on: the guard must be awaited before `seedOversightOrgs`,
  // which is the function that INSERTs the login.
  const start = SEED_SOURCE.indexOf("if (oversightOrgsOnly) {");
  const branch = SEED_SOURCE.slice(
    start,
    SEED_SOURCE.indexOf("await cleanDatabase(")
  );

  const guardCall = branch.indexOf("await passwordForSeededAccounts()");
  const firstWrite = branch.indexOf("await seedOversightOrgs(");

  assert.ok(guardCall >= 0, "the additive branch no longer awaits the guard");
  assert.ok(firstWrite >= 0, "the additive branch no longer seeds anything");
  assert.ok(
    guardCall < firstWrite,
    "the sentinel must be asked before the INSERT — refusing after the account exists is not refusing"
  );
});

test("the seed script no longer claims any mode is safe on the shared database", () => {
  // The three claims round 7 found — the file header, the `oversightOrgsOnly`
  // docblock and `seedOversightOrgs`'s docblock — each said some version of
  // "the one mode that is safe to run against the shared development database".
  // They were false, and a false comment is worse than no comment: it is what
  // the next person reads instead of the code.
  const claims = [
    /safe to run against the shared/i,
    /one mode[^.]*\bis safe\b/i,
    /makes `--oversight-orgs-only` safe/i,
  ];

  for (const claim of claims) {
    assert.doesNotMatch(SEED_SOURCE, claim, String(claim));
  }

  // And what replaced them is the true statement, said once where a reader
  // starts.
  assert.match(SEED_SOURCE, /EVERY MODE ASKS THE SENTINEL BEFORE IT WRITES/);
});

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
