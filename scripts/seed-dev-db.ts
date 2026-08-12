/**
 * Development Database Seed Script
 *
 * Creates sample data for local development:
 * - Churches at various phases
 * - Users with different roles
 *
 * Usage:
 *   bun run scripts/seed-dev-db.ts
 *   bun run scripts/seed-dev-db.ts --clean-only          # Only clean, don't seed
 *   pnpm exec tsx scripts/seed-dev-db.ts --oversight-orgs-only
 *     ...with SEED_ADMIN_PASSWORD recorded in .env.local — see below.
 *
 * The wipe below is not scoped to the rows this file creates — see
 * `cleanDatabase()`. It refuses to run against a database holding the alpha
 * cohort's accounts unless `--allow-protected-db` is passed.
 *
 * EVERY MODE ASKS THE SENTINEL BEFORE IT WRITES (#304 round 8, ruled
 * 2026-08-10). `--oversight-orgs-only` deletes nothing and upserts only the
 * sending network, the sending church and the two oversight admins who belong
 * to them — and for three rounds this header called that "safe to run
 * against the shared development database". It was not. Additive is not safe:
 * the mode WRITES real, enabled oversight logins, and until round 8 their
 * password was a constant in this repository, so every reader of this file held
 * a working credential for those accounts on whatever database it last ran
 * against. The account it created on the shared database was neutralised by
 * hand on 2026-08-10.
 *
 * SINCE ROUND 9 IT RE-KEYS, it does not skip. The writes are upserts on
 * `users.email`: an address that already exists gets the password you passed,
 * plus its role and org FKs put back. Round 8 used `onConflictDoNothing`, which
 * meant a second run exited 0 announcing a password it had not set while the
 * old one still opened the account — a false success on a credential path.
 *
 * So the mode now asks `decideSeedAccounts` the same sentinel question the wipe
 * asks — and refuses with NO override, because there is no honest way to mean
 * "add a login to the database real people use" from a script that also runs
 * unattended. Its password comes from `SEED_ADMIN_PASSWORD` and has no default;
 * unset is a refusal, not a fallback. No mode of this script has a working
 * password for a protected database.
 *
 * ROUND 10 GAVE THE PASSWORD A HOME. Removing the in-repo constant was right
 * and left a hole: the value became whatever the last operator typed, recorded
 * nowhere, so the next agent to validate #304 in a browser could not sign in as
 * either oversight admin — every interactive acceptance criterion went
 * unexercised for want of a credential. Record it in `.env.local`, which this
 * file already loads: gitignored and machine-local, so it is not an in-repo
 * constant, and it is beside `VERCEL_AUTOMATION_BYPASS_SECRET`, which a
 * verifier must open anyway to reach a preview. Running the mode with the value
 * only on the command line still works and now prints a warning saying what it
 * costs. See `src/lib/dev-seed/oversight-admin-upsert.ts`.
 */

