"use client";

import Link from "next/link";
import { Archive, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { AssistantThreadSummary } from "@/lib/assistant/types";

function formatThreadTimestamp(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function AssistantHistorySheet({
  open,
  onOpenChange,
  history,
  onRequestClearHistory,
  isClearingHistory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: AssistantThreadSummary[];
  onRequestClearHistory: () => void;
  isClearingHistory: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md" side="right">
        <SheetHeader className="pb-3">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            Older conversations live here. Opening one will restore it as your
            active assistant thread.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4">
          <Button
            type="button"
            variant="outline"
            className="w-full cursor-pointer justify-between"
            disabled={history.length === 0 || isClearingHistory}
            onClick={onRequestClearHistory}
          >
            Clear history
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <Separator />

        <ScrollArea className="min-h-0 flex-1 px-4 pb-6">
          <div className="space-y-2 pt-4">
            {history.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
                <Archive className="h-5 w-5" />
                <div className="space-y-1">
                  <p className="text-foreground font-medium">
                    No archived conversations
                  </p>
                  <p className="text-sm">
                    Clear the current conversation when you want to start fresh
                    and move it here.
                  </p>
                </div>
              </div>
            ) : (
              history.map((thread) => (
                <Button
                  key={thread.id}
                  asChild
                  variant="ghost"
                  className="h-auto w-full cursor-pointer justify-start rounded-2xl border px-0 py-0 text-left hover:bg-transparent"
                >
                  <Link
                    href={`/assistant/${thread.id}`}
                    onClick={() => onOpenChange(false)}
                  >
                    <div className="flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium">
                          {thread.title}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {formatThreadTimestamp(thread.updatedAt)}
                        </p>
                      </div>
                      <ChevronRight className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    </div>
                  </Link>
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
