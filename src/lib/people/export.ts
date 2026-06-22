import type { Person, Tag } from "@/db/schema";

// ============================================================================
// People → CSV Export (P-027)
// ============================================================================

/**
 * Columns emitted by the people CSV export, in order.
 * Header row uses these exact field names so a round-trip through the
 * import template stays predictable.
 */
export const EXPORT_CSV_HEADERS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "status",
  "source",
  "tags",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "notes",
  "createdAt",
] as const;

/**
 * A person plus its resolved tags, ready for serialization.
 * Kept minimal so the serializer is a pure function testable without a DB.
 */
export type ExportablePerson = Person & { tags?: Pick<Tag, "name">[] };

/**
 * Escape a single CSV field per RFC 4180.
 * Fields containing a comma, double-quote, or newline are wrapped in
 * double-quotes, and any embedded double-quotes are doubled.
 */
export function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Serialize a list of people to a CSV string.
 *
 * Pure function (no DB / no I/O) so it can be unit-tested directly.
 * Always emits a header row; an empty list produces just the header.
 *
 * @param people - People to serialize (already scoped to a church by the caller)
 * @returns CSV text with a header row plus one row per person
 */
export function serializePeopleToCsv(people: ExportablePerson[]): string {
  const header = EXPORT_CSV_HEADERS.join(",");

  const rows = people.map((person) => {
    const tags = (person.tags ?? [])
      .map((t) => t.name)
      .filter(Boolean)
      .join("; ");

    const cells: Record<(typeof EXPORT_CSV_HEADERS)[number], string> = {
      firstName: person.firstName ?? "",
      lastName: person.lastName ?? "",
      email: person.email ?? "",
      phone: person.phone ?? "",
      status: person.status ?? "",
      source: person.source ?? "",
      tags,
      addressLine1: person.addressLine1 ?? "",
      addressLine2: person.addressLine2 ?? "",
      city: person.city ?? "",
      state: person.state ?? "",
      postalCode: person.postalCode ?? "",
      country: person.country ?? "",
      notes: person.notes ?? "",
      createdAt: person.createdAt ? person.createdAt.toISOString() : "",
    };

    return EXPORT_CSV_HEADERS.map((key) => escapeCsvField(cells[key])).join(
      ","
    );
  });

  return [header, ...rows].join("\n");
}

/**
 * Build the export filename for a given date, e.g. "people-export-2026-06-22.csv".
 * Defaults to "now" so callers don't have to thread a date through.
 */
export function buildExportFilename(date: Date = new Date()): string {
  const yyyyMmDd = date.toISOString().slice(0, 10);
  return `people-export-${yyyyMmDd}.csv`;
}
