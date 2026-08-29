"use client";

import { RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { EvryHistoryCheckpoint } from "./history-presentation";

export function ConversationHistoryCheckpoint({
  checkpoint,
  onRebuild,
}: {
  checkpoint: EvryHistoryCheckpoint;
  onRebuild: () => void;
}) {
  return (
    <section
      aria-labelledby="evry-resume-point-title"
      data-testid="evry-history-checkpoint"
      data-kind={checkpoint.kind}
      data-state={checkpoint.rebuildRequired ? "rebuild_required" : "current"}
      className="bg-muted/50 shrink-0 space-y-2 border-b px-4 py-3 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline">{checkpoint.label}</Badge>
        {checkpoint.rebuildRequired ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRebuild}
            className="cursor-pointer active:scale-[0.96]"
          >
            <RotateCcw aria-hidden="true" />
            Rebuild plan
          </Button>
        ) : null}
      </div>
      <div className="space-y-1">
        <h3 id="evry-resume-point-title" className="text-sm font-semibold">
          {checkpoint.title}
        </h3>
        {checkpoint.detail ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {checkpoint.detail}
          </p>
        ) : null}
      </div>
    </section>
  );
}
