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
  associationEvents,
  churches,
  coachAssignments,
  launchEvents,
  launches,
  organizationInvitations,
  tasks,
  users,
  sessions,
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
 * Wipe the fixture. `users` and `churches` are deleted UNSCOPED — every row,
 * not only the ones seeded below.
 *
 * That is what makes the everyfield.app retirement (ruled 2026-07-31) converge
 * on a database seeded before it: there is no email predicate to keep in step,
 * so no account can survive by carrying an address this file no longer mentions.
 * Both the old and the new domain go, because everything goes.
 *
 * ⚠️ It also means this is not a scalpel. Point it at a database that other
 * work has been sharing — the deployed development branch, say, which
 * accumulates plants from onboarding runs and accounts from real registrations
 * — and it removes those too. Check what is in there before running it against
 * anything but your own database.
 *
 * What it must NOT touch: `wiki_articles`. The corpus and its
 * `related_article_slugs` cross-links (#317) live only in the database — they
 * are migrated in, never seeded — so a reseed that deleted them would destroy
 * content no script can rebuild. Nothing below names that table, and nothing
 * below may.
 */
async function cleanDatabase(): Promise<void> {
  console.log("🧹 Cleaning database...");

  // Delete in order respecting foreign key constraints
  const deletedSessions = await db.delete(sessions).returning();
  console.log(`   Deleted ${deletedSessions.length} sessions`);

  // Launches (#305/LS-001) go BEFORE users and churches: their journal names an
  // actor (`launch_events.actor_user_id`) and the launch names a church, and
  // neither FK cascades. Milestones, milestone/task links and the journal all
  // cascade from the launch itself.
  const deletedLaunches = await db.delete(launches).returning();
  console.log(`   Deleted ${deletedLaunches.length} launches`);

  // Tasks go BEFORE users, and this is not theoretical: scheduling one launch
  // seeds 23 `launch_prep` tasks (#305/LS-003), and `tasks.created_by_id` →
  // `users.id` does not cascade, so a single use of /launch on a dev database
  // was enough to make `pnpm db:seed` fail on
  // `tasks_created_by_id_users_id_fk`. The launch/milestone JOIN rows cascade
  // from the launch above; the tasks themselves are ordinary tasks owned by the
  // task system and nothing deletes them for us.
  const deletedTasks = await db.delete(tasks).returning();
  console.log(`   Deleted ${deletedTasks.length} tasks`);

  // Oversight association rows. Nothing here seeds them — they are produced by
  // USING the product against the fixture (accepting an invitation binds a
  // plant to an org and writes an audit row) — but `organization_invitations`
  // FKs into both `users` (inviter, responder) and `churches` (target), and
  // `association_events` into both as well, with no cascade on any of them. So
  // one verification run that answered an invitation is enough to make the
  // `users` delete below fail on
  // `organization_invitations_inviter_user_id_users_id_fk`. Audit rows first:
  // `association_events.source_invitation_id` points at an invitation.
  const deletedAssociationEvents = await db
    .delete(associationEvents)
    .returning();
  console.log(
    `   Deleted ${deletedAssociationEvents.length} association events`
  );

  const deletedInvitations = await db
    .delete(organizationInvitations)
    .returning();
  console.log(`   Deleted ${deletedInvitations.length} invitations`);

  // Same shape: a coach assignment names a coach user and a church, neither FK
  // cascading.
  const deletedCoachAssignments = await db.delete(coachAssignments).returning();
  console.log(`   Deleted ${deletedCoachAssignments.length} coach assignments`);

  const deletedUsers = await db.delete(users).returning();
  console.log(`   Deleted ${deletedUsers.length} users`);

  const deletedChurches = await db.delete(churches).returning();
  console.log(`   Deleted ${deletedChurches.length} churches`);

  console.log("✅ Database cleaned\n");
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
