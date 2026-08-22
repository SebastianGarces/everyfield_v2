// ============================================================================
// Merge Field Engine
// ============================================================================
//
// Handles {{field_name}} placeholder replacement in email subject and body.
// Used by the communication service to personalize messages per recipient,
// and by the UI to render live previews with sample data.
// ============================================================================

import { formatDateTime } from "@/lib/datetime";
import { meetingTypeLabel } from "@/lib/meetings/labels";
import { parseAgenda, type AgendaSection } from "@/lib/meetings/agenda";
import { escapeMergeValues } from "@/lib/rich-text/format";

export interface MergeFieldDefinition {
  /** The field token (without braces), e.g. "first_name" */
  name: string;
  /** Human-readable label, e.g. "First Name" */
  label: string;
  /** Short description for the UI */
  description: string;
  /** Group for organizing in the UI */
  group: "person" | "church" | "meeting";
  /** Sample value used in previews */
  sampleValue: string;
}

// ---------------------------------------------------------------------------
// The agenda, as an email says it
// ---------------------------------------------------------------------------

/**
 * The heading `{{meeting_agenda}}` carries WITH the list, not above it.
 *
 * It is inside the VALUE deliberately. The merge engine has no conditionals, so
 * a heading written into the template body outlives the list it introduces: a
 * meeting with no agenda would deliver "Agenda:" and then nothing. Making the
 * whole block one value means an empty agenda renders an empty string and the
 * section is simply absent (#612).
 */
const AGENDA_HEADING = "Agenda:";

/**
 * The running order as plain text, or `""` when there is none.
 *
 * PLAIN TEXT with newlines, not markup: every merge value is escaped before it
 * is substituted into an HTML body (`escapeMergeValues`), and an exemption for
 * this one would put planter-typed section titles into the email unescaped.
 * `renderEmailBodyHtml` turns the newlines into `<br>` on the HTML side, so one
 * text value serves both halves of the email.
 *
 * A section with 0 minutes prints its title alone. Zero is what
 * `clampAgendaMinutes` returns for a timing it cannot read, so "(0 min)" would
 * be printing a parse failure to a guest as if it were the plan.
 */
export function formatAgendaForEmail(
  sections: readonly AgendaSection[]
): string {
  if (sections.length === 0) return "";

  const lines = sections.map((section) =>
    section.minutes > 0
      ? `• ${section.title} (${section.minutes} min)`
      : `• ${section.title}`
  );

  return [AGENDA_HEADING, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Field Registry
// ---------------------------------------------------------------------------

export const MERGE_FIELDS: MergeFieldDefinition[] = [
  // Person fields
  {
    name: "first_name",
    label: "First Name",
    description: "Recipient's first name",
    group: "person",
    sampleValue: "Sarah",
  },
  {
    name: "last_name",
    label: "Last Name",
    description: "Recipient's last name",
    group: "person",
    sampleValue: "Johnson",
  },
  {
    name: "full_name",
    label: "Full Name",
    description: "Recipient's full name",
    group: "person",
    sampleValue: "Sarah Johnson",
  },
  {
    name: "email",
    label: "Email",
    description: "Recipient's email address",
    group: "person",
    sampleValue: "sarah@example.com",
  },
  // Church fields
  {
    name: "church_name",
    label: "Church Name",
    description: "Your church name",
    group: "church",
    sampleValue: "New Life Church",
  },
  {
    name: "pastor_name",
    label: "Pastor Name",
    description: "Senior pastor's name",
    group: "church",
    sampleValue: "Pastor John Smith",
  },
  {
    name: "launch_date",
    label: "Launch Date",
    description: "Target launch Sunday date",
    group: "church",
    sampleValue: "September 14, 2026",
  },
  // Meeting fields (available when triggered from a meeting context)
  {
    name: "meeting_title",
    label: "Meeting Title",
    description: "Meeting title or auto-generated name",
    group: "meeting",
    sampleValue: "Vision Meeting #12",
  },
  {
    name: "meeting_type",
    label: "Meeting Type",
    description: "Type of meeting (Vision Meeting, Orientation, etc.)",
    group: "meeting",
    sampleValue: "Vision Meeting",
  },
  {
    name: "meeting_date",
    label: "Meeting Date",
    description: "Meeting date and time",
    group: "meeting",
    sampleValue: "Tuesday, March 10, 2026 at 7:00 PM",
  },
  {
    name: "meeting_location",
    label: "Meeting Location",
    description: "Meeting venue name and address",
    group: "meeting",
    sampleValue: "Community Center, 123 Main St",
  },
  {
    name: "meeting_agenda",
    label: "Meeting Agenda",
    description:
      "The running order, heading included. Renders nothing when the meeting has no agenda — do not write a heading above it.",
    group: "meeting",
    sampleValue: AGENDA_HEADING + "\n• Welcome (10 min)\n• Vision (25 min)",
  },
  // Confirmation buttons (auto-injected when sending for a meeting)
  // These render as styled CTA buttons in the email — place on their own line
  {
    name: "confirm_link",
    label: "Confirm Button",
    description:
      "RSVP confirm button (renders as a styled green button in the email)",
    group: "meeting",
    sampleValue: "__EF_CONFIRM__",
  },
  {
    name: "decline_link",
    label: "Decline Button",
    description:
      "RSVP decline button (renders as a styled gray button in the email)",
    group: "meeting",
    sampleValue: "__EF_DECLINE__",
  },
];

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Replace all {{field_name}} placeholders with actual values.
 * Works on both subject and body strings.
 */
export function renderTemplate(
  text: string,
  data: Record<string, string>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, fieldName: string) => {
    return data[fieldName] ?? match;
  });
}

