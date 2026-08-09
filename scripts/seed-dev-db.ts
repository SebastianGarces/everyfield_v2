/**
 * Development Database Seed Script
 *
 * Creates sample data for local development:
 * - Churches at various phases
 * - Users with different roles
 *
 * Usage:
 *   bun run scripts/seed-dev-db.ts
 *   bun run scripts/seed-dev-db.ts --clean-only  # Only clean, don't seed
 */

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
  users,
  type NewChurch,
  type NewUser,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

// Load environment variables for scripts
config({ path: ".env.local" });

// Parse command line args
const cleanOnly = process.argv.includes("--clean-only");

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
 * the fixture, not dependents of it, and this script never created them.
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
 * Wipe the fixture.
 *
 * ⚠️ This is not a scalpel. Point it at a database that other work has been
 * sharing — the deployed development branch, say, which accumulates plants from
 * onboarding runs and accounts from real registrations — and it removes those
 * too. Check what is in there before running it against anything but your own
 * database.
 */
async function cleanDatabase(): Promise<void> {
  console.log("🧹 Cleaning database...");

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
    name: "Sarah Planter",
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

  // 2. Create users
  console.log("👥 Creating users...");
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const usersToCreate: NewUser[] = SEED_USERS.map((user) => ({
    email: user.email,
    name: user.name,
    role: user.role,
    passwordHash,
    churchId:
      user.churchIndex !== null ? createdChurches[user.churchIndex].id : null,
  }));

  const createdUsers = await db.insert(users).values(usersToCreate).returning();

  for (const user of createdUsers) {
    const church = createdChurches.find((c) => c.id === user.churchId);
    const churchName = church ? church.name : "No church";
    console.log(`   [${user.role}] ${user.email} - ${churchName}`);
  }
  console.log();

  // 3. Create launches (#305 / LS-001)
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
