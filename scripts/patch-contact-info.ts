/**
 * One-off patch (ruled 2026-08-02): give every marketing-seed person contact
 * info so people cards stop reading "No contact info" in landing screenshots.
 *
 * The seed now generates email/phone at insert time (see contactInfo() in
 * seed-marketing-church.ts); this script back-fills the CURRENTLY LIVE seed
 * data in place, because a reseed would discard the approved LLM assessment.
 * Touches ONLY persons rows (both marketing churches) where email AND phone
 * are null. Safe to re-run.
 *
 * Usage: pnpm exec tsx scripts/patch-contact-info.ts
 */

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { asc, and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { churches, persons, sendingNetworks } from "../src/db/schema";

config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(connectionString);
const db = drizzle(sql);

const NETWORK_NAME = "North Texas Church Planting Network";

// Mirrors contactInfo() in seed-marketing-church.ts: name-derived email on a
// rotating consumer domain; reserved-fictional (940) 555-01xx phones for ~2/3.
const EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "icloud.com",
  "hotmail.com",
] as const;

async function main() {
  const [network] = await db
    .select({ id: sendingNetworks.id })
    .from(sendingNetworks)
    .where(eq(sendingNetworks.name, NETWORK_NAME))
    .limit(1);
  if (!network) throw new Error(`Network not found: ${NETWORK_NAME}`);

  const churchRows = await db
    .select({ id: churches.id, name: churches.name })
    .from(churches)
    .where(eq(churches.sendingNetworkId, network.id));
  if (churchRows.length === 0) throw new Error("No marketing churches found");

  const usedEmails = new Set<string>();
  let phoneCounter = 0;

  for (const church of churchRows) {
    const rows = await db
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(persons)
      .where(
        and(
          eq(persons.churchId, church.id),
          isNull(persons.email),
          isNull(persons.phone),
          isNull(persons.deletedAt)
        )
      )
      .orderBy(asc(persons.createdAt));

    let patched = 0;
    for (const [i, row] of rows.entries()) {
      const clean = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      let email = `${clean(row.firstName)}.${clean(row.lastName)}@${EMAIL_DOMAINS[i % EMAIL_DOMAINS.length]}`;
      if (usedEmails.has(email)) {
        email = `${clean(row.firstName)}.${clean(row.lastName)}${i}@${EMAIL_DOMAINS[i % EMAIL_DOMAINS.length]}`;
      }
      usedEmails.add(email);
      const phone =
        i % 3 !== 0 && phoneCounter < 100
          ? `(940) 555-01${String(phoneCounter++).padStart(2, "0")}`
          : null;
      await db
        .update(persons)
        .set({ email, phone })
        .where(eq(persons.id, row.id));
      patched++;
    }
    console.log(`${church.name}: patched ${patched} people`);
  }
}

main().then(() => process.exit(0));
