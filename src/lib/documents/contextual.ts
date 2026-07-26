// ============================================================================
// Document Templates — Contextual access (DOC-014)
// ============================================================================
//
// A planter should reach the right document from the feature they are already
// in, instead of navigating to /documents and searching (FRD Workflow 3).
//
// The catalog already carries the metadata (category + phase); what lives here
// is the mapping from a *feature context* (a meeting of a given type, a
// ministry team) to the templates that belong in that context, plus the link
// that opens the template's generate dialog on the documents library.
//
// Out of scope (deliberately): auto-filling a template with that specific
// meeting's or team's data. A contextual link is a shortcut to the template,
// not a pre-filled document.
// ============================================================================

import type { MeetingType } from "@/db/schema/meetings";

import { getTemplateById } from "./templates";
import type { DocumentFormat } from "./types";

/** A template offered from inside another feature. */
export interface ContextualTemplate {
  id: string;
  name: string;
  description: string;
  formats: DocumentFormat[];
  /** Why this template is offered here (rendered under the name). */
  note?: string;
  /** Link to the documents library with this template's dialog open. */
  href: string;
}

/**
 * Deep link to the documents library with `templateId` pre-opened. Opening the
 * template (format picker + merge fields) is the point — never a blind
 * download from a feature page.
 */
export function contextualTemplateHref(templateId: string): string {
  return `/documents?template=${encodeURIComponent(templateId)}`;
}

/**
 * Resolve catalog ids to renderable links. Unknown ids are dropped rather than
 * rendered as dead links.
 */
function toContextualTemplates(
  ids: readonly string[],
  notes: Readonly<Record<string, string>> = {}
): ContextualTemplate[] {
  const resolved: ContextualTemplate[] = [];

  for (const id of ids) {
    const template = getTemplateById(id);
    if (!template) continue;

    resolved.push({
      id: template.id,
      name: template.name,
      description: template.description,
      formats: template.formats,
      note: notes[template.id],
      href: contextualTemplateHref(template.id),
    });
  }

  return resolved;
}

// ----------------------------------------------------------------------------
// Meetings
// ----------------------------------------------------------------------------

/**
 * Templates offered on a meeting detail page, keyed by meeting type. Types
 * absent from this map (orientation, team meetings) have no matching template
 * and render nothing.
 */
const MEETING_TEMPLATE_IDS: Partial<Record<MeetingType, readonly string[]>> = {
  vision_meeting: [
    "vision-meeting-agenda",
    "guest-sign-in-sheet",
    "response-card",
  ],
};

/** Templates a planter needs while running this meeting. */
export function getMeetingContextualTemplates(
  meetingType: string
): ContextualTemplate[] {
  const ids = MEETING_TEMPLATE_IDS[meetingType as MeetingType] ?? [];
  return toContextualTemplates(ids);
}

// ----------------------------------------------------------------------------
// Ministry teams
// ----------------------------------------------------------------------------

const LAUNCH_CHECKLISTS_ID = "launch-sunday-checklists";

/**
 * The per-team sections inside the Launch Sunday checklist packet, with the
 * team-name keywords that point at each one. Order matters: first match wins.
 *
 * Keep in sync with `src/lib/documents/pdf/launch-sunday-checklists.tsx`.
 */
const LAUNCH_CHECKLIST_SECTIONS: readonly {
  section: string;
  keywords: readonly string[];
}[] = [
  {
    section: "Setup & Teardown",
    keywords: ["facilities", "setup", "teardown"],
  },
  {
    section: "Hospitality & Welcome",
    keywords: ["hospitality", "welcome", "greeter", "usher"],
  },
  {
    section: "Worship & Production",
    keywords: ["worship", "production", "music", "technology", "audio"],
  },
  {
    section: "Children's Ministry",
    keywords: ["children", "kids", "nursery"],
  },
  {
    section: "Connections & Follow-up",
    keywords: ["assimilation", "connection", "follow-up", "follow up"],
  },
  { section: "Prayer", keywords: ["prayer"] },
];

/**
 * The launch-day checklist section this team owns, if the packet has one for
 * them. Used only to label the link — every team still gets the packet.
 */
export function getLaunchChecklistSection(teamName: string): string | null {
  const name = teamName.toLowerCase();

  for (const { section, keywords } of LAUNCH_CHECKLIST_SECTIONS) {
    if (keywords.some((keyword) => name.includes(keyword))) return section;
  }

  return null;
}

/** Templates a ministry team needs — the Launch Sunday checklist packet. */
export function getTeamContextualTemplates(team: {
  name: string;
}): ContextualTemplate[] {
  const section = getLaunchChecklistSection(team.name);

  return toContextualTemplates(
    [LAUNCH_CHECKLISTS_ID],
    section
      ? { [LAUNCH_CHECKLISTS_ID]: `Includes the ${section} checklist.` }
      : {}
  );
}
