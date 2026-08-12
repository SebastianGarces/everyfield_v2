import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { db } from "@/db";

import {
  OVERSIGHT_ADMIN_EMAILS,
  oversightAdminUpsert,
  recordedSeedPassword,
  unrecordedPasswordNotice,
} from "./oversight-admin-upsert";

// ----------------------------------------------------------------------------
// The additive mode's ACCOUNT WRITES (#304 rounds 9-10).
//
// Round 8 gave `--oversight-orgs-only` a sentinel guard and an operator-chosen
// password, and wrote the admin with `onConflictDoNothing`. That combination is
// a false success: run the mode a second time with a different
// SEED_ADMIN_PASSWORD and it exits 0, prints "Password: the SEED_ADMIN_PASSWORD
// you passed", and leaves the OLD password opening the account.
//
// It is what stranded the fixture, together with the thing round 10 fixes: the
// chosen password was recorded nowhere, so even after the write became an
// upsert, only the operator who typed it could sign in. A verifier following
// the documented command reached a login that rejected them, and every
// interactive acceptance criterion of #304 went unexercised.
//
// WHAT IS ASSERTED, AND HOW. Round 9's version of this file read
// `scripts/seed-dev-db.ts` as text and matched `.onConflictDoUpdate(` in it.
// That is the technique this repo reserves for wiring it genuinely cannot
// observe (a `revalidatePath` call, an RSC call site) — where the SQL itself is
// the invariant, the rule is to render the builder and inspect the statement
// (`memory/invariants/wiki-articles.md`; `src/lib/wiki/tenancy.test.ts`). The
// conflict clause IS the defect, so it is rendered here with `.toSQL()`.
// `.toSQL()` renders; it does not connect — but importing `@/db` constructs the
// Neon client at module load, so a DATABASE_URL must be PRESENT, which
// `pnpm test` and CI both supply as a placeholder.
//
// The end-to-end proof is still two runs against a real scratch database with
// two different passwords — that is evidence for the PR body, not a unit test.
// What these tests do is stop the clause, the key, and the documented route
// from quietly reverting.
// ----------------------------------------------------------------------------

const ADMIN = {
  email: "sending-church-admin@everyfield.app",
  name: "Sarah Sending",
  role: "sending_church_admin",
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
    `no account write here may skip on conflict — that is the round-8 defect. Rendered: ${sql}`
  );
});

test("the upsert sets everything the fixture needs, not only the password", () => {
  const { sql, params } = renderedUpsert();
  const update = sql.slice(sql.toLowerCase().indexOf("do update set"));

  for (const column of [
    '"password_hash"', // the whole point: the operator's chosen credential
    '"role"', // an account demoted by hand is not an oversight admin any more
    '"church_id"', // an oversight admin owns no plant of their own
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

test("both oversight admins are keyed by ADDRESS, so one command restores both sides", () => {
  // The fixture has two halves: the sending church that issues one kind of
  // invitation and the network that issues the other. Round 8 wrote only the
  // sending-church admin, so `admin@everyfield.app` kept whatever
  // `sending_network_id` it had — NULL on the preview's database.
  //
  // The KEY is the address, not the role (#304 round 10). The docs promise a
  // verifier two addresses; a role is not unique by construction, so a lookup
  // by role would move the credential write the day a second `network_admin`
  // joins the fixture.
  assert.deepEqual(
    [...OVERSIGHT_ADMIN_EMAILS],
    ["sending-church-admin@everyfield.app", "admin@everyfield.app"],
    "both oversight admins must be written, and by the address the docs name"
  );

  // The seed script must key its lookup on those addresses. This one assertion
  // IS about the script's wiring rather than about SQL — the loop cannot be
  // imported (the module connects and `process.exit`s at load), so it is pinned
  // on the source, the same technique used for call-site wiring elsewhere.
  const seedSource = readFileSync(
    path.join(process.cwd(), "scripts/seed-dev-db.ts"),
    "utf8"
  );
  assert.match(
    seedSource,
    /for \(const email of OVERSIGHT_ADMIN_EMAILS\)[\s\S]{0,200}user\.email === email/,
    "seedOversightOrgs() must select its rows by address, not by role"
  );
});

// ----------------------------------------------------------------------------
// WHERE THE PASSWORD IS WRITTEN DOWN (#304 round 10)
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
// THE DOCUMENTED ROUTE (#304 rounds 9-10)
// ----------------------------------------------------------------------------

test("the docs point a verifier at the password instead of printing one", () => {
  // The invariant is repo-wide: no constant in this repository opens an account
  // on a database anyone else uses. A skill file that prints one is the same
  // failure as a default in the script — round 8 fixed the script and left the
  // skill row saying `password123`, and the next verifier believed it.
  //
  // Round 9 then named the COMMAND in the row, which was still not enough: a
  // command whose output is a password only its operator knows ends, for
  // everyone else, at a login that rejects them. The row has to say where the
  // value is READ FROM.
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
  assert.match(
    skill,
    /grep '\^SEED_ADMIN_PASSWORD=' \.env\.local/,
    "the skill must show the verifier how to read the recorded password before seeding"
  );
  assert.match(
    skill,
    /tsx scripts\/seed-dev-db\.ts --oversight-orgs-only/,
    "the skill must still spell out the seed command the credentials rows point at"
  );
});
