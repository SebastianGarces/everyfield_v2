// ============================================================================
// Merge Field Engine
// ============================================================================
//
// Handles {{field_name}} placeholder replacement in email subject and body.
// Used by the communication service to personalize messages per recipient,
// and by the UI to render live previews with sample data.
// ============================================================================

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
    // pastor_name and launch_date come from extended church profile (future)
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
}): Record<string, string> {
  const typeLabels: Record<string, string> = {
    vision_meeting: "Vision Meeting",
    orientation: "Orientation",
    team_meeting: "Team Meeting",
  };

  return {
    meeting_title: meeting.title ?? typeLabels[meeting.type] ?? meeting.type,
    meeting_type: typeLabels[meeting.type] ?? meeting.type,
    meeting_date: meeting.datetime.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    meeting_location: [meeting.locationName, meeting.locationAddress]
      .filter(Boolean)
      .join(", "),
  };
}
