import { personCreateSchema } from "@/lib/validations/people";
import { findDuplicateMatches } from "./duplicates";
import { createPerson } from "./service";
import type {
  DuplicateMatches,
  ImportDuplicateMatch,
  ImportPreview,
  ImportRow,
  ImportRowDuplicates,
  ImportSummary,
  Person,
} from "./types";

// ============================================================================
// CSV Template
// ============================================================================

const CSV_HEADERS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "source",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "notes",
] as const;

const CSV_HEADER_LABELS: Record<(typeof CSV_HEADERS)[number], string> = {
  firstName: "First Name *",
  lastName: "Last Name *",
  email: "Email",
  phone: "Phone",
  source: "Source",
  addressLine1: "Address Line 1",
  addressLine2: "Address Line 2",
  city: "City",
  state: "State",
  postalCode: "Postal Code",
  country: "Country",
  notes: "Notes",
};

const VALID_SOURCES = [
  "personal_referral",
  "social_media",
  "vision_meeting",
  "website",
  "event",
  "partner_church",
  "other",
];

/**
 * Generate a CSV template string for person import
 */
export function generateCsvTemplate(): string {
  const headers = CSV_HEADERS.map((h) => CSV_HEADER_LABELS[h]).join(",");
  const exampleRow = [
    "John",
    "Smith",
    "john@example.com",
    "555-0123",
    "personal_referral",
    "123 Main St",
    "Apt 4B",
    "Springfield",
    "IL",
    "62704",
    "US",
    "Met at community event",
  ].join(",");

  return `${headers}\n${exampleRow}`;
}

// ============================================================================
// CSV Parsing
// ============================================================================

/**
 * Parse a CSV string into rows of key-value pairs
 */
export function parseCsvString(csvContent: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  const content = csvContent.replace(/^\uFEFF/, "");
  const finishField = () => {
    record.push(field);
    field = "";
    closedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (record.some((value) => value.trim().length > 0)) records.push(record);
    record = [];
  };
  for (let i = 0; i < content.length; i++) {
    const character = content[i];
    if (quoted) {
      if (character === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      finishRecord();
      if (character === "\r" && content[i + 1] === "\n") i++;
    } else if (character === '"') {
      if (field.length > 0 || closedQuote)
        throw new Error("Invalid CSV: quote must begin a field");
      quoted = true;
    } else {
      if (closedQuote)
        throw new Error("Invalid CSV: unexpected text after a closing quote");
      field += character;
    }
  }
  if (quoted) throw new Error("Invalid CSV: unterminated quoted field");
  if (field.length > 0 || record.length > 0 || closedQuote) finishRecord();
  if (records.length < 2) return [];

  const labelToField: Record<string, string> = {};
  for (const [name, label] of Object.entries(CSV_HEADER_LABELS))
    labelToField[label.toLowerCase()] = name;
  for (const name of CSV_HEADERS) labelToField[name.toLowerCase()] = name;
  const fieldNames = records[0].map((header) => {
    const normalized = header.trim().toLowerCase();
    return labelToField[normalized] ?? header.trim();
  });
  return records.slice(1).map((values) => {
    const row: Record<string, string> = {};
    for (let i = 0; i < fieldNames.length; i++) {
      const value = values[i]?.trim() ?? "";
      if (value) row[fieldNames[i]] = value;
    }
    return row;
  });
}

// ============================================================================
// Row Validation
// ============================================================================

/**
 * Parse one CSV row's fields through the person schema — the ONE parse both
 * the preview and the execute step use, so the rows that are written are
 * validated by exactly the rule the preview showed.
 */
function parseImportRowData(data: Record<string, string>) {
  return personCreateSchema.safeParse({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email || undefined,
    phone: data.phone || undefined,
    source: data.source || undefined,
    addressLine1: data.addressLine1 || undefined,
    addressLine2: data.addressLine2 || undefined,
    city: data.city || undefined,
    state: data.state || undefined,
    postalCode: data.postalCode || undefined,
    country: data.country || undefined,
    notes: data.notes || undefined,
    status: "prospect" as const, // Always default to prospect for imports
  });
}

// ============================================================================
// Import Preview
// ============================================================================

/**
 * How many duplicate checks run concurrently during preview. Bounded so a
 * large CSV cannot open an unbounded number of simultaneous queries.
 */
const DUPLICATE_CHECK_CONCURRENCY = 10;

/**
 * Strip the duplicate matches down to what the wizard needs to explain a
 * match (ruling 410-3C): id + display name. The matched contacts' full
 * records (emails, phones, addresses) never leave the server — the preview
 * action returns this shape, and the execute action resolves any match it
 * needs server-side by id. The preview also never loads what it would
 * redact: it calls `findDuplicateMatches`, not the tag-decorating
 * `checkForDuplicates`, so no `person_tags` query runs at all.
 */
function toImportRowDuplicates(check: DuplicateMatches): ImportRowDuplicates {
  const summarize = (person: Person): ImportDuplicateMatch => ({
    id: person.id,
    displayName: `${person.firstName} ${person.lastName}`,
  });

  return {
    exactMatch: check.exactMatch ? summarize(check.exactMatch) : null,
    potentialMatches: check.potentialMatches.map(summarize),
  };
}

/**
 * Parse and validate a CSV file, returning a preview with validation results
 * and duplicate detection per row
 */
export async function parseCsvImport(
  csvContent: string,
  churchId: string
): Promise<ImportPreview> {
  const rawRows = parseCsvString(csvContent);

  if (rawRows.length === 0) {
    return {
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      duplicateRows: [],
    };
  }

  // The per-row duplicate checks are independent, so run them in bounded
  // chunks instead of one serialized round trip per CSV row — preview time
  // stops being linear in round trips.
  const duplicateChecks: DuplicateMatches[] = [];
  for (let i = 0; i < rawRows.length; i += DUPLICATE_CHECK_CONCURRENCY) {
    const chunk = rawRows.slice(i, i + DUPLICATE_CHECK_CONCURRENCY);
    const results = await Promise.all(
      chunk.map((rawRow) =>
        findDuplicateMatches(churchId, {
          email: rawRow.email || null,
          firstName: rawRow.firstName,
          lastName: rawRow.lastName,
          phone: rawRow.phone || null,
        })
      )
    );
    duplicateChecks.push(...results);
  }

  const validRows: ImportRow[] = [];
  const invalidRows: ImportRow[] = [];
  const duplicateRows: ImportRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    const rowNumber = i + 2; // +2 for 1-indexed + header row

    // Validate against schema
    const parseResult = parseImportRowData(rawRow);

    const errors: string[] = [];

    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        errors.push(`${issue.path.join(".")}: ${issue.message}`);
      }
    }

    // Validate source value if provided
    if (rawRow.source && !VALID_SOURCES.includes(rawRow.source.toLowerCase())) {
      errors.push(
        `source: Invalid value "${rawRow.source}". Valid values: ${VALID_SOURCES.join(", ")}`
      );
    }

    const duplicates = duplicateChecks[i];

    const row: ImportRow = {
      rowNumber,
      data: rawRow,
      valid: errors.length === 0,
      errors,
      duplicates: toImportRowDuplicates(duplicates),
    };

    if (errors.length > 0) {
      invalidRows.push(row);
    } else if (
      duplicates.exactMatch ||
      duplicates.potentialMatches.length > 0
    ) {
      duplicateRows.push(row);
    } else {
      validRows.push(row);
    }
  }

  return {
    totalRows: rawRows.length,
    validRows,
    invalidRows,
    duplicateRows,
  };
}

