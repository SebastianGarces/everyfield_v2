import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ----------------------------------------------------------------------------
// The additive mode's ACCOUNT WRITES (#304 round 9).
//
// Round 8 gave `--oversight-orgs-only` a sentinel guard and an operator-chosen
// password, and wrote the admin with `onConflictDoNothing`. That combination is
// a false success: run the mode a second time with a different
// SEED_ADMIN_PASSWORD and it exits 0, prints "Password: the SEED_ADMIN_PASSWORD
// you passed", and leaves the OLD password opening the account. Proven on a
// scratch Postgres — the first password still verified, the second did not.
//
// It is what stranded the fixture. The same round neutralised that account's
// password by hand on the shared database, and the docblock's claim that this
// mode is the reproducible way to create it was then untrue: the mode could
// create the account, never re-key it. A verifier following the documented
// command could not sign in, so every interactive acceptance criterion of #304
// went unexercised.
//
// These tests are source-level on purpose. The conflict clause is the defect,
// and no pure function can stand in for it: the only honest end-to-end proof is
// running the mode twice against a real database, which is the evidence in the
// PR body, not a unit test. What a unit test CAN do is stop the clause from
// quietly reverting.
// ----------------------------------------------------------------------------

const SEED_SCRIPT = "scripts/seed-dev-db.ts";
const SEED_SOURCE = readFileSync(path.join(process.cwd(), SEED_SCRIPT), "utf8");

/** The body of `seedOversightOrgs`, so a match elsewhere cannot satisfy these. */
function seedOversightOrgsBody(): string {
  const start = SEED_SOURCE.indexOf("async function seedOversightOrgs(");
  assert.notEqual(
    start,
    -1,
    `${SEED_SCRIPT} no longer has a seedOversightOrgs()`
  );

  // The next line that closes a declaration at column 0 ends the function.
  const end = SEED_SOURCE.indexOf("\n}\n", start);
  assert.notEqual(end, -1, "seedOversightOrgs() is unterminated");
  return SEED_SOURCE.slice(start, end);
}

test("the admin write is an upsert, so a re-run re-keys the account", () => {
  const body = seedOversightOrgsBody();

  assert.match(
    body,
    /\.onConflictDoUpdate\(/,
    "the account write must re-key an existing address — `onConflictDoNothing` reports a password it did not set"
  );
  assert.doesNotMatch(
    body,
    /\.onConflictDoNothing\(/,
    "no account write in this function may skip on conflict; that is the round-8 defect"
  );
  assert.match(
    body,
    /target:\s*users\.email/,
    "the conflict target must be the unique address, not a pinned id — the account is found by email"
  );
});

test("the upsert sets everything the fixture needs, not only the password", () => {
  const body = seedOversightOrgsBody();
  const set = body.slice(body.indexOf("set: {"));

  for (const field of [
    "passwordHash", // the whole point: the operator's chosen credential
    "role", // an account demoted by hand is not an oversight admin any more
    "churchId", // an oversight admin owns no plant of their own
    "sendingChurchId", // what `getAccessibleChurchIds` reads
    "sendingNetworkId", // NULL here is what renders "Set up your network first"
  ]) {
    assert.ok(
      set.includes(`${field}`),
      `the upsert must put ${field} back — a drifted FK is why the preview had no admin who could send an invitation`
    );
  }
});

test("both oversight admins are written, so one command restores both sides", () => {
  // The fixture has two halves: the sending church that issues one kind of
  // invitation and the network that issues the other. Round 8 wrote only the
  // sending-church admin, so `admin@everyfield.app` kept whatever
  // `sending_network_id` it had — NULL on the preview's database.
  assert.match(
    SEED_SOURCE,
    /OVERSIGHT_ADMIN_ROLES\s*=\s*\[\s*"sending_church_admin",\s*"network_admin",?\s*\]/,
    `${SEED_SCRIPT} must write both oversight admin roles in the additive mode`
  );
  assert.match(
    seedOversightOrgsBody(),
    /for\s*\(const role of OVERSIGHT_ADMIN_ROLES\)/,
    "seedOversightOrgs() must loop the declared roles rather than hard-coding one of them"
  );
});

test("the docs do not hand anyone an in-repo password for these accounts", () => {
  // The invariant is repo-wide: no constant in this repository opens an account
  // on a database anyone else uses. A skill file that prints one is the same
  // failure as a default in the script — round 8 fixed the script and left the
  // skill row saying `password123`, and the next verifier believed it.
  const skill = readFileSync(
    path.join(process.cwd(), ".claude/skills/browser-validation/SKILL.md"),
    "utf8"
  );

  let oversightRows = 0;
  for (const line of skill.split("\n")) {
    if (!line.startsWith("|")) continue;
    if (
      !line.includes("sending-church-admin@everyfield.app") &&
      !line.includes("`admin@everyfield.app`")
    ) {
      continue;
    }
    oversightRows += 1;

    assert.doesNotMatch(
      line,
      /password123/,
      `the credentials table must not print a password for an oversight admin: ${line.trim()}`
    );

    // AND it must NAME THE COMMAND in the row itself (#304 round 9). "See
    // below" satisfies the rule above while telling a verifier who scans the
    // table nothing they can act on; the row is where the eye stops, so the row
    // is where the command has to be. The full invocation lives in the fenced
    // block below the table — this is the pointer that gets anyone there.
    assert.match(
      line,
      /--oversight-orgs-only/,
      `an oversight admin's password cell must name the command that sets it: ${line.trim()}`
    );
  }

  assert.equal(
    oversightRows,
    2,
    "both oversight admins must still have a row in the credentials table"
  );

  // The fenced command the rows point at, with the env var that carries the
  // operator's choice — a row naming the flag is useless if the block is gone.
  assert.match(
    skill,
    /SEED_ADMIN_PASSWORD=.*tsx scripts\/seed-dev-db\.ts --oversight-orgs-only/,
    "the skill must still spell out the full command the credentials rows point at"
  );
});
