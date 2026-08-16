"use client";

import { Download, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { getGeneratedDocumentDownloadUrlAction } from "@/app/(dashboard)/documents/actions";
import { Button } from "@/components/ui/button";

export function HistoryDownloadButton({
  artifactId,
  label,
}: {
  artifactId: string;
  label: string;
}) {
  const [isDownloading, startDownload] = useTransition();

  function handleDownload() {
    startDownload(async () => {
      const result = await getGeneratedDocumentDownloadUrlAction({
        id: artifactId,
      });

      if (result.success) {
        window.open(result.data.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Failed to download document", {
          description: result.error,
        });
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="cursor-pointer"
      onClick={handleDownload}
      disabled={isDownloading}
      aria-label={`Download ${label}`}
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      Download
    </Button>
  );
}
