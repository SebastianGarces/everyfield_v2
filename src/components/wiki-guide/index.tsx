"use client";

import { WikiGuideProvider } from "./wiki-guide-provider";
import { WikiGuideButton } from "./wiki-guide-button";
import { WikiGuidePanel } from "./wiki-guide-panel";

/**
 * Contextual Wiki Guide widget.
 *
 * Drop this into any layout to enable a floating wiki article panel.
 * It automatically reads the current URL and shows relevant articles
 * based on the route-to-slug mapping in `src/lib/wiki/guide-config.ts`.
 *
 * Usage:
 *   import { WikiGuide } from "@/components/wiki-guide";
 *   // Inside a layout:
 *   <WikiGuide />
 */
export function WikiGuide() {
  return (
    <WikiGuideProvider>
      <WikiGuideButton />
      <WikiGuidePanel />
    </WikiGuideProvider>
  );
}

// Re-export for advanced use cases
export { WikiGuideProvider, useWikiGuide } from "./wiki-guide-provider";
export { WikiGuideButton } from "./wiki-guide-button";
export { WikiGuidePanel } from "./wiki-guide-panel";
