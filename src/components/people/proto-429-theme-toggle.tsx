"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * PROTOTYPE ONLY — never merge. A light/dark switch for the #429 review.
 *
 * The app mounts no theme provider today: `<html>` never gets the `dark` class,
 * so `.dark` in globals.css is reachable by the test suite and by nothing else.
 * Half of this ruling is about the dark theme, so the review needs a way in.
 * That is all this is — it persists nothing and manages no preference.
 */

const DARK = "dark";

function subscribe(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

export function Proto429ThemeToggle() {
  const isDark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains(DARK),
    () => false
  );

  return (
    <button
      type="button"
      title="Toggle the dark theme — the app ships no theme switch, and half this ruling is about the dark ground"
      aria-pressed={isDark}
      onClick={() => document.documentElement.classList.toggle(DARK)}
      className={cn(
        "cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors",
        isDark
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      Dark
    </button>
  );
}
