"use client";

import { useEffect } from "react";

/**
 * Warm every hidden pane's images right after mount so the first tab switch
 * never flashes. Desktop-gated: hidden panes are display:none, so mobile
 * must never download the desktop crops.
 */
export function usePrefetchShots(sources: readonly (string | undefined)[]) {
  useEffect(() => {
    if (!window.matchMedia("(min-width: 900px)").matches) return;
    for (const src of sources) {
      if (src) new Image().src = src;
    }
  }, [sources]);
}