import { readFileSync } from "node:fs";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
// Aliased: `sql` is already the neon client below, and drizzle's tagged
// template is a different thing entirely.
import { sql as rawSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import {
  churches,
  launchEvents,
  launches,
  sendingChurches,
  sendingNetworks,
  users,
  type NewChurch,
  type NewUser,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import {
  OVERSIGHT_ADMIN_EMAILS,
  oversightAdminUpsert,
  SEED_ENV_FILE,
  unrecordedPasswordNotice,
} from "../src/lib/dev-seed/oversight-admin-upsert";
import {
  ALLOW_PROTECTED_DB_FLAG,
  decideSeedAccounts,
  decideWipe,
  matchProtectedAccounts,
  SEED_ADMIN_PASSWORD_ENV,
} from "../src/lib/dev-seed/protected-database";

// Load environment variables for scripts.
//
// This is also the route by which `SEED_ADMIN_PASSWORD` reaches the additive
// mode without anyone typing it on a command line: `.env.local` is gitignored
// and machine-local, so recording it there keeps the credential out of the
// repository AND leaves it somewhere a later verifier can read.
config({ path: SEED_ENV_FILE });

/** The env file's text, or `undefined` when there is no such file. */
function readEnvFileText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

// Parse command line args
const cleanOnly = process.argv.includes("--clean-only");
const allowProtectedDb = process.argv.includes(ALLOW_PROTECTED_DB_FLAG);
/**
 * Upsert the oversight orgs and their two admins, and do NOTHING else — no
 * wipe, no churches, no launches.
 *
 * Deleting nothing is not the same as being safe anywhere: this mode writes
 * LOGINS, and re-keys them when they already exist. It asks the sentinel first
 * and refuses on a protected database with no override, and it takes its
 * password from `SEED_ADMIN_PASSWORD`. See `seedOversightOrgs` and
 * `decideSeedAccounts`.
 */
const oversightOrgsOnly = process.argv.includes("--oversight-orgs-only");

// Database connection
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(connectionString);
const db = drizzle(sql);

// ============================================================================
// Password Hashing (matches app hashing)
// ============================================================================

// ============================================================================
// Cleanup Procedure
// ============================================================================

/**
 * Where the wipe starts. The fixture IS "every user and every church", so both
 * are deleted unscoped — every row, not only the ones seeded below.
 *
 * That is what makes the everyfield.app retirement (ruled 2026-07-31) converge
 * on a database seeded before it: there is no email predicate to keep in step,
 * so no account can survive by carrying an address this file no longer mentions.
 * Both the old and the new domain go, because everything goes.
 */
const WIPE_ROOTS = ["users", "churches"] as const;

/**
 * Tables the wipe refuses to enter, whatever the foreign-key graph says.
 *
 * The wiki corpus is church-scoped (`church_id`, null = global), so the graph
 * walk below reaches it from `churches` like any other dependent — and deleting
 * it would destroy the articles and their `related_article_slugs` cross-links
 * (#317), which are migrated into the database and rebuilt by no script.
 * `wiki_sections` is the corpus's own parent and is not seeded either.
 *
 * Protection means two things: never deleted, and never walked THROUGH, so
 * nothing downstream of them is dragged in either.
 */
const PROTECTED_TABLES = new Set(["wiki_articles", "wiki_sections"]);

interface ForeignKey {
  child: string;
  parent: string;
  /** The child column, for single-column keys — used by the preflight below. */
  column: string | null;
}

/** Postgres identifiers this script is willing to interpolate into SQL. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function quoteIdentifier(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Refusing to interpolate unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Every foreign key in `public`, read from the catalog rather than from the
 * Drizzle schema.
 *
 * The catalog is what the DELETEs will actually be checked against, and it does
 * not go stale: a table added next month arrives here without anyone
 * remembering to add it to a list in this file. That is the whole point — the
 * hand-maintained list this replaced fell behind three times (launch journals
 * in #305, launch-prep tasks in #305/LS-003, answered invitations in #304), and
 * each time the symptom was the same: `pnpm db:seed` dies halfway through a
 * partially wiped database.
 */
async function foreignKeys(): Promise<ForeignKey[]> {
  const rows = (await sql`
    SELECT
      child.relname::text  AS child,
      parent.relname::text AS parent,
      CASE
        WHEN array_length(con.conkey, 1) = 1
        THEN (
          SELECT att.attname::text
          FROM pg_attribute att
          WHERE att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
        )
        ELSE NULL
      END AS column
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace nsp ON nsp.oid = child.relnamespace
    WHERE con.contype = 'f' AND nsp.nspname = 'public'
  `) as { child: string; parent: string; column: string | null }[];

  return rows.map((row) => ({
    child: row.child,
    parent: row.parent,
    column: row.column,
  }));
}

/**
 * The tables the wipe covers, in an order every FK survives: a table is always
 * listed before the tables it points at.
 *
 * Reachability, not enumeration: start at the roots and take everything that
 * points at something already in the set, transitively. A row that cannot be
 * reached from a user or a church is not part of the fixture and is left alone
 * — `sending_networks`, `sending_churches` and `wiki_sections` are parents of
 * the fixture, not dependents of it.
 *
 * Since #304 round 6 the seed DOES create one of each oversight org, so that a
 * `sending_church_admin` has somewhere to belong. They stay outside the wipe
 * anyway: deleting them would take org rows this script did not create (every
 * hand-registered network, and every org an earlier harness run left behind).
 * The seed's own two rows carry PINNED ids inserted with
 * `onConflictDoNothing`, so surviving the wipe costs nothing — a re-seed
 * re-inserts the same keys instead of accumulating duplicates.
 *
 * Self-referencing keys (`ministry_teams.reports_to_team_id` and friends) are
 * dropped from the ordering: `DELETE FROM t` removes the referencing rows in
 * the same statement, so they cannot block themselves.
 */
function planWipe(keys: ForeignKey[]): string[] {
  const dependents = new Map<string, Set<string>>();
  for (const { child, parent } of keys) {
    if (child === parent) continue;
    if (!dependents.has(parent)) dependents.set(parent, new Set());
    dependents.get(parent)!.add(child);
  }

  const covered = new Set<string>();
  const queue: string[] = [];
  for (const root of WIPE_ROOTS) {
    if (PROTECTED_TABLES.has(root)) continue;
    covered.add(root);
    queue.push(root);
  }
  while (queue.length > 0) {
    const table = queue.shift()!;
    for (const child of dependents.get(table) ?? []) {
      if (covered.has(child) || PROTECTED_TABLES.has(child)) continue;
      covered.add(child);
      queue.push(child);
    }
  }

  // Children first. A table is emitted once every covered table pointing at it
  // has been emitted.
  const order: string[] = [];
  const emitted = new Set<string>();
  while (emitted.size < covered.size) {
    const ready = [...covered]
      .filter((table) => !emitted.has(table))
      .filter((table) =>
        [...(dependents.get(table) ?? [])]
          .filter((child) => covered.has(child))
          .every((child) => emitted.has(child))
      )
      .sort();

    if (ready.length === 0) {
      // A cycle of non-cascading keys. Nothing here can be deleted safely one
      // statement at a time, and guessing would leave a half-wiped database, so
      // say which tables are involved and stop.
      const stuck = [...covered].filter((table) => !emitted.has(table)).sort();
      throw new Error(
        `Cannot order the wipe — these tables reference each other in a cycle: ${stuck.join(", ")}`
      );
    }

    for (const table of ready) {
      emitted.add(table);
      order.push(table);
    }
  }

  return order;
}

/**
 * Refuse to start if a protected table holds a row that the wipe would orphan.
 *
 * `wiki_articles.church_id` is the live case: a church-scoped article makes the
 * `churches` delete fail on its FK, and the honest answer is NOT to delete the
 * article — it is content, not fixture. Better to stop before the first DELETE
 * than to discover it after the users are gone.
 */
async function assertProtectedTablesAreSafe(
  keys: ForeignKey[],
  wiped: Set<string>
): Promise<void> {
  for (const key of keys) {
    if (!PROTECTED_TABLES.has(key.child)) continue;
    if (!wiped.has(key.parent) || key.column === null) continue;

    const result = await db.execute(
      rawSql.raw(
        `SELECT count(*)::int AS n FROM ${quoteIdentifier(key.child)} WHERE ${quoteIdentifier(key.column)} IS NOT NULL`
      )
    );
    const orphaned =
      (result as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;

    if (orphaned > 0) {
      throw new Error(
        `Refusing to clean: ${key.child} has ${orphaned} row(s) whose ${key.column} points at ${key.parent}, ` +
          `which this wipe deletes. ${key.child} is content, not fixture — it is migrated in and no script can rebuild it (#317). ` +
          `Re-point or remove those rows by hand first.`
      );
    }
  }
}

/**
 * Refuse to wipe a database that people share (#326, ruled 2026-08-09).
 *
 * This is not a scalpel: point it at the deployed development branch — which
 * accumulates plants from onboarding runs and accounts from real registrations
 * — and it removes those too. Until this guard existed the only thing stopping
 * that was a comment, plus the accident that the wipe used to CRASH partway
 * through on a database with launch history. `planWipe()` fixed the crash,
 * which means it also removed the protection.
 *
 * The decision lives in `src/lib/dev-seed/protected-database.ts` as a pure
 * function so it has tests; all this does is answer its one question — which
 * protected accounts are in this database. Every user's address is read rather
 * than filtered in SQL, because the matching rules (whole-address equality,
 * case, whitespace) are the part worth testing, and a dev database is small.
 *
 * A query that throws — no `users` table yet, bad credentials — propagates and
 * aborts the run. An unanswered question about a destructive operation is a no.
 */
async function assertDatabaseIsWipeable(): Promise<void> {
  const rows = await db.select({ email: users.email }).from(users);
  const decision = decideWipe({
    accountsFound: matchProtectedAccounts(rows.map((row) => row.email)),
    overrideRequested: allowProtectedDb,
  });

  switch (decision.verdict) {
    case "proceed":
      return;
    case "proceed-with-override":
      console.warn(`⚠️  ${decision.warning}\n`);
      return;
    case "refuse":
      throw new Error(decision.message);
  }
}

/**
 * Refuse to write an ACCOUNT on a database people share, and refuse to write one
 * with a password this repository knows (#304 round 8, ruled 2026-08-10).
 *
 * The same query as `assertDatabaseIsWipeable` — the sentinel question does not
 * change with the mode asking it, only the answer's consequence does — handed to
 * `decideSeedAccounts`, whose refusals have no override. Returns the password to
 * hash, so there is no path through this function that leaves the caller holding
 * a default.
 *
 * A query that throws propagates and aborts the run, for the reason the wipe's
 * guard does: an unanswered question about which database this is, is a no.
 */
async function passwordForSeededAccounts(): Promise<string> {
  const rows = await db.select({ email: users.email }).from(users);
  const decision = decideSeedAccounts({
    accountsFound: matchProtectedAccounts(rows.map((row) => row.email)),
    password: process.env[SEED_ADMIN_PASSWORD_ENV],
  });

  if (decision.verdict === "refuse") throw new Error(decision.message);

  return decision.password;
}

/**
 * Wipe the fixture — every user and every church, not only the seeded ones.
 *
 * The guard above runs first, before the FK graph is even read: nothing here is
 * recoverable, so the check that can say no has to happen before the work that
 * cannot be undone.
 */
async function cleanDatabase(): Promise<void> {
  console.log("🧹 Cleaning database...");

  await assertDatabaseIsWipeable();

  const keys = await foreignKeys();
  const order = planWipe(keys);
  await assertProtectedTablesAreSafe(keys, new Set(order));

  let total = 0;
  for (const table of order) {
    const result = await db.execute(
      rawSql.raw(`DELETE FROM ${quoteIdentifier(table)}`)
    );
    const deleted =
      (result as unknown as { rowCount: number | null }).rowCount ?? 0;
    total += deleted;
    if (deleted > 0) console.log(`   Deleted ${deleted} ${table}`);
  }

  console.log(
    `✅ Database cleaned — ${total} row(s) across ${order.length} tables\n`
  );
}

// ============================================================================
// Seed Data
// ============================================================================

/**
 * The `onboarding_completed_at` stamp every seeded church carries (#326, F12 /
 * OB-001).
 *
 * A church row whose `onboarding_completed_at` is null means "the onboarding
 * flow still owns this planter's dashboard" (`shouldShowOnboarding`,
 * `src/lib/onboarding/steps.ts`), so an unstamped fixture puts every seeded
 * planter into the wizard instead of the dashboard the fixture exists to show.
 * These plants are fixtures of FINISHED onboarding — they arrive with a phase,
 * a launch and a team — so the stamp is not a convenience, it is the truth
 * about them.
 *
 * `now()` rather than a JS `Date`: Postgres evaluates it inside the same INSERT
 * that fills `created_at` from `DEFAULT now()`, so the two are the SAME instant
 * rather than milliseconds apart. Seeded onboarding finished when the row was
 * created; that is the only honest value a fixture has.
 *
 * To see the onboarding flow itself, register a new planter — registration
 * creates a church with a null stamp, which is what the flow is for.
 */
function onboardingCompletedAtSeedStamp() {
  return rawSql`now()`;
}

const SEED_CHURCHES: NewChurch[] = [
  { name: "Grace Community Church", currentPhase: 0 },
  { name: "New Hope Fellowship", currentPhase: 1 },
  { name: "Riverside Church Plant", currentPhase: 2 },
  { name: "Downtown Mission Church", currentPhase: 3 },
  { name: "Westside Community", currentPhase: 4 },
];

/**
 * Launches, by index into `SEED_CHURCHES` (#305 / LS-001).
 *
 * Not every plant gets one, deliberately: "no launch at all" is a real and very
 * common state (a phase-0 plant has nothing to schedule), and a seed where every
 * church has a date makes the empty-state branch of every countdown surface
 * unreachable in dev. Offsets are relative to run time so a re-seed keeps the
 * countdown fresh.
 */
const SEED_LAUNCHES: {
  churchIndex: number;
  /** Days from today; negative = already launched. */
  offsetDays: number;
  status: "scheduled" | "postponed" | "completed";
}[] = [
  // Grace Community (phase 0) and New Hope (phase 1): no launch yet.
  { churchIndex: 2, offsetDays: 180, status: "scheduled" },
  { churchIndex: 3, offsetDays: 63, status: "postponed" },
  { churchIndex: 4, offsetDays: 21, status: "scheduled" },
];

/** A `date`-column value (yyyy-mm-dd, UTC) `days` from today. */
function launchInDays(days: number): string {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// Password for all dev users: "password123"
const DEV_PASSWORD = "password123";

/**
 * Email domain for every seeded dev account. `everyfield.app` is the product
 * domain (ruled 2026-07-31); the placeholder domain it replaced is retired
 * repo-wide, and this constant is why there is one place to change rather than
 * nine literals to keep in step. Docs that hand an agent a login —
 * `.claude/skills/browser-validation/SKILL.md` above all — quote these
 * addresses, so a change here is a change there.
 */
const DEV_EMAIL_DOMAIN = "everyfield.app";

/**
 * The one oversight ORG the seed owns, with PINNED ids (#304 round 6).
 *
 * Until now this script created no `sending_churches` row at all, which had a
 * consequence nobody had written down: the whole sending-church-admin half of
 * the product was unreachable by any real login. The dev database held exactly
 * two oversight accounts, both `network_admin`, and `sending_church_admin` —
 * a role with its own settings screen, its own association view and its own
 * leave dialog — had zero rows. A surface no seeded account can open is a
 * surface no browser validation can cover, so #304's WS3 shipped unphotographed
 * and the G3 gate failed on evidence that could not exist.
 *
 * The ids are pinned and the inserts are `onConflictDoNothing`, which is what
 * keeps the old property true in the way that matters. `planWipe()` reaches
 * these tables from neither root, so the wipe still does not delete them — and
 * because a re-seed re-inserts the same primary keys, it does not accumulate a
 * second copy either. Widening the wipe instead would have deleted org rows
 * this script did not create, which is the one thing the reachability rule
 * exists to prevent.
 *
 * The sending church is deliberately left with NO network. Unassociated IS the
 * WS3 surface — an admin answering an invitation — and the associated view with
 * its leave control is one accept away, reached the way a user reaches it.
 */
const SEED_SENDING_NETWORK = {
  id: "d1000000-0000-4000-8000-000000000001",
  name: "Dev Church Planting Network",
} as const;

const SEED_SENDING_CHURCH = {
  id: "d2000000-0000-4000-8000-000000000002",
  name: "Dev Sending Church",
  sendingNetworkId: null,
} as const;

interface SeedUser extends Omit<NewUser, "passwordHash" | "churchId"> {
  churchIndex: number | null; // Index into SEED_CHURCHES, null for network admin
}

const SEED_USERS: SeedUser[] = [
  // Network admin (no church)
  {
    email: `admin@${DEV_EMAIL_DOMAIN}`,
    name: "Network Admin",
    role: "network_admin",
    churchIndex: null,
    sendingNetworkId: SEED_SENDING_NETWORK.id,
  },
  // Sending church admin (no church of their own — they oversee plants).
  // Their `sending_church_id` is what `getAccessibleChurchIds` reads, and it is
  // also what makes `/settings/association` render the admin's view rather than
  // the planter's. Without this row that branch had no way to be opened.
  {
    email: `sending-church-admin@${DEV_EMAIL_DOMAIN}`,
    name: "Sarah Sending",
    role: "sending_church_admin",
    churchIndex: null,
    sendingChurchId: SEED_SENDING_CHURCH.id,
  },
  // Planters (one per church)
  {
    email: `planter1@${DEV_EMAIL_DOMAIN}`,
    name: "John Planter",
    role: "planter",
    churchIndex: 0,
  },
  {
    email: `planter2@${DEV_EMAIL_DOMAIN}`,
    name: "Samuel Planter",
    role: "planter",
    churchIndex: 1,
  },
  {
    email: `planter3@${DEV_EMAIL_DOMAIN}`,
    name: "Mike Planter",
    role: "planter",
    churchIndex: 2,
  },
  // Coaches
  {
    email: `coach1@${DEV_EMAIL_DOMAIN}`,
    name: "David Coach",
    role: "coach",
    churchIndex: 0,
  },
  {
    email: `coach2@${DEV_EMAIL_DOMAIN}`,
    name: "Emily Coach",
    role: "coach",
    churchIndex: 1,
  },
  // Team members
  {
    email: `team1@${DEV_EMAIL_DOMAIN}`,
    name: "Alex Team",
    role: "team_member",
    churchIndex: 0,
  },
  {
    email: `team2@${DEV_EMAIL_DOMAIN}`,
    name: "Jordan Team",
    role: "team_member",
    churchIndex: 0,
  },
  {
    email: `team3@${DEV_EMAIL_DOMAIN}`,
    name: "Casey Team",
    role: "team_member",
    churchIndex: 1,
  },
];

// ============================================================================
// Seed Procedure
// ============================================================================

/**
 * The oversight orgs and the two admins who belong to them — every write here
 * is an upsert, and NOTHING here deletes.
 *
 * WHY IT EXISTS. The full seed's wipe takes every user and every church
 * unscoped, so "just re-seed to get the fixture" is not an option on any
 * database worth keeping; the alternative — hand-inserting rows during a
 * validation run — is the reproducibility failure ruled out in round 4 of #304.
 * A committed, idempotent, additive script path is neither.
 *
 * WHAT IT IS NOT. It is not "the safe mode", and this docblock said so for three
 * rounds. The last writes below SET A PASSWORD ON TWO LOGINS, which on a
 * database real people use are live credentials no matter how carefully nothing
 * was deleted — and since round 9 they re-key an account that already exists
 * rather than skipping it, so the reach is larger, not smaller. Its caller must
 * therefore have cleared `decideSeedAccounts` — the sentinel, then the password
 * — and the `passwordHash` parameter is how that is enforced here: this
 * function cannot mint one, so there is no way to reach the writes without
 * having answered both questions first.
 */
async function insertOversightOrgs(): Promise<void> {
  await db
    .insert(sendingNetworks)
    .values(SEED_SENDING_NETWORK)
    .onConflictDoNothing();
  await db
    .insert(sendingChurches)
    .values(SEED_SENDING_CHURCH)
    .onConflictDoNothing();

  console.log(`   [network]        ${SEED_SENDING_NETWORK.name}`);
  console.log(`   [sending church] ${SEED_SENDING_CHURCH.name}`);
}

/**
 * Restore BOTH sides of the oversight fixture, keyed by ADDRESS.
 *
 * One command has to leave a usable oversight fixture behind, and there are two
 * halves to it: the sending church that issues an invitation, and the network
 * that issues the other kind. Round 8 wrote only the `sending_church_admin`, so
 * `admin@everyfield.app` kept whatever `sending_network_id` it happened to have
 * — NULL on the preview's database, which makes `/oversight/invitations` render
 * "Set up your network first" and hands a verifier no way to send anything.
 *
 * Round 9 fixed that by looping the two ROLES and taking whichever `SEED_USERS`
 * entry carried each one. Round 10 keys on the ADDRESS instead
 * (`OVERSIGHT_ADMIN_EMAILS`), because the address is what the documentation
 * promises a verifier and the role is not unique by construction — a second
 * `network_admin` in the fixture would silently move the credential write to
 * another account. The lookup is total: an address this file no longer seeds is
 * a thrown error, not a skipped admin.
 *
 * The statement itself lives in `src/lib/dev-seed/oversight-admin-upsert.ts` so
 * a test can render it with `.toSQL()`.
 */
async function seedOversightOrgs(passwordHash: string): Promise<void> {
  await insertOversightOrgs();

  const now = new Date();

  for (const email of OVERSIGHT_ADMIN_EMAILS) {
    const admin = SEED_USERS.find((user) => user.email === email);
    if (!admin) throw new Error(`no ${email} in SEED_USERS`);
    if (!admin.name) throw new Error(`${email} has no name in SEED_USERS`);

    await oversightAdminUpsert(
      db,
      {
        email: admin.email,
        name: admin.name,
        role: admin.role,
        sendingChurchId: admin.sendingChurchId ?? null,
        sendingNetworkId: admin.sendingNetworkId ?? null,
      },
      passwordHash,
      now
    );

    console.log(`   [${admin.role}] ${admin.email}`);
  }
}

async function seedDatabase(): Promise<void> {
  console.log("🌱 Seeding database...\n");

  // 1. Create churches
  console.log("📍 Creating churches...");
  const createdChurches = await db
    .insert(churches)
    .values(
      SEED_CHURCHES.map((church) => ({
        ...church,
        onboardingCompletedAt: onboardingCompletedAtSeedStamp(),
      }))
    )
    .returning();

  for (const church of createdChurches) {
    console.log(`   [Phase ${church.currentPhase}] ${church.name}`);
  }
  console.log();

  // 2. Create the oversight orgs the admins point at.
  //
  // These two tables are outside the wipe (see `planWipe`), so the inserts are
  // idempotent on their pinned primary keys rather than unconditional — a
  // re-seed must not leave a second "Dev Sending Church" behind.
  console.log("🏛️  Creating oversight orgs...");
  await insertOversightOrgs();
  console.log();

  // 3. Create users
  console.log("👥 Creating users...");
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const usersToCreate: NewUser[] = SEED_USERS.map((user) => ({
    email: user.email,
    name: user.name,
    role: user.role,
    passwordHash,
    churchId:
      user.churchIndex !== null ? createdChurches[user.churchIndex].id : null,
    sendingChurchId: user.sendingChurchId ?? null,
    sendingNetworkId: user.sendingNetworkId ?? null,
  }));

  const createdUsers = await db.insert(users).values(usersToCreate).returning();

  for (const user of createdUsers) {
    const church = createdChurches.find((c) => c.id === user.churchId);
    const churchName = church ? church.name : "No church";
    console.log(`   [${user.role}] ${user.email} - ${churchName}`);
  }
  console.log();

  // 4. Create launches (#305 / LS-001)
  console.log("🚀 Creating launches...");
  for (const seed of SEED_LAUNCHES) {
    const church = createdChurches[seed.churchIndex];
    const targetDate = launchInDays(seed.offsetDays);
    const [launch] = await db
      .insert(launches)
      .values({ churchId: church.id, targetDate, status: seed.status })
      .returning({ id: launches.id });

    // The journal is seeded too (LS-002). Its actor is the plant's planter —
    // there is no such thing as an unattributed date change in the product, so
    // there should not be one in the seed either. A church with no planter user
    // simply gets no journal rather than a fabricated actor.
    const planter = createdUsers.find(
      (u) => u.churchId === church.id && u.role === "planter"
    );
    if (planter) {
      await db.insert(launchEvents).values({
        launchId: launch.id,
        churchId: church.id,
        event: "scheduled",
        previousTargetDate: null,
        targetDate,
        previousStatus: "planning",
        status: seed.status,
        actorUserId: planter.id,
      });
    }
    console.log(`   [${seed.status}] ${church.name} → ${targetDate}`);
  }
  console.log();

  // Wiki cross-links are NOT seeded here (#317). `related_article_slugs` now
  // holds links derived from each article's own prose by
  // `scripts/migrate-wiki-related-sections.ts`, so the corpus carries them and
  // a fixture would only overwrite real data with invented data.

  // Summary
  console.log("✅ Database seeded successfully!\n");
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  );
  console.log("📝 Dev Login Credentials");
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  );
  console.log(`   Password for all users: ${DEV_PASSWORD}`);
  console.log();
  console.log(`   Network Admin:  admin@${DEV_EMAIL_DOMAIN}`);
  console.log(
    `   Sending Church Admin: sending-church-admin@${DEV_EMAIL_DOMAIN}`
  );
  console.log(`   Planter:        planter1@${DEV_EMAIL_DOMAIN}`);
  console.log(`   Coach:          coach1@${DEV_EMAIL_DOMAIN}`);
  console.log(`   Team Member:    team1@${DEV_EMAIL_DOMAIN}`);
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
  );
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    // Checked BEFORE `cleanDatabase()`, which is the whole point: this mode
    // must never reach the wipe.
    if (oversightOrgsOnly) {
      // ...and the sentinel is asked before THIS mode writes anything either
      // (#304 round 8). It throws on refuse, which `main`'s catch turns into a
      // non-zero exit, so a protected database gets an error and no rows — not
      // a warning and an oversight admin account.
      const password = await passwordForSeededAccounts();

      console.log("🏛️  Upserting oversight orgs (no wipe, no other rows)...");
      await seedOversightOrgs(await hashPassword(password));
      console.log(
        `\n   Password: the ${SEED_ADMIN_PASSWORD_ENV} you passed (not printed)`
      );

      // ...and SAY SO when nothing recorded it (#304 round 10). The mode has
      // just re-keyed two logins; if the value lives only in this shell, the
      // next person to validate in a browser cannot sign in, which is precisely
      // how the fixture was stranded between rounds 8 and 10. Never printed —
      // the notice names the file and the key, and the operator holds the
      // value.
      const notice = unrecordedPasswordNotice(
        readEnvFileText(SEED_ENV_FILE),
        password
      );
      console.log(
        notice ? `\n${notice}\n` : `   Recorded in ${SEED_ENV_FILE}\n`
      );

      process.exit(0);
    }

    await cleanDatabase();

    if (!cleanOnly) {
      await seedDatabase();
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
