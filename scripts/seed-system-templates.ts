// ============================================================================
// Seed System Templates
// ============================================================================
//
// Run via: npx tsx scripts/seed-system-templates.ts
//
// Creates platform-provided system templates. Idempotent — skips templates
// that already exist (matched by name + is_system).
//
// A one-shot script, NOT a library module: it loads .env.local and opens its
// own connection at module scope, then executes on import. That is why it
// lives in scripts/ beside its peers — importing it from app code would
// rewrite every system template in whatever DATABASE_URL points at.
//
// WHAT it seeds is `SYSTEM_TEMPLATES` (`@/lib/communication/system-templates`),
// which is plain data and importable without any of the above. This file is
// only the write half: connect, upsert by name, report. Keeping the catalog out
// of it is what lets a test read the catalog (#612).
// ============================================================================

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import { messageTemplates } from "@/db/schema/communication";
import { SYSTEM_TEMPLATES } from "@/lib/communication/system-templates";

// Load env before connecting
config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function seed() {
  console.log("[SEED] Starting system template seed...");

  for (const template of SYSTEM_TEMPLATES) {
    // Check if already exists
    const [existing] = await db
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.name, template.name),
          eq(messageTemplates.isSystem, true)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing system template with latest content
      await db
        .update(messageTemplates)
        .set({
          description: template.description,
          category: template.category,
          channel: template.channel,
          subject: template.subject,
          body: template.body,
          mergeFields: template.mergeFields,
        })
        .where(eq(messageTemplates.id, existing.id));
      console.log(`[SEED] Updated "${template.name}"`);
      continue;
    }

    await db.insert(messageTemplates).values({
      churchId: null,
      name: template.name,
      description: template.description,
      category: template.category,
      channel: template.channel,
      subject: template.subject,
      body: template.body,
      mergeFields: template.mergeFields,
      isSystem: true,
      sourceTemplateId: null,
    });

    console.log(`[SEED] Created "${template.name}"`);
  }

  console.log("[SEED] System template seed complete!");
}

// Allow direct execution
seed().catch(console.error);
