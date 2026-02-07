import { db } from "@/db";
import { personActivities, persons, type NewPerson } from "@/db/schema";
import { personCreateSchema } from "@/lib/validations/people";
import { checkForDuplicates } from "./duplicates";
import type { ImportPreview, ImportRow, ImportSummary } from "./types";

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
function parseCsvString(csvContent: string): Record<string, string>[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  // Parse header row - map from display labels back to field names
  const headerLine = lines[0];
  const rawHeaders = parseCsvLine(headerLine);

  // Create a reverse lookup from label to field name
  const labelToField: Record<string, string> = {};
  for (const [field, label] of Object.entries(CSV_HEADER_LABELS)) {
    labelToField[label.toLowerCase()] = field;
  }

  // Also support direct field names (camelCase)
  for (const field of CSV_HEADERS) {
    labelToField[field.toLowerCase()] = field;
  }

  const fieldNames = rawHeaders.map((header) => {
    const normalized = header.trim().toLowerCase();
    return labelToField[normalized] ?? header.trim();
  });

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};

    for (let j = 0; j < fieldNames.length; j++) {
      const value = values[j]?.trim() ?? "";
      if (value) {
        row[fieldNames[j]] = value;
      }
    }

    // Skip completely empty rows
    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }

  result.push(current);
  return result;
}

// ============================================================================
// Import Preview
// ============================================================================

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

  const validRows: ImportRow[] = [];
  const invalidRows: ImportRow[] = [];
  const duplicateRows: ImportRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    const rowNumber = i + 2; // +2 for 1-indexed + header row

    // Validate against schema
    const parseResult = personCreateSchema.safeParse({
      firstName: rawRow.firstName,
      lastName: rawRow.lastName,
      email: rawRow.email || undefined,
      phone: rawRow.phone || undefined,
      source: rawRow.source || undefined,
      addressLine1: rawRow.addressLine1 || undefined,
      addressLine2: rawRow.addressLine2 || undefined,
      city: rawRow.city || undefined,
      state: rawRow.state || undefined,
      postalCode: rawRow.postalCode || undefined,
      country: rawRow.country || undefined,
      notes: rawRow.notes || undefined,
      status: "prospect", // Always default to prospect for imports
    });

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

    // Check for duplicates
    const duplicates = await checkForDuplicates(churchId, {
      email: rawRow.email || null,
      firstName: rawRow.firstName,
      lastName: rawRow.lastName,
      phone: rawRow.phone || null,
    });

    const row: ImportRow = {
      rowNumber,
      data: rawRow,
      valid: errors.length === 0,
      errors,
      duplicates,
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
  duplicateResolutions: Record<number, "skip" | "create">
): Promise<ImportSummary> {
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

    // Skip invalid rows
    if (!row.valid) {
      errors++;
      continue;
    }

    try {
      const data = row.data;

      const values: NewPerson = {
        churchId,
        createdBy: userId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        addressLine1: data.addressLine1 || null,
        addressLine2: data.addressLine2 || null,
        city: data.city || null,
        state: data.state || null,
        postalCode: data.postalCode || null,
        country: data.country || "US",
        status: "prospect",
        source: (data.source as NewPerson["source"]) || null,
        sourceDetails: null,
        notes: data.notes || null,
      };

      const [person] = await db
        .insert(persons)
        .values(values)
        .returning({ id: persons.id });

      // Log activity for person creation
      await db.insert(personActivities).values({
        churchId,
        personId: person.id,
        activityType: "person_created",
        metadata: { source: "bulk_import" },
        performedBy: userId,
      });

      created++;
    } catch {
      errors++;
    }
  }

  return { created, skipped, errors };
}
