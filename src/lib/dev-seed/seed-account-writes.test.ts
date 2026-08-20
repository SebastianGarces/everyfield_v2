import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { db } from "@/db";

import {
  OVERSIGHT_ADMIN_EMAILS,
  oversightAdminSeeds,
  oversightAdminUpsert,
  type SeedAccountRow,
} from "./oversight-admin-upsert";
import {
  recordedSeedPassword,
  unrecordedPasswordNotice,
} from "./protected-database";

// ----------------------------------------------------------------------------
// The additive mode's ACCOUNT WRITES (#304).
//
// `--oversight-orgs-only` sets a password on two logins and then tells the
// operator to sign in with it. Two defects made that sentence false, and these
// tests exist so neither can return quietly:
//
//   - `onConflictDoNothing` could only CREATE the account. A second run with a
//     different SEED_ADMIN_PASSWORD exited 0, printed "the SEED_ADMIN_PASSWORD
//     you passed", and left the OLD password opening it.
//   - The chosen password was recorded nowhere, so even once the write re-keyed
//     correctly, only the shell that ran it could sign in.
//
// WHAT IS ASSERTED, AND HOW. Where the SQL is the invariant, render the builder
// and inspect the statement — never grep the script's source
// (`src/lib/wiki/tenancy.test.ts`). The
// conflict clause IS the defect, so `.toSQL()` renders it here. Which rows get
// written is a function, `oversightAdminSeeds()`, so it is called with a
// fixture rather than pattern-matched in the script that calls it.
//
// `.toSQL()` renders; it does not connect — but importing `@/db` constructs the
// Neon client at module load, so a DATABASE_URL must be PRESENT, which
// `pnpm test` and CI both supply as a placeholder.
//
// The SKILL.md assertions below DO read text, and legitimately: a document is
// text, and what is being pinned is what it tells a human.
//
// The end-to-end proof is still two runs against a real scratch database with
// two different passwords — evidence for the PR body, not a unit test.
// ----------------------------------------------------------------------------

const ADMIN = {
  email: "sending-church-admin@everyfield.app",
  name: "Sarah Sending",
  seat: "owner",
  sendingChurchId: "d2000000-0000-4000-8000-000000000002",
  sendingNetworkId: null,
} as const;

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture";
const NOW = new Date("2026-08-11T00:00:00.000Z");

function renderedUpsert() {
  return oversightAdminUpsert(db, { ...ADMIN }, HASH, NOW).toSQL();
}

test("the account write is an upsert on the address, so a re-run re-keys it", () => {
  const { sql } = renderedUpsert();
  const normalized = sql.toLowerCase().replace(/\s+/g, " ");

  // The conflict TARGET is the unique address. Not a pinned id: the account is
  // found by the address the documentation hands a verifier.
  assert.match(
    normalized,
    /on conflict \("email"\) do update set/,
    `the write must re-key an existing address; \`onConflictDoNothing\` reports a password it did not set. Rendered: ${sql}`
  );
  assert.doesNotMatch(
    normalized,
    /do nothing/,
    `no account write here may skip on conflict — that is the defect this mode was rejected for. Rendered: ${sql}`
  );
});

test("the upsert sets everything the fixture needs, not only the password", () => {
  const { sql, params } = renderedUpsert();
  const update = sql.slice(sql.toLowerCase().indexOf("do update set"));

  for (const column of [
    '"password_hash"', // the whole point: the operator's chosen credential
    '"seat"', // an account demoted by hand is not its org's Owner any more
    '"church_id"', // an oversight tenancy owns no plant of its own
    '"sending_church_id"', // what `getAccessibleChurchIds` reads
    '"sending_network_id"', // NULL here renders "Set up your network first"
    '"updated_at"',
  ]) {
    assert.ok(
      update.includes(column),
      `the upsert must put ${column} back — a drifted FK is why the preview had no admin who could send an invitation. Rendered SET: ${update}`
    );
  }

  // `name` is deliberately NOT in the SET: it identifies a person on screen,
  // and a re-key is not a rename.
  assert.ok(
    !update.includes('"name"'),
    `a re-key must not rename the account. Rendered SET: ${update}`
  );

  // The hash reaches the statement as a bound parameter — twice, once for the
  // INSERT and once for the UPDATE — rather than being interpolated into text.
  assert.equal(
    params.filter((param) => param === HASH).length,
    2,
    `the chosen password's hash must be bound for both the insert and the re-key. Params: ${JSON.stringify(params)}`
  );
});

// ----------------------------------------------------------------------------
// WHICH ROWS GET WRITTEN
// ----------------------------------------------------------------------------

