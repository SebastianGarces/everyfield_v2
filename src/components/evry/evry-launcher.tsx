"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useEvryShell } from "./evry-shell";

export function EvryLauncher() {
  const { isEnabled, isPanelOpen, openPanel } = useEvryShell();
  if (!isEnabled) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={isPanelOpen}
      aria-controls="evry-panel"
      onClick={(event) => openPanel(event.currentTarget)}
      className="text-app-bar-foreground hover:text-app-bar-foreground h-8 cursor-pointer gap-1.5 px-2 hover:bg-white/10 focus-visible:ring-white/70 active:scale-[0.96]"
    >
      <Sparkles aria-hidden="true" className="size-4" />
      <span>Evry</span>
    </Button>
  );
}