/**
 * Return a complete data object with sample values for all merge fields.
 * Used by the live preview in the compose UI.
 */
export function getSampleData(): Record<string, string> {
  const data: Record<string, string> = {};
  for (const field of MERGE_FIELDS) {
    data[field.name] = field.sampleValue;
  }
  return data;
}

/**
 * Parse a template string and return all {{...}} tokens found.
 * Useful for validation (check for typos in field names).
 */
export function extractMergeFields(text: string): string[] {
  const matches = text.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

/**
 * Validate that all merge fields in a template are recognized.
 * Returns an array of unrecognized field names.
 */
export function validateMergeFields(text: string): string[] {
  const used = extractMergeFields(text);
  const known = new Set(MERGE_FIELDS.map((f) => f.name));
  return used.filter((f) => !known.has(f));
}

/**
 * Build merge data for a specific person + church context.
 */
export function buildPersonMergeData(person: {
  firstName: string;
  lastName: string;
  email: string | null;
}): Record<string, string> {
  return {
    first_name: person.firstName,
    last_name: person.lastName,
    full_name: `${person.firstName} ${person.lastName}`,
    email: person.email ?? "",
  };
}

export function buildChurchMergeData(church: {
  name: string;
}): Record<string, string> {
  return {
    church_name: church.name,
    // Both still render empty, for two DIFFERENT reasons — worth keeping
    // straight now that one of them is no longer "the column doesn't exist":
    //   pastor_name — no church-profile field sources it yet.
    //   launch_date — the day exists and is readable
    //     (`launches.target_date`, LS-001; `churches.launch_date` was dropped by
    //     migration 0032), but this builder takes only a church name, and
    //     widening it to fetch is #203's call. The FRD's own note
    //     (`communication-hub/frd.md`) says these two render empty.
    pastor_name: "",
    launch_date: "",
  };
}

export function buildMeetingMergeData(meeting: {
  title: string | null;
  type: string;
  datetime: Date;
  locationName: string | null;
  locationAddress: string | null;
  /**
   * `church_meetings.agenda` AS STORED — the raw `jsonb`, parsed here.
   *
   * REQUIRED and `unknown`, never optional. Three of this function's callers
   * hand it a whole `churchMeetings` row and satisfy it for free; the other two
   * project a narrow shape by hand, and while the field was absent they would
   * have type-checked and silently sent an email with no agenda in it. Optional
   * makes a forgotten column invisible; required makes it a compile error at
   * the projection. Same rule and same reason as `MeetingTitleFacts`
   * (`@/lib/meetings/labels`).
   */
  agenda: unknown;
}): Record<string, string> {
  // Canonical map (407-4-1): the type may have arrived from an older row,
  // so the accessor falls back to the raw token exactly as the local copy did.
  const typeLabel = meetingTypeLabel(meeting.type);

  return {
    meeting_title: meeting.title ?? typeLabel,
    meeting_type: typeLabel,
    // Zone-pinned: this runs both on the server (sending mail) and inside the
    // client preview on /meetings/[id]. A locale-default format would put a
    // different time in the SSR markup than in the hydrated preview — and a
    // different time in the email than on the page. See src/lib/datetime.ts.
    meeting_date: formatDateTime(meeting.datetime),
    meeting_location: [meeting.locationName, meeting.locationAddress]
      .filter(Boolean)
      .join(", "),
    // `parseAgenda` is total — a null column, a legacy string or an array of
    // junk all yield sections, possibly none — so an unreadable row sends an
    // email without an agenda rather than failing the send.
    meeting_agenda: formatAgendaForEmail(parseAgenda(meeting.agenda)),
  };
}

// ---------------------------------------------------------------------------
// Rendering a body
// ---------------------------------------------------------------------------

/**
 * CRLF and a lone CR are the same line break as LF.
 *
 * NORMALISED FIRST, before any rule below counts lines or collapses them. Every
 * one of those rules is written against `\n`, so a value carrying `\r` slips
 * past all three: the subject collapse leaves a bare CR in an email HEADER,
 * which is the character that carries injection weight; the text half's blank-
 * line collapse never fires on a CRLF run. The values are planter-typed —
 * meeting titles, agenda section titles, names — so this is untrusted input on
 * its way to an external API.
 */
const NEWLINES = /\r\n?/g;

/** Each value with its line breaks normalised, leaving the keys alone. */
function withNormalisedNewlines(
  data: Record<string, string>
): Record<string, string> {
  const normalised: Record<string, string> = {};
  for (const [name, value] of Object.entries(data)) {
    normalised[name] = value.replace(NEWLINES, "\n");
  }
  return normalised;
}

/**
 * A `<p>` holding ONE merge token and nothing else — a template's way of saying
 * "this section goes here".
 *
 * The match is against the TEMPLATE, before substitution, and that is the whole
 * point. The first spelling of this rule ran over the RENDERED body looking for
 * `<p></p>`, which cannot tell a paragraph a token emptied from a blank line
 * the planter typed — and `<p><br></p>` is exactly what this repo calls an
 * author's blank line (`format.ts`, `isRichTextEmpty`). So a change scoped to
 * "an absent agenda leaves no gap" silently restyled every outgoing email,
 * including ones with no meeting and no merge field in them. Asking the
 * template which paragraph belongs to which token keeps the rule where the
 * intent is.
 */
const TOKEN_ONLY_PARAGRAPH =
  /<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*\{\{(\w+)\}\}(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi;

/**
 * Substitute merge values into a sanitised rich-text body — the ONE door, for
 * the send path, the compose preview and the sent-message detail page, so no
 * two of them can draw a different email.
 *
 * Three steps, and they were spelled out at each call site before this function
 * existed:
 *
 * 1. ESCAPE the values. A person called `Bobby <script>` is a name, not markup,
 *    and so is an agenda section a planter typed.
 * 2. Newlines become `<br>`. Merge values are TEXT — the agenda is a list of
 *    lines — and a bare `\n` inside a `<p>` is whitespace, so without this the
 *    whole agenda arrives on one line.
 * 3. Drop the paragraph a field that resolved to NOTHING would have filled, so
 *    the section is absent rather than a blank gap. `{{meeting_agenda}}` on a
 *    meeting with no agenda is the case this was written for (#612);
 *    `{{pastor_name}}` and `{{launch_date}}` render empty today and left the
 *    same gap. A token with no value at all is NOT this case — it is left in
 *    place, so the preview can still draw its red "nothing resolved this" pill.
 */
export function renderEmailBodyHtml(
  bodyHtml: string,
  data: Record<string, string>
): string {
  const escaped: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    escapeMergeValues(withNormalisedNewlines(data))
  )) {
    escaped[name] = value.replace(/\n/g, "<br />");
  }

  const withoutEmptied = bodyHtml.replace(
    TOKEN_ONLY_PARAGRAPH,
    (paragraph, name: string) => (escaped[name] === "" ? "" : paragraph)
  );

  return renderTemplate(withoutEmptied, escaped);
}

/**
 * The same substitution for the text/plain half. No escaping — it is not markup
 * — but the same intent: a field that rendered nothing does not leave three
 * blank lines where the HTML half leaves none.
 */
export function renderEmailBodyText(
  bodyText: string,
  data: Record<string, string>
): string {
  return renderTemplate(
    bodyText.replace(NEWLINES, "\n"),
    withNormalisedNewlines(data)
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A subject line, rendered onto ONE line.
 *
 * The collapse is the boundary's, not a nicety: a subject is an email HEADER,
 * and `{{meeting_agenda}}` is the first merge value with line breaks in it, so
 * a planter who puts that token in the subject field would otherwise hand the
 * provider a multi-line header value.
 */
export function renderSubject(
  subject: string,
  data: Record<string, string>
): string {
  return renderTemplate(subject, data).replace(/\s+/g, " ").trim();
}
