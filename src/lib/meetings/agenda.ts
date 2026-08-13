/**
 * The meeting agenda's shape, bounds, defaults and reader (VM-013).
 *
 * This module imports NOTHING but a TYPE — the rule `copy.ts` keeps outright
 * and `meeting-type-filter.ts` keeps with the same one allowance, for the same
 * reason. `service.ts` opens with `@/db`, ten schema tables and drizzle, so
 * every symbol in it is one `"use client"` away from dragging that graph into
 * the client bundle. The agenda bounds and the clamp are needed on BOTH sides
 * of the boundary: the server normalises what it stores, and `AgendaBuilder`
 * (`"use client"`) clamps the same field as the planter types it.
 * `import type { MeetingType }` is erased at compile time and adds no bundle
 * edge, so it is the one import this module may have; `ruled-copy.test.ts`
 * asserts that allowance rather than assuming it.
 *
 * They used to be declared twice — `MAX_SECTION_MINUTES`, `MAX_AGENDA_SECTIONS`
 * and the clamp expression restated in `agenda-builder.tsx` under a comment
 * saying "Mirrors …". A policy kept in agreement by a comment is a policy with
 * two implementations. One module both sides can import is the fix.
 *
 * EVERY agenda decision is here, including the two that were not: which meeting
 * types have a prescribed running order (`defaultAgendaTemplatesForType`, which
 * was a `defaultAgendaForType` in `service.ts` AND a ternary in the detail
 * page's JSX) and how a template becomes a section (`sectionsFromTemplates`,
 * which was `buildDefaultAgenda`'s body AND `handleUseDefault`'s body). Both
 * were the R2 duplicate-decision shape this module exists to end.
 *
 * `service.ts` deliberately does NOT re-export any of this: a pass-through
 * keeps the coupling this module exists to remove. Import from here.
 */

import type { MeetingType } from "@/db/schema";

/**
 * One line of a meeting's running order.
 *
 * The agenda lives in `church_meetings.agenda`, a `jsonb` column typed
 * `unknown` by Drizzle — the database will accept any shape at all, including
 * shapes written before this type existed. So nothing here trusts the column:
 * every read goes through `parseAgenda`, which keeps what it can read and drops
 * the rest rather than letting a malformed row throw on render.
 *
 * `minutes` is a duration, never a clock time. Sections are timed relative to
 * whenever the meeting actually starts, so a meeting that begins late does not
 * need its agenda rewritten.
 */
export interface AgendaSection {
  /** Stable across reorders — it is what React and the optimistic UI key on. */
  id: string;
  title: string;
  /** Planned length in minutes. Always an integer in [0, MAX_SECTION_MINUTES]. */
  minutes: number;
}

/** A single section may not be planned longer than a working day. */
export const MAX_SECTION_MINUTES = 600;
/** Guard against a client posting an unbounded array into the jsonb column. */
export const MAX_AGENDA_SECTIONS = 40;
/** Long enough for a real section name, short enough to render on one line. */
export const MAX_SECTION_TITLE_LENGTH = 120;

/**
 * A section of an offered default, before it is given an id.
 *
 * Declared HERE and nowhere else. It was an anonymous object literal typing
 * `VISION_MEETING_DEFAULT_AGENDA` and an identical `interface` in
 * `agenda-builder.tsx`, so the policy module's default was typed by one shape
 * and the client component's prop by another, with the server page in the
 * middle having to satisfy both.
 */
export interface AgendaSectionTemplate {
  title: string;
  minutes: number;
}

/**
 * The six-section running order a new vision meeting starts from (VM-013).
 *
 * Titles and order are the requirement, not a suggestion — the FRD names
 * Welcome, Worship, Vision, Q&A, Response, Fellowship. The timings are a
 * starting point the planter is expected to edit; they add to 90 minutes,
 * which is what the Vision Meeting Agenda handout (F6) is written against.
 */
