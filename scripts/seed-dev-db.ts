/**
 * Development Database Seed Script
 *
 * Creates sample data for local development:
 * - Churches at various phases
 * - Users with different roles
 *
 * Usage:
 *   bun run scripts/seed-dev-db.ts
 *   bun run scripts/seed-dev-db.ts --clean-only       # Only clean, don't seed
 *   bun run scripts/seed-dev-db.ts --wiki-links-only  # Only the wiki cross-link
 *                                                     # fixture; cleans nothing
 */

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import {
  churches,
  launchEvents,
  launches,
  tasks,
  users,
  sessions,
  wikiArticles,
  type NewChurch,
  type NewUser,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

// Load environment variables for scripts
config({ path: ".env.local" });

// Parse command line args
const cleanOnly = process.argv.includes("--clean-only");
const wikiLinksOnly = process.argv.includes("--wiki-links-only");

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

  const deletedUsers = await db.delete(users).returning();
  console.log(`   Deleted ${deletedUsers.length} users`);

  const deletedChurches = await db.delete(churches).returning();
  console.log(`   Deleted ${deletedChurches.length} churches`);

  console.log("✅ Database cleaned\n");
}

// ============================================================================
// Seed Data
// ============================================================================

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

interface SeedUser extends Omit<NewUser, "passwordHash" | "churchId"> {
  churchIndex: number | null; // Index into SEED_CHURCHES, null for network admin
}

const SEED_USERS: SeedUser[] = [
  // Network admin (no church)
  {
    email: "admin@everyfield.dev",
    name: "Network Admin",
    role: "network_admin",
    churchIndex: null,
  },
  // Planters (one per church)
  {
    email: "planter1@everyfield.dev",
    name: "John Planter",
    role: "planter",
    churchIndex: 0,
  },
  {
    email: "planter2@everyfield.dev",
    name: "Sarah Planter",
    role: "planter",
    churchIndex: 1,
  },
  {
    email: "planter3@everyfield.dev",
    name: "Mike Planter",
    role: "planter",
    churchIndex: 2,
  },
  // Coaches
  {
    email: "coach1@everyfield.dev",
    name: "David Coach",
    role: "coach",
    churchIndex: 0,
  },
  {
    email: "coach2@everyfield.dev",
    name: "Emily Coach",
    role: "coach",
    churchIndex: 1,
  },
  // Team members
  {
    email: "team1@everyfield.dev",
    name: "Alex Team",
    role: "team_member",
    churchIndex: 0,
  },
  {
    email: "team2@everyfield.dev",
    name: "Jordan Team",
    role: "team_member",
    churchIndex: 0,
  },
  {
    email: "team3@everyfield.dev",
    name: "Casey Team",
    role: "team_member",
    churchIndex: 1,
  },
];

// ============================================================================
// Wiki cross-links (#317 / W-009)
//
// `wiki_articles.related_article_slugs` is AUTHORED content, and nothing in the
// corpus authors it: all 91 published global articles ship the column as NULL.
// So "an article with non-empty relatedArticleSlugs renders a Related Articles
// section" is a feature no environment can currently show — the code path is
// correct and unreachable, which makes it unverifiable rather than done.
//
// This fixture is the substrate that makes it reachable in development. Two
// articles carry cross-links, chosen so ONE page proves several behaviours at
// once rather than needing a tour:
//
//   - `pre-launch/the-final-3-4-weeks` is sort_order 1 of the 8 articles under
//     `pre-launch/`, i.e. the FIRST — so it renders Next but no Previous.
//   - `pre-launch/final-checklist-review` is sort_order 8, the LAST — Previous
//     but no Next.
//   - Each list carries one deliberately DEAD slug. The column has no foreign
//     key behind it, so a renamed or unpublished target is the normal case;
//     dropping it (rather than rendering a link into a 404) is the behaviour,
//     and it is only observable if something exercises it.
//   - Every other article keeps a NULL column, which is what proves the
//     "no related slugs renders no empty section" criterion.
//
// The write is an idempotent UPDATE keyed by slug — it SETS the array rather
// than appending, so re-running converges instead of accumulating, and it
// touches only global (`church_id IS NULL`) published rows.
// ============================================================================

const DEAD_SLUG_MARKER = "this-article-was-renamed";

const SEED_WIKI_CROSS_LINKS: { slug: string; related: string[] }[] = [
  {
    slug: "pre-launch/the-final-3-4-weeks",
    related: [
      "pre-launch/final-checklist-review",
      "pre-launch/the-promotion-plan",
      // Dead on purpose: must be dropped, not rendered.
      `pre-launch/${DEAD_SLUG_MARKER}`,
    ],
  },
  {
    slug: "pre-launch/final-checklist-review",
    related: [
      "pre-launch/the-final-3-4-weeks",
      "launch-sunday/launch-day-guide",
      // Dead on purpose, and cross-section: also not rendered.
      `launch-sunday/${DEAD_SLUG_MARKER}`,
    ],
  },
];

/**
 * Point two published global articles at their siblings. Safe to re-run, and
 * safe to run alone (`--wiki-links-only`) — it deletes nothing.
 */
async function seedWikiCrossLinks(): Promise<void> {
  console.log("🔗 Linking wiki articles...");

  for (const { slug, related } of SEED_WIKI_CROSS_LINKS) {
    const updated = await db
      .update(wikiArticles)
      .set({ relatedArticleSlugs: related, updatedAt: new Date() })
      .where(
        and(
          eq(wikiArticles.slug, slug),
          isNull(wikiArticles.churchId),
          eq(wikiArticles.status, "published")
        )
      )
      .returning({ slug: wikiArticles.slug });

    if (updated.length === 0) {
      // Not fatal: a database that has never had the wiki corpus loaded simply
      // has nothing to link, and the rest of the seed is still valid.
      console.log(`   ⚠️  No published global article at ${slug} — skipped`);
      continue;
    }

    console.log(`   ${slug} → ${related.length} slug(s)`);
  }

  console.log();
}

// ============================================================================
// Seed Procedure
// ============================================================================

async function seedDatabase(): Promise<void> {
  console.log("🌱 Seeding database...\n");

  // 1. Create churches
  console.log("📍 Creating churches...");
  const createdChurches = await db
    .insert(churches)
    .values(SEED_CHURCHES)
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

  // 4. Link wiki articles to each other (#317 / W-009). Not church data, so it
  // survives `cleanDatabase` — it is re-applied here only so a full seed leaves
  // the Related Articles section reachable without a second command.
  await seedWikiCrossLinks();

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
  console.log("   Network Admin:  admin@everyfield.dev");
  console.log("   Planter:        planter1@everyfield.dev");
  console.log("   Coach:          coach1@everyfield.dev");
  console.log("   Team Member:    team1@everyfield.dev");
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
  );
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    // `--wiki-links-only` is the non-destructive door: it applies the wiki
    // cross-link fixture to a database that already has the corpus without
    // wiping the churches, users and launches on it.
    if (wikiLinksOnly) {
      await seedWikiCrossLinks();
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
