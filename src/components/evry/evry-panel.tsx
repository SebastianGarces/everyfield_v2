"use client";

import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { ConversationSurface } from "./conversation-surface";
import { useEvryShell } from "./evry-shell";

export function EvryPanel() {
  const { closePanel, expandToWorkspace, isPanelOpen, restoreLauncherFocus } =
    useEvryShell();

  return (
    <Sheet
      modal={true}
      open={isPanelOpen}
      onOpenChange={(open) => !open && closePanel()}
    >
      <SheetContent
        id="evry-panel"
        aria-label="Evry panel"
        showCloseButton={true}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreLauncherFocus();
        }}
        className="w-full max-w-none gap-0 overflow-hidden p-0 sm:max-w-[28rem]"
      >
        <SheetHeader className="shrink-0 border-b pr-12">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle>Evry</SheetTitle>
              <SheetDescription className="text-pretty">
                Work in EveryField without leaving this page.
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={expandToWorkspace}
              aria-label="Expand Evry to workspace"
              className="shrink-0 cursor-pointer active:scale-[0.96]"
            >
              <Maximize2 aria-hidden="true" />
            </Button>
          </div>
        </SheetHeader>
        <ConversationSurface />
      </SheetContent>
    </Sheet>
  );
}
