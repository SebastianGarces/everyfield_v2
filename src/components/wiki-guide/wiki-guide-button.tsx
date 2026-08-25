"use client";

import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWikiGuide } from "./wiki-guide-provider";
import { cn } from "@/lib/utils";

/**
 * Floating action button that appears when the current page
 * has contextual wiki articles available.
 *
 * Positioned bottom-right, above the Sonner toast area.
 */
export function WikiGuideButton() {
  const { isAvailable, isOpen, toggle, entry } = useWikiGuide();

  if (!isAvailable) return null;

  return (
    <Button
      onClick={toggle}
      variant="default"
      size="lg"
      className={cn(
        "fixed z-50 cursor-pointer shadow-lg transition-[right] duration-300 ease-in-out motion-reduce:transition-none",
        "right-6 bottom-6",
        "gap-2 rounded-full px-4",
        // Mobile has no room beside the panel, so keep the trigger inside the
        // viewport. Desktop shifts it beside the panel to keep both visible.
        isOpen && "right-4 md:right-[calc(520px+2rem)]"
      )}
      aria-label={isOpen ? "Close wiki guide" : "Open wiki guide"}
      title={entry?.label ?? "Wiki Guide"}
    >
      <BookOpen className="size-5" />
      <span className="hidden text-sm font-medium sm:inline">
        {isOpen ? "Close Guide" : "Guide"}
      </span>
    </Button>
  );
}