const FIXTURE: SeedAccountRow[] = [
  { email: "planter1@everyfield.app", name: "Pat Planter", seat: "owner" },
  {
    email: "sending-church-admin@everyfield.app",
    name: "Sarah Sending",
    seat: "owner",
    sendingChurchId: "d2000000-0000-4000-8000-000000000002",
  },
  {
    email: "admin@everyfield.app",
    name: "Network Admin",
    seat: "owner",
    sendingNetworkId: "d1000000-0000-4000-8000-000000000001",
  },
];

test("both oversight admins are selected by ADDRESS, so one command restores both sides", () => {
  // The fixture has two halves: the sending church that issues one kind of
  // invitation and the network that issues the other. Writing only the
  // sending-church admin left `admin@everyfield.app` with whatever
  // `sending_network_id` it had — NULL on the preview's database.
  assert.deepEqual(
    [...OVERSIGHT_ADMIN_EMAILS],
    ["sending-church-admin@everyfield.app", "admin@everyfield.app"],
    "both oversight admins must be written, and by the address the docs name"
  );

  const seeds = oversightAdminSeeds(FIXTURE);

  assert.deepEqual(
    seeds.map((seed) => seed.email),
    [...OVERSIGHT_ADMIN_EMAILS],
    "the two admins are resolved in the documented order, and nobody else is"
  );

  // The org FKs come across, and absent ones become explicit NULLs rather than
  // `undefined` — the upsert writes the column either way, which is how a
  // drifted FK gets repaired.
  assert.deepEqual(seeds[0], {
    email: "sending-church-admin@everyfield.app",
    name: "Sarah Sending",
    seat: "owner",
    sendingChurchId: "d2000000-0000-4000-8000-000000000002",
    sendingNetworkId: null,
  });
  assert.deepEqual(seeds[1], {
    email: "admin@everyfield.app",
    name: "Network Admin",
    seat: "owner",
    sendingChurchId: null,
    sendingNetworkId: "d1000000-0000-4000-8000-000000000001",
  });
});

test("a missing half of the fixture stops the run instead of shortening the loop", () => {
  // The lookup is by ADDRESS, not by tenancy, because a tenancy is not unique
  // by construction: a second account in the network would silently move the
  // credential write to another row.
  const tenancyTwin: SeedAccountRow = {
    email: "second-admin@everyfield.app",
    name: "Second Admin",
    seat: "owner",
    sendingNetworkId: "d1000000-0000-4000-8000-000000000001",
  };
  assert.deepEqual(
    oversightAdminSeeds([...FIXTURE, tenancyTwin]).map((seed) => seed.email),
    [...OVERSIGHT_ADMIN_EMAILS],
    "a second account in the same org must not attract the credential write"
  );

  assert.throws(
    () =>
      oversightAdminSeeds(
        FIXTURE.filter((row) => row.email !== "admin@everyfield.app")
      ),
    /admin@everyfield\.app/,
    "an address the fixture no longer carries must throw — half a restored fixture is the 'Set up your network first' failure"
  );

  assert.throws(
    () =>
      oversightAdminSeeds(
        FIXTURE.map((row) =>
          row.email === "admin@everyfield.app" ? { ...row, name: null } : row
        )
      ),
    /has no name/,
    "the upsert never sets `name`, so a nameless row would be inserted nameless and never repaired"
  );
});

// ----------------------------------------------------------------------------
// WHERE THE PASSWORD IS WRITTEN DOWN
// ----------------------------------------------------------------------------

test("a password recorded in .env.local is read back, whatever the quoting", () => {
  assert.equal(recordedSeedPassword(undefined), undefined);
  assert.equal(recordedSeedPassword("OTHER=1\n"), undefined);
  assert.equal(recordedSeedPassword("SEED_ADMIN_PASSWORD=plain\n"), "plain");
  assert.equal(recordedSeedPassword('SEED_ADMIN_PASSWORD="dq"\n'), "dq");
  assert.equal(recordedSeedPassword("SEED_ADMIN_PASSWORD='sq'\n"), "sq");
  assert.equal(
    recordedSeedPassword("export SEED_ADMIN_PASSWORD=exported\n"),
    "exported"
  );
  // dotenv semantics: the last assignment is the one that reaches process.env.
  assert.equal(
    recordedSeedPassword(
      "SEED_ADMIN_PASSWORD=first\nSEED_ADMIN_PASSWORD=last\n"
    ),
    "last"
  );
  // A key that merely CONTAINS the name is a different variable.
  assert.equal(recordedSeedPassword("OLD_SEED_ADMIN_PASSWORD=x\n"), undefined);

  // dotenv strips a trailing comment from an UNQUOTED value. Disagreeing with
  // it costs a spurious "not recorded" warning, which teaches an operator to
  // ignore the one warning that matters.
  assert.equal(
    recordedSeedPassword("SEED_ADMIN_PASSWORD=plain # chosen 2026-08-11\n"),
    "plain"
  );
  // ...and only when the `#` starts a comment. A `#` inside the value stays.
  assert.equal(recordedSeedPassword("SEED_ADMIN_PASSWORD=pa#ss\n"), "pa#ss");
  assert.equal(
    recordedSeedPassword('SEED_ADMIN_PASSWORD="quoted # kept"\n'),
    "quoted # kept"
  );
});