export const VISION_MEETING_DEFAULT_AGENDA: readonly AgendaSectionTemplate[] = [
  { title: "Welcome", minutes: 10 },
  { title: "Worship", minutes: 15 },
  { title: "Vision", minutes: 25 },
  { title: "Q&A", minutes: 15 },
  { title: "Response", minutes: 10 },
  { title: "Fellowship", minutes: 15 },
] as const;

/**
 * WHICH meeting types have a prescribed running order — the one place it is
 * decided.
 *
 * Only vision meetings do; everything else starts empty and gets the builder's
 * empty state. Both readers ask this: `createMeeting` seeds a new meeting's
 * agenda from it, and the meeting-detail page hands it to `AgendaBuilder` as
 * `defaultSections` so the empty state can offer "Start from the standard
 * agenda". They used to be two copies of the same `type === "vision_meeting"`
 * test — a service function and a ternary in JSX — so giving `orientation` a
 * prescribed order would have seeded new orientations and left every existing
 * one with a bare empty state.
 *
 * TEMPLATES, not sections: the caller decides when ids are minted, because ids
 * must be unique per meeting and this constant must stay frozen.
 *
 * `MeetingType` is the database's own enum and arrives as a TYPE-ONLY import,
 * which is erased at compile time — so keying on it here costs this module
 * nothing at the client boundary.
 */
export function defaultAgendaTemplatesForType(
  type: MeetingType
): readonly AgendaSectionTemplate[] {
  return type === "vision_meeting" ? VISION_MEETING_DEFAULT_AGENDA : [];
}

/**
 * Mint sections from templates: fresh ids, clamped timings.
 *
 * The ONE template→section step. Returns a new array of new objects every
 * call, so the constants above are never handed out by reference and two
 * meetings never share a section id. `AgendaBuilder`'s "Start from the standard
 * agenda" restated this map inline, which meant a new field on `AgendaSection`
 * would have reached a created vision meeting and not a converted empty state.
 */
export function sectionsFromTemplates(
  templates: readonly AgendaSectionTemplate[]
): AgendaSection[] {
  return templates.map((template) => ({
    id: crypto.randomUUID(),
    title: template.title,
    minutes: clampAgendaMinutes(template.minutes),
  }));
}

/** The vision-meeting default, minted with fresh section ids. */
export function buildDefaultAgenda(): AgendaSection[] {
  return sectionsFromTemplates(VISION_MEETING_DEFAULT_AGENDA);
}

/**
 * A section's planned length, coerced into `[0, MAX_SECTION_MINUTES]`.
 *
 * The ONE clamp: the server calls it from `parseAgenda` on a `jsonb` value of
 * any shape, and `AgendaBuilder` calls it on what the planter typed. Takes
 * `unknown` so both reach it — anything unreadable is 0 minutes, which is a
 * legible section rather than a broken row.
 */
export function clampAgendaMinutes(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.round(parsed), 0), MAX_SECTION_MINUTES);
}

/**
 * Read the `agenda` column into sections, keeping only what is legible.
 *
 * Total function: any input at all — `null`, a legacy string, an object, an
 * array of junk — yields an array, possibly empty. A row that cannot be read
 * renders the empty state; it never breaks the page.
 *
 * Rows missing an `id` are given one here so the UI always has a stable key;
 * the id is persisted on the next save.
 */
export function parseAgenda(value: unknown): AgendaSection[] {
  if (!Array.isArray(value)) return [];

  const sections: AgendaSection[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;

    const record = entry as Record<string, unknown>;
    const rawTitle = typeof record.title === "string" ? record.title : "";
    const title = rawTitle.trim().slice(0, MAX_SECTION_TITLE_LENGTH);
    if (!title) continue;

    sections.push({
      id:
        typeof record.id === "string" && record.id.trim().length > 0
          ? record.id
          : crypto.randomUUID(),
      title,
      minutes: clampAgendaMinutes(record.minutes),
    });

    if (sections.length >= MAX_AGENDA_SECTIONS) break;
  }

  return sections;
}

/** The planned length of the whole meeting, in minutes. */
export function agendaTotalMinutes(sections: readonly AgendaSection[]): number {
  return sections.reduce((total, section) => total + section.minutes, 0);
}
