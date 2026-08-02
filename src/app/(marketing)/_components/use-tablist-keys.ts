"use client";

import { useCallback, type KeyboardEvent } from "react";

/**
 * The ARIA tablist keyboard model, for a strip whose panels are all already
 * rendered: arrows move between tabs (wrapping), Home/End jump to the ends,
 * and activation is automatic — selection follows focus, which is free when
 * switching is just a display toggle.
 *
 * LTR only: ArrowRight is "next", matching the page's single direction.
 *
 * `keys` must be in the same order the tabs are rendered; the handler goes on
 * the tablist and reads the tabs back out of it.
 */
export function useTablistKeys(
  keys: readonly string[],
  onSelect: (key: string) => void
) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const tabs = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')
      );
      const from = tabs.indexOf(document.activeElement as HTMLElement);
      if (from === -1) return;

      const last = tabs.length - 1;
      let to: number;
      switch (event.key) {
        case "ArrowRight":
          to = from === last ? 0 : from + 1;
          break;
        case "ArrowLeft":
          to = from === 0 ? last : from - 1;
          break;
        case "Home":
          to = 0;
          break;
        case "End":
          to = last;
          break;
        default:
          return;
      }

      event.preventDefault();
      tabs[to].focus();
      onSelect(keys[to]);
    },
    [keys, onSelect]
  );
}
