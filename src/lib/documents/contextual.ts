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

// Type-only: erased at compile time, so react-pdf never reaches the bundle of
// a feature page that imports this module.
import type { LaunchChecklistSection } from "./pdf/launch-sunday-checklists";
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
 * Resolve catalog ids to renderable links. Unknown ids are DROPPED rather than
 * rendered as dead links — a template can be renamed or retired in
 * `templates.ts` without every id list being updated in the same commit, and
 * the failure mode of a stale id must be one missing link, not a link into a
 * page that answers "unknown template".
 *
 * The one resolver for both directions of DOC-014: the feature-context lists
 * below and the wiki's `ARTICLE_TEMPLATE_IDS` map
 * (`src/components/wiki/article-templates.ts`) both resolve through here.
 */
export function resolveContextualTemplates(
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

/** A section of contextual templates: the heading and what goes under it. */
export interface ContextualTemplateSection {
  title: string;
  templates: ContextualTemplate[];
}

/**
 * Templates offered on a meeting detail page, keyed by meeting type — each
 * entry carries its own section heading, so adding a type here brings its
 * title with it rather than needing a matching branch in the page. Types
 * absent from this map (orientation, team meetings) have no matching template
 * and render nothing.
 */
const MEETING_TEMPLATES: Partial<
  Record<MeetingType, { title: string; ids: readonly string[] }>
> = {
  vision_meeting: {
    title: "Vision Meeting Documents",
    ids: ["vision-meeting-agenda", "guest-sign-in-sheet", "response-card"],
  },
};

/**
 * The documents a planter needs while running this meeting, with the heading
 * to file them under. `null` when this meeting type has no matching template —
 * the page then renders nothing at all.
 */
export function getMeetingContextualTemplates(
  meetingType: string
): ContextualTemplateSection | null {
  const entry = MEETING_TEMPLATES[meetingType as MeetingType];
  if (!entry) return null;

  const templates = resolveContextualTemplates(entry.ids);
  if (templates.length === 0) return null;

  return { title: entry.title, templates };
}

// ----------------------------------------------------------------------------
// Ministry teams
// ----------------------------------------------------------------------------

const LAUNCH_CHECKLISTS_ID = "launch-sunday-checklists";

/**
 * The per-team sections inside the Launch Sunday checklist packet, with the
 * team-name keywords that point at each one. Order matters: first match wins.
 *
 * `section` is typed as `LaunchChecklistSection`, so it can only ever name a
 * section the PDF actually prints — renaming one there fails typecheck here.
 * `contextual.test.ts` also asserts membership at runtime.
 */
const LAUNCH_CHECKLIST_SECTIONS: readonly {
  section: LaunchChecklistSection;
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
export function getLaunchChecklistSection(
  teamName: string
): LaunchChecklistSection | null {
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

  return resolveContextualTemplates(
    [LAUNCH_CHECKLISTS_ID],
    section
      ? { [LAUNCH_CHECKLISTS_ID]: `Includes the ${section} checklist.` }
      : {}
  );
}
