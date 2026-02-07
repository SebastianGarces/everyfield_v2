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
        "cursor-pointer fixed z-50 shadow-lg transition-all duration-300 ease-in-out",
        "bottom-6 right-6",
        "rounded-full px-4 gap-2",
        // Shift left when panel is open to stay visible
        isOpen && "right-[calc(520px+2rem)] md:right-[calc(520px+2rem)]"
      )}
      aria-label={isOpen ? "Close wiki guide" : "Open wiki guide"}
      title={entry?.label ?? "Wiki Guide"}
    >
      <BookOpen className="size-5" />
      <span className="hidden sm:inline text-sm font-medium">
        {isOpen ? "Close Guide" : "Guide"}
      </span>
    </Button>
  );
}
