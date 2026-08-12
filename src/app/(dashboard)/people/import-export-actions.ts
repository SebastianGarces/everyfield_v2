"use server";

import {
  buildExportFilename,
  serializePeopleToCsv,
  type ExportablePerson,
} from "@/lib/people/export";
import {
  executeBulkImport,
  generateCsvTemplate,
  parseCsvImport,
} from "@/lib/people/import";
import {
  getPeopleForExport,
  type ExportPeopleOptions,
} from "@/lib/people/service";
import { getTagsForPeople } from "@/lib/people/tags";
import type {
  ActionResult,
  ImportPreview,
  ImportRow,
  ImportSummary,
  PersonSource,
  PersonStatus,
} from "@/lib/people/types";
import { revalidatePath } from "next/cache";
import { withChurchSession } from "./action-context";

/**
 * Download CSV template for bulk import
 */
export async function downloadCsvTemplateAction(): Promise<
  ActionResult<string>
> {
  return withChurchSession(
    "downloadCsvTemplateAction",
    { fallback: "Failed to generate template" },
    async () => {
      const csv = generateCsvTemplate();
      return { success: true, data: csv };
    }
  );
}

/**
 * Filters that can be passed to the export action. Mirror the people list
 * query params so the export reflects the currently-filtered set.
 */
export interface ExportPeopleFilters {
  status?: PersonStatus[];
  source?: PersonSource[];
  search?: string;
  tagIds?: string[];
}

/**
 * Export the current church's contacts to CSV (P-027).
 *
 * Scoped to the current user's church (tenancy invariant) and respects the
 * same filters as the people list. Returns the CSV payload plus a suggested
 * filename; the client triggers the download. Empty list → header-only CSV.
 */
export async function exportPeopleAction(
  filters: ExportPeopleFilters = {}
): Promise<
  ActionResult<{ csv: string; filename: string; contentType: string }>
> {
  return withChurchSession(
    "exportPeopleAction",
    {
      noChurch: "You must be associated with a church to export people",
      fallback: "Failed to export people",
    },
    async ({ churchId }) => {
      const options: ExportPeopleOptions = {
        status: filters.status,
        source: filters.source,
        search: filters.search,
        tagIds: filters.tagIds,
      };

      // Fetch the filtered set scoped to this church, then batch-load tags
      // (single query, no N+1) and attach them for serialization.
      const people = await getPeopleForExport(churchId, options);
      const tagMap = await getTagsForPeople(
        churchId,
        people.map((p) => p.id)
      );

      const exportable: ExportablePerson[] = people.map((person) => ({
        ...person,
        tags: tagMap.get(person.id) ?? [],
      }));

      const csv = serializePeopleToCsv(exportable);

      return {
        success: true,
        data: {
          csv,
          filename: buildExportFilename(),
          contentType: "text/csv",
        },
      };
    }
  );
}

/**
 * Preview a CSV file for import (parse, validate, detect duplicates)
 */
export async function previewImportAction(
  formData: FormData
): Promise<ActionResult<ImportPreview>> {
  return withChurchSession(
    "previewImportAction",
    { fallback: "Failed to process CSV file" },
    async ({ churchId }) => {
      const file = formData.get("file") as File | null;
      if (!file) {
        return { success: false, error: "No file provided" };
      }

      const csvContent = await file.text();
      const preview = await parseCsvImport(csvContent, churchId);

      return { success: true, data: preview };
    }
  );
}

/**
 * Execute bulk import of people
 *
 * The rows arrive back from the wizard carrying only redacted duplicate
 * matches ({ id, displayName } — ruling 410-3C); any server-side logic that
 * needs a matched contact resolves it by that id. Row data itself is
 * re-validated inside `executeBulkImport`, never trusted.
 */
export async function executeBulkImportAction(
  rows: ImportRow[],
  duplicateResolutions: Record<number, "skip" | "create">
): Promise<ActionResult<ImportSummary>> {
  return withChurchSession(
    "executeBulkImportAction",
    { fallback: "Failed to execute import" },
    async ({ user, churchId }) => {
      const summary = await executeBulkImport(
        churchId,
        user.id,
        rows,
        duplicateResolutions
      );

      revalidatePath("/people");
      return { success: true, data: summary };
    }
  );
}