// ============================================================================
// Bulk Import Execution
// ============================================================================

/**
 * Execute a bulk import, creating persons in a transaction
 *
 * @param churchId - Church to import into
 * @param userId - User performing the import
 * @param rows - Validated rows to import
 * @param duplicateResolutions - Map of row number to resolution ('skip' | 'create')
 */
export async function executeBulkImport(
  churchId: string,
  userId: string,
  rows: ImportRow[],
  duplicateResolutions: Record<number, "skip" | "create" | "review">
): Promise<ImportSummary> {
  const reviewPairs: NonNullable<ImportSummary["reviewPairs"]> = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    // Check if this row should be skipped (duplicate resolution)
    const resolution = duplicateResolutions[row.rowNumber];
    if (resolution === "skip") {
      skipped++;
      continue;
    }

    // Re-validate server-side. The rows arrive from the client, so the
    // client's `valid` flag is never trusted — each row goes through the
    // same schema the preview used, and a parse failure counts as an error
    // exactly like an invalid preview row did. Real imports are unaffected
    // because the preview already parsed the same rows with the same schema.
    const parseResult = parseImportRowData(row.data);
    if (!parseResult.success) {
      errors++;
      continue;
    }

    try {
      // The service owns the insert, the person.created emit and the
      // person_created activity (ruling 410-2A) — no duplicated write path.
      const matches =
        resolution === "review"
          ? await findDuplicateMatches(churchId, parseResult.data)
          : null;
      const match = matches?.exactMatch ?? matches?.potentialMatches[0];
      const person = await createPerson(
        churchId,
        userId,
        parseResult.data,
        "bulk_import"
      );
      if (match)
        reviewPairs.push({
          createdId: person.id,
          matchId: match.id,
          displayName: `${person.firstName} ${person.lastName}`,
        });

      created++;
    } catch {
      errors++;
    }
  }

  return {
    created,
    skipped,
    errors,
    ...(reviewPairs.length ? { reviewPairs } : {}),
  };
}
