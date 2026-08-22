// ============================================================================
// The system template catalog (COM-004)
// ============================================================================
//
// The platform's own templates, as DATA. `scripts/seed-system-templates.ts` is
// the shell that writes them into a database; this is what it writes, and it is
// importable without opening a connection or reading `.env.local` — which is
// what lets `meeting-compose.test.ts` hold the invitation map to the catalog
// instead of to a comment.
//
// The split matters in one direction only: nothing in the app READS this at
// runtime. Templates are rows, and `getTemplates` returns the church's view of
// them (its forks in place of the originals). A surface that reached for this
// array would be looking at what the catalog SAID at deploy time, not at what
// the church actually has.
// ============================================================================

import type {
  CommunicationChannel,
  TemplateCategory,
} from "@/db/schema/communication";

/**
 * One catalog entry. `name` is the IDENTITY — the seed matches on it plus
 * `is_system`, so renaming an entry seeds a second template rather than
 * updating the first, and `MEETING_INVITATION_TEMPLATE_NAMES` points at it.
 */
export interface SystemTemplate {
  name: string;
  description: string;
  category: TemplateCategory;
  channel: CommunicationChannel;
  subject: string;
  body: string;
  mergeFields: string[];
}

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  // ---------------------------------------------------------------------------
  // Vision Meeting Templates
  // ---------------------------------------------------------------------------
  {
    name: "Vision Meeting Invitation",
    description:
      "Invite someone to a vision meeting. Includes RSVP confirmation links.",
    category: "meeting_invitation",
    channel: "email",
    subject: "You're Invited: {{meeting_title}} — {{church_name}}",
    body: `Hi {{first_name}},

You're invited to an upcoming {{meeting_type}} hosted by {{church_name}}!

📅 {{meeting_date}}
📍 {{meeting_location}}

{{meeting_agenda}}

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
      "meeting_agenda",
      "church_name",
      "confirm_link",
      "decline_link",
    ],
  },
  {
    name: "Vision Meeting Reminder",
    description: "Reminder sent 24-48 hours before a vision meeting.",
    category: "meeting_reminder",
    channel: "email",
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
    description: "Follow-up sent to people who attended the vision meeting.",
    category: "follow_up",
    channel: "email",
    subject: "Thank You for Attending — {{church_name}}",
    body: `Hi {{first_name}},

Thank you so much for joining us at our {{meeting_type}}! We loved having you there.

We hope you got a sense of the vision God has given us for {{church_name}}. If you have any questions or want to learn about next steps, don't hesitate to reach out.

We'd love to stay connected!

— {{church_name}}`,
    mergeFields: ["first_name", "meeting_type", "church_name"],
  },
  {
    name: "Vision Meeting Follow-Up — No Show",
    description: "Follow-up sent to people who confirmed but didn't attend.",
    category: "follow_up",
    channel: "email",
    subject: "We Missed You! — {{church_name}}",
    body: `Hi {{first_name}},

We missed you at our {{meeting_type}}! We know life gets busy, so no worries at all.

We'd love to share what we covered and keep you in the loop about upcoming events. Would you be interested in a quick coffee chat or our next gathering?

Just reply to this email — we'd love to hear from you!

— {{church_name}}`,
    mergeFields: ["first_name", "meeting_type", "church_name"],
  },

  // ---------------------------------------------------------------------------
  // Orientation Templates
  // ---------------------------------------------------------------------------
  {
    name: "Orientation Invitation",
    description: "Invite core group members to an orientation session.",
    category: "meeting_invitation",
    channel: "email",
    subject: "Orientation: {{meeting_title}} — {{church_name}}",
    body: `Hi {{first_name}},

You're invited to our next Orientation session at {{church_name}}!

📅 {{meeting_date}}
📍 {{meeting_location}}

{{meeting_agenda}}

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
      "meeting_agenda",
      "church_name",
      "confirm_link",
      "decline_link",
    ],
  },

  // ---------------------------------------------------------------------------
  // Team Meeting Templates
  //
  // The third meeting type, and the one that had no template at all: compose
  // auto-suggested "Team Meeting Invitation" by name and nothing in the catalog
  // answered to it, so a team meeting opened compose blank (#612).
  //
  // It is deliberately the PLAINEST of the three. A team meeting goes to people
  // who are already on the team, so it says what and when and gets out of the
  // way — no pitch about the plant, which the vision-meeting template carries
  // because its audience has not heard one.
  // ---------------------------------------------------------------------------
  {
    name: "Team Meeting Invitation",
    description:
      "Invite a ministry team to their next meeting. Includes the agenda and RSVP links.",
    category: "meeting_invitation",
    channel: "email",
    subject: "{{meeting_title}} — {{meeting_date}}",
    body: `Hi {{first_name}},

Here are the details for our next {{meeting_type}}:

📅 {{meeting_date}}
📍 {{meeting_location}}

{{meeting_agenda}}

Please let us know if you can make it:

{{confirm_link}}
{{decline_link}}

Thanks for serving!

— {{church_name}}`,
    mergeFields: [
      "first_name",
      "meeting_title",
      "meeting_type",
      "meeting_date",
      "meeting_location",
      "meeting_agenda",
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
    description: "Blank announcement template for church-wide communications.",
    category: "announcement",
    channel: "email",
    subject: "{{church_name}} — Update",
    body: `Hi {{first_name}},

[Write your announcement here]

— {{church_name}}`,
    mergeFields: ["first_name", "church_name"],
  },
];
