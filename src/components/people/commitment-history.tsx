"use client";

import { getCommitmentDownloadUrlAction } from "@/app/(dashboard)/people/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Commitment, CommitmentType } from "@/db/schema";
import { cn } from "@/lib/utils";
import { ChevronDown, Download, FileText, Loader2, Users } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface CommitmentHistoryProps {
  commitments: Commitment[];
}

const TYPE_LABELS: Record<
  CommitmentType,
  { label: string; variant: "default" | "secondary" }
> = {
  core_group: { label: "Core Group", variant: "default" },
  launch_team: { label: "Launch Team", variant: "secondary" },
};

function CommitmentCard({
  commitment,
  isLatest,
}: {
  commitment: Commitment;
  isLatest: boolean;
}) {
  const [isOpen, setIsOpen] = useState(isLatest);
  const [isDownloading, startDownload] = useTransition();

  const formattedDate = new Date(commitment.signedDate).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  const typeInfo = TYPE_LABELS[commitment.commitmentType];
  const hasDocument = !!commitment.documentUrl;

  const handleDownload = () => {
    startDownload(async () => {
      const result = await getCommitmentDownloadUrlAction(commitment.id);

      if (result.success) {
        // Open in new tab - browser will display or download based on Content-Disposition
        window.open(result.data.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Failed to download document", {
          description: result.error,
        });
      }
    });
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "bg-card rounded-lg border",
          isLatest && "ring-primary/20 ring-2"
        )}
      >
        <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center justify-between p-4 transition-colors">
          <div className="flex items-center gap-3">
            <Badge variant={typeInfo.variant}>
              <Users className="mr-1 h-3 w-3" />
              {typeInfo.label}
            </Badge>
            <div>
              <p className="text-left font-medium">{formattedDate}</p>
              <p className="text-muted-foreground text-left text-sm">
                {hasDocument ? "Document attached" : "No document"}
                {isLatest && (
                  <Badge variant="secondary" className="ml-2">
                    Latest
                  </Badge>
                )}
              </p>
            </div>
          </div>

          <ChevronDown
            className={cn(
              "text-muted-foreground h-5 w-5 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4 border-t px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h5 className="text-muted-foreground mb-1 text-sm font-medium">
                  Commitment Type
                </h5>
                <p className="text-sm">{typeInfo.label}</p>
              </div>
              <div>
                <h5 className="text-muted-foreground mb-1 text-sm font-medium">
                  Date Signed
                </h5>
                <p className="text-sm">{formattedDate}</p>
              </div>
            </div>

            {commitment.notes && (
              <div>
                <h5 className="text-muted-foreground mb-1 text-sm font-medium">
                  Notes
                </h5>
                <p className="text-sm whitespace-pre-wrap">
                  {commitment.notes}
                </p>
              </div>
            )}

            {hasDocument && (
              <div className="border-t pt-4">
                <h5 className="text-muted-foreground mb-2 text-sm font-medium">
                  Attached Document
                </h5>
                <div className="bg-muted/50 flex items-center gap-3 rounded-lg border p-3">
                  <FileText className="text-muted-foreground h-8 w-8" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Commitment Document</p>
                    <p className="text-muted-foreground text-sm">
                      Click to download
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    <span className="ml-2">Download</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function CommitmentHistory({ commitments }: CommitmentHistoryProps) {
  if (commitments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {commitments.map((commitment, index) => (
        <CommitmentCard
          key={commitment.id}
          commitment={commitment}
          isLatest={index === 0}
        />
      ))}
    </div>
  );
}
