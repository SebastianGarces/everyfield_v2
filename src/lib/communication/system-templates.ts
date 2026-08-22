// ============================================================================
// The system template catalog (COM-004)
// ============================================================================
//
// The platform's own templates, as DATA. `scripts/seed-system-templates.ts` is
// the shell that writes them into a database; this is what it writes, and it is
// importable without opening a connection or reading `.env.local`.
//
// NOTHING HERE IS A SUBSTITUTE FOR THE ROWS. Templates live in
// `message_templates`, and `getTemplates` returns the church's view of them —
// its copy-on-write forks in place of the originals. A surface that rendered a
// body out of this array would be showing what the catalog SAID at deploy time,
// not what the church actually has. The one thing read at runtime is the
// INVITATION RELATION (`invitesMeetingType`), which is a fact about the platform
// catalog rather than about any church's rows; `meetingInvitationTemplate` reads
// it to get a NAME and then looks the church's own row up by that name.
//
// SERVER SIDE ONLY, and deliberately: a `"use client"` module that imported this
// would ship every template body to the browser. `/communication/compose`
// resolves the auto-suggested template in its PAGE for exactly that reason.
//
// WRITE NO PREFIX BEFORE AN OPTIONAL TOKEN. `{{meeting_location}}` brings its
// own 📍 and `{{meeting_agenda}}` its own "Agenda:", because the merge engine
// has no conditionals: a prefix typed here survives the value it introduces,
// and a meeting with no location delivered a bare 📍 (#625) exactly as one with
// no agenda delivered a bare "Agenda:" (#612). The 📅 below is not that case —
// a meeting always has a datetime. See `merge.ts`.
// ============================================================================

import type {
  CommunicationChannel,
  TemplateCategory,
} from "@/db/schema/communication";
import type { MeetingType } from "@/db/schema/meetings";

/**
 * One catalog entry. `name` is the IDENTITY — the seed matches on it plus
 * `is_system`, so renaming an entry seeds a second template rather than
 * updating the first.
 */
export interface SystemTemplate {
  name: string;
  description: string;
  category: TemplateCategory;
  channel: CommunicationChannel;
  subject: string;
  body: string;
  mergeFields: string[];
  /**
   * The meeting type this template is the invitation FOR — the one place that
   * relation is written down.
   *
   * IT LIVES ON THE ENTRY, not in a map beside it, and that is what makes "the
   * invitation for this type exists" true by construction rather than by a
   * test. Its predecessor was a `Record<string, string[]>` of template-name
   * patterns inside `compose-form.tsx` naming `"Team Meeting Invitation"`, a
   * template this catalog had never held: a team meeting reached compose with
   * its `meetingId` set, matched nothing, and handed the planter an empty
   * subject and an empty body. Nothing failed, so nothing said why (#612). A
   * name in one file pointing at a row in another can always be wrong; a field
   * on the row itself cannot.
   *
   * Absent on every template that is not an invitation. `meeting-compose.test.ts`
   * holds the other half — that every `MeetingType` is claimed exactly once.
   */
  invitesMeetingType?: MeetingType;
}

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  // ---------------------------------------------------------------------------
  // Vision Meeting Templates
  // ---------------------------------------------------------------------------
  {
    name: "Vision Meeting Invitation",
    invitesMeetingType: "vision_meeting",
    description:
      "Invite someone to a vision meeting. Includes RSVP confirmation links.",
    category: "meeting_invitation",
    channel: "email",
    subject: "You're Invited: {{meeting_title}} — {{church_name}}",
    body: `Hi {{first_name}},

You're invited to an upcoming {{meeting_type}} hosted by {{church_name}}!

📅 {{meeting_date}}
{{meeting_location}}

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
{{meeting_location}}

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
    invitesMeetingType: "orientation",
    description: "Invite core group members to an orientation session.",
    category: "meeting_invitation",
    channel: "email",
    subject: "Orientation: {{meeting_title}} — {{church_name}}",
    body: `Hi {{first_name}},

You're invited to our next Orientation session at {{church_name}}!

📅 {{meeting_date}}
{{meeting_location}}

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
    invitesMeetingType: "team_meeting",
    description:
      "Invite a ministry team to their next meeting. Includes the agenda and RSVP links.",
    category: "meeting_invitation",
    channel: "email",
    subject: "{{meeting_title}} — {{meeting_date}}",
    body: `Hi {{first_name}},

Here are the details for our next {{meeting_type}}:

📅 {{meeting_date}}
{{meeting_location}}

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

// ---------------------------------------------------------------------------
// Which template invites which meeting type
// ---------------------------------------------------------------------------

/** What the lookup below needs off a template row. */
export interface InvitationTemplateCandidate {
  name: string;
  category: string;
}

/**
 * The invitation template to open a meeting's email with, or `null`.
 *
 * TWO STEPS, and only the first touches this catalog: the platform decides
 * which template is the invitation for a meeting type (`invitesMeetingType`),
 * and the CHURCH's own rows decide which template that name resolves to.
 *
 * `includes`, not equality, for the second step: a church that edits a system
 * template gets a FORK (`templates.ts`, copy-on-write) which it may rename
 * around the original, and `getTemplates` returns the fork in the original's
 * place. Matching on a substring keeps the church's own copy of
 * "Vision Meeting Invitation" winning over the platform's.
 *
 * A type nothing claims — a meeting type added to the schema before its
 * template — resolves to `null` and compose opens blank. That is the #612 bug,
 * and `meeting-compose.test.ts` is what stops it reaching a planter again.
 */
export function meetingInvitationTemplate<
  T extends InvitationTemplateCandidate,
>(meetingType: string, templates: readonly T[]): T | null {
  const name = SYSTEM_TEMPLATES.find(
    (template) => template.invitesMeetingType === meetingType
  )?.name;
  if (!name) return null;

  return (
    templates.find(
      (template) =>
        template.category === "meeting_invitation" &&
        template.name.includes(name)
    ) ?? null
  );
}
