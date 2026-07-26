"use client";

import {
  exportPeopleAction,
  type ExportPeopleFilters,
} from "@/app/(dashboard)/people/actions";
import { Button } from "@/components/ui/button";
import type { PersonSource, PersonStatus } from "@/lib/people/types";
import { Download, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

/**
 * "Export" button for the people list. Reads the active list filters from the
 * URL so the exported CSV reflects the same filtered set the user is viewing,
 * calls {@link exportPeopleAction}, and triggers a browser download.
 */
export function ExportButton() {
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();

  function handleExport() {
    // Mirror the people-list URL params (status/source/tag are multi-valued,
    // search is single) so the export matches the current view.
    const filters: ExportPeopleFilters = {
      status: searchParams.getAll("status") as PersonStatus[],
      source: searchParams.getAll("source") as PersonSource[],
      tagIds: searchParams.getAll("tag"),
      search: searchParams.get("search") ?? undefined,
    };

    startTransition(async () => {
      const result = await exportPeopleAction(filters);

      if (!result.success) {
        toast.error(result.error ?? "Failed to export people");
        return;
      }

      const { csv, filename, contentType } = result.data;
      const blob = new Blob([csv], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="cursor-pointer"
      onClick={handleExport}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      Export
    </Button>
  );
}
