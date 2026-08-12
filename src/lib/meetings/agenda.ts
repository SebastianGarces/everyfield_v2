/**
 * The meeting agenda's shape, bounds and reader (VM-013).
 *
 * This module imports NOTHING — the same rule `copy.ts` keeps, and for the same
 * reason. `service.ts` opens with `@/db`, ten schema tables and drizzle, so
 * every symbol in it is one `"use client"` away from dragging that graph into
 * the client bundle. The agenda bounds and the clamp are needed on BOTH sides
 * of the boundary: the server normalises what it stores, and `AgendaBuilder`
 * (`"use client"`) clamps the same field as the planter types it.
 *
 * They used to be declared twice — `MAX_SECTION_MINUTES`, `MAX_AGENDA_SECTIONS`
 * and the clamp expression restated in `agenda-builder.tsx` under a comment
 * saying "Mirrors …". A policy kept in agreement by a comment is a policy with
 * two implementations. One module both sides can import is the fix.
 *
 * `service.ts` deliberately does NOT re-export any of this: a pass-through
 * keeps the coupling this module exists to remove. Import from here.
 */

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
 * The six-section running order a new vision meeting starts from (VM-013).
 *
 * Titles and order are the requirement, not a suggestion — the FRD names
 * Welcome, Worship, Vision, Q&A, Response, Fellowship. The timings are a
 * starting point the planter is expected to edit; they add to 90 minutes,
 * which is what the Vision Meeting Agenda handout (F6) is written against.
 */
export const VISION_MEETING_DEFAULT_AGENDA: readonly {
  title: string;
  minutes: number;
}[] = [
  { title: "Welcome", minutes: 10 },
  { title: "Worship", minutes: 15 },
  { title: "Vision", minutes: 25 },
  { title: "Q&A", minutes: 15 },
  { title: "Response", minutes: 10 },
  { title: "Fellowship", minutes: 15 },
] as const;

/**
 * Mint the default agenda with fresh section ids.
 *
 * Returns a new array of new objects every call: the ids must be unique per
 * meeting, and the constant above must stay frozen no matter what a caller
 * does to what it gets back.
 */
export function buildDefaultAgenda(): AgendaSection[] {
  return VISION_MEETING_DEFAULT_AGENDA.map((section) => ({
    id: crypto.randomUUID(),
    title: section.title,
    minutes: section.minutes,
  }));
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
