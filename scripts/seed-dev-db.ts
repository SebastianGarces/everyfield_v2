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

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import {
  churches,
  users,
  sessions,
  type NewChurch,
  type NewUser,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

// Parse command line args
const cleanOnly = process.argv.includes("--clean-only");

// Database connection
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

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

  // Summary
  console.log("✅ Database seeded successfully!\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📝 Dev Login Credentials");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   Password for all users: ${DEV_PASSWORD}`);
  console.log();
  console.log("   Network Admin:  admin@everyfield.dev");
  console.log("   Planter:        planter1@everyfield.dev");
  console.log("   Coach:          coach1@everyfield.dev");
  console.log("   Team Member:    team1@everyfield.dev");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
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