test("an unrecorded password is called out, and never printed", () => {
  assert.equal(
    unrecordedPasswordNotice('SEED_ADMIN_PASSWORD="hunter2"\n', "hunter2"),
    null,
    "nothing to warn about when the file records the password that was used"
  );

  for (const [text, used] of [
    [undefined, "hunter2"], // no .env.local at all
    ["VERCEL_AUTOMATION_BYPASS_SECRET=x\n", "hunter2"], // no such key
    ['SEED_ADMIN_PASSWORD="stale"\n', "hunter2"], // records a DIFFERENT one
  ] as const) {
    const notice = unrecordedPasswordNotice(text, used);
    assert.ok(
      notice,
      `an unrecorded password must be called out — this is what left the fixture reachable by one shell only (text: ${String(text)})`
    );
    assert.match(notice, /\.env\.local/);
    assert.ok(
      !notice.includes(used),
      `the notice must name the file and the key, never the password itself: ${notice}`
    );
  }
});

// ----------------------------------------------------------------------------
// THE DOCUMENTED ROUTE
// ----------------------------------------------------------------------------

test("the docs point a verifier at the password instead of printing one", () => {
  // The invariant is repo-wide: no constant in this repository opens an account
  // on a database anyone else uses. A skill file that prints one is the same
  // failure as a default in the script. Naming the COMMAND was not enough
  // either: a command whose output is a password only its operator knows ends,
  // for everyone else, at a login that rejects them. The row has to say where
  // the value is READ FROM.
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
    assert.match(
      line,
      /--oversight-orgs-only/,
      `an oversight admin's password cell must name the command that sets it: ${line.trim()}`
    );
    assert.match(
      line,
      /\.env\.local/,
      `an oversight admin's password cell must name where the value is read from — the command alone leaves a later verifier at a login that rejects them: ${line.trim()}`
    );
  }

  assert.equal(
    oversightRows,
    2,
    "both oversight admins must still have a row in the credentials table"
  );

  // The block the rows point at: read `.env.local` FIRST, and only seed when it
  // holds nothing. A verifier who re-keys the accounts they could already have
  // opened has changed the fixture out from under whoever recorded it.
  //
  // The documented grep must match every spelling `recordedSeedPassword`
  // accepts, or it reports "nothing recorded" for a value that IS recorded and
  // the verifier re-keys on the strength of it.
  const readFirst = skill.split("\n").find(
    (line) => line.includes("grep") && line.includes("SEED_ADMIN_PASSWORD") // the read-first check
  );
  assert.ok(readFirst, "the skill must show how to read the recorded password");
  const grepPattern = /grep -E '([^']+)' \.env\.local/.exec(readFirst);
  assert.ok(
    grepPattern,
    `the read-first check must be a quoted extended-regex grep over .env.local: ${readFirst}`
  );
  // POSIX classes, because grep must run on BSD and GNU alike; `\s` is only a
  // GNU extension. Translated here so the documented pattern can be exercised.
  const documented = new RegExp(
    grepPattern[1].replace(/\[\[:space:\]\]/g, "\\s")
  );
  for (const recorded of [
    'SEED_ADMIN_PASSWORD="dq"',
    "SEED_ADMIN_PASSWORD=plain",
    "export SEED_ADMIN_PASSWORD=exported",
    "  SEED_ADMIN_PASSWORD=indented",
  ]) {
    assert.ok(
      documented.test(recorded),
      `the documented grep misses a spelling recordedSeedPassword accepts (${recorded}), so a verifier would be told nothing is recorded and re-key accounts someone else recorded`
    );
  }
  assert.ok(
    !documented.test("OLD_SEED_ADMIN_PASSWORD=x"),
    "the documented grep must not match a different variable that merely contains the name"
  );

  assert.match(
    skill,
    /tsx scripts\/seed-dev-db\.ts --oversight-orgs-only/,
    "the skill must still spell out the seed command the credentials rows point at"
  );

  // Appending without a leading newline concatenates onto whatever the file
  // ended with, corrupting both variables, on any .env.local not ending in a
  // newline.
  assert.doesNotMatch(
    skill,
    /echo '.*SEED_ADMIN_PASSWORD.*' >> \.env\.local/,
    "the recording step must not `echo >>` — use printf with a leading newline, or an .env.local with no trailing newline silently joins two variables"
  );
});
