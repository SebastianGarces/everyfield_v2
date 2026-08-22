"use client";

import { openSettings } from "@/lib/settings/settings-hash";
import {
  settingsSectionHref,
  type SettingsSectionId,
} from "@/lib/settings/sections";

/**
 * THE ONE WAY TO LINK TO A SETTINGS SECTION from anywhere in the app.
 *
 * A real anchor at a real address, whose plain click is cancelled and sent to
 * `openSettings`. Both halves matter and neither is enough alone: the `href` is
 * what a reader can copy, middle-click and follow with JavaScript off, and the
 * handler is what keeps Next's router in step with the fragment — a native
 * `#`-navigation is invisible to it, and the first `refresh()` afterwards writes
 * the router's stale URL back and closes the modal (see `settings-hash.ts`).
 *
 * IT FORWARDS EVERYTHING IT IS GIVEN, which is the whole reason it takes
 * `ComponentPropsWithRef<"a">` rather than the three props it needs. Its first
 * caller is `<DropdownMenuItem asChild>`, and Radix's `Slot` composes by CLONING
 * the child with the item's own props: `ref`, `role="menuitem"`, `tabIndex`, the
 * data attributes, and the handlers that drive selection. A component that
 * accepted only `section`, `className` and `children` dropped all of them — the
 * avatar menu announced a stray link instead of a menu item, arrow keys skipped
 * it because the missing `ref` kept it out of Radix's roving-focus collection,
 * and the menu did not close on selection. `next/link` had been forwarding them
 * all along, which is why nothing looked wrong in the diff.
 *
 * The incoming `onClick` runs FIRST and is honoured: if a caller (or Radix)
 * prevents the event, this leaves it alone.
 */
export function SettingsLink({
  section,
  onClick,
  ...props
}: React.ComponentPropsWithRef<"a"> & { section: SettingsSectionId }) {
  return (
    <a
      {...props}
      href={settingsSectionHref(section)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // A modified click is the reader asking the BROWSER for something — a
        // new tab, a download, a saved link — so it is left alone, and the
        // `href` is what serves it.
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        openSettings(section);
      }}
    />
  );
}
