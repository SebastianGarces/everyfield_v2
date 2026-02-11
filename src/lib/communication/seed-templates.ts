// ============================================================================
// Seed System Templates
// ============================================================================
//
// Run via: npx tsx src/lib/communication/seed-templates.ts
//
// Creates platform-provided system templates. Idempotent — skips templates
// that already exist (matched by name + is_system).
// ============================================================================

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import { messageTemplates } from "../../db/schema/communication";

// Load env before connecting
config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

const systemTemplates = [
  // ---------------------------------------------------------------------------
  // Vision Meeting Templates
  // ---------------------------------------------------------------------------
  {
    name: "Vision Meeting Invitation",
    description:
      "Invite someone to a vision meeting. Includes RSVP confirmation links.",
    category: "meeting_invitation" as const,
    channel: "email" as const,
    subject: "You're Invited: {{meeting_title}} — {{church_name}}",
    body: `Hi {{first_name}},

You're invited to an upcoming {{meeting_type}} hosted by {{church_name}}!

📅 {{meeting_date}}
📍 {{meeting_location}}

We'd love for you to join us and learn more about what God is doing through our church plant.

Please let us know if you can make it:

{{confirm_link}}
{{decline_link}}

Looking forward to seeing you!

— {{church_name}}`,
    mergeFields: [
      "first_name",
      "meeting_title",
      "meeting_type",
      "meeting_date",
      "meeting_location",
      "church_name",
      "confirm_link",
      "decline_link",
    ],
  },
  {
    name: "Vision Meeting Reminder",
    description:
      "Reminder sent 24-48 hours before a vision meeting.",
    category: "meeting_reminder" as const,
    channel: "email" as const,
    subject: "Reminder: {{meeting_title}} is coming up — {{church_name}}",
    body: `Hi {{first_name}},

Just a friendly reminder that our {{meeting_type}} is coming up soon!

📅 {{meeting_date}}
📍 {{meeting_location}}

We're looking forward to having you there. If your plans have changed, please let us know:

{{confirm_link}}
{{decline_link}}

See you soon!

— {{church_name}}`,
    mergeFields: [
      "first_name",
      "meeting_title",
      "meeting_type",
      "meeting_date",
      "meeting_location",
      "church_name",
      "confirm_link",
      "decline_link",
    ],
  },
  {
    name: "Vision Meeting Follow-Up — Attended",
    description:
      "Follow-up sent to people who attended the vision meeting.",
    category: "follow_up" as const,
    channel: "email" as const,
    subject: "Thank You for Attending — {{church_name}}",
    body: `Hi {{first_name}},

Thank you so much for joining us at our {{meeting_type}}! We loved having you there.

We hope you got a sense of the vision God has given us for {{church_name}}. If you have any questions or want to learn about next steps, don't hesitate to reach out.

We'd love to stay connected!

— {{church_name}}`,
    mergeFields: [
      "first_name",
      "meeting_type",
      "church_name",
    ],
  },
  {
    name: "Vision Meeting Follow-Up — No Show",
    description:
      "Follow-up sent to people who confirmed but didn't attend.",
    category: "follow_up" as const,
    channel: "email" as const,
    subject: "We Missed You! — {{church_name}}",
    body: `Hi {{first_name}},

We missed you at our {{meeting_type}}! We know life gets busy, so no worries at all.

We'd love to share what we covered and keep you in the loop about upcoming events. Would you be interested in a quick coffee chat or our next gathering?

Just reply to this email — we'd love to hear from you!

— {{church_name}}`,
    mergeFields: [
      "first_name",
      "meeting_type",
      "church_name",
    ],
  },

  // ---------------------------------------------------------------------------
  // Orientation Templates
  // ---------------------------------------------------------------------------
  {
    name: "Orientation Invitation",
    description:
      "Invite core group members to an orientation session.",
    category: "meeting_invitation" as const,
    channel: "email" as const,
    subject: "Orientation: {{meeting_title}} — {{church_name}}",
    body: `Hi {{first_name}},

You're invited to our next Orientation session at {{church_name}}!

📅 {{meeting_date}}
📍 {{meeting_location}}

This is a great opportunity to learn more about our church plant, our values, and how you can get involved.

Let us know if you can make it:

{{confirm_link}}
{{decline_link}}

See you there!

— {{church_name}}`,
    mergeFields: [
      "first_name",
      "meeting_title",
      "meeting_date",
      "meeting_location",
      "church_name",
      "confirm_link",
      "decline_link",
    ],
  },

  // ---------------------------------------------------------------------------
  // General Templates
  // ---------------------------------------------------------------------------
  {
    name: "General Announcement",
    description:
      "Blank announcement template for church-wide communications.",
    category: "announcement" as const,
    channel: "email" as const,
    subject: "{{church_name}} — Update",
    body: `Hi {{first_name}},

[Write your announcement here]

— {{church_name}}`,
    mergeFields: [
      "first_name",
      "church_name",
    ],
  },
];

async function seed() {
  console.log("[SEED] Starting system template seed...");

  for (const template of systemTemplates) {
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
