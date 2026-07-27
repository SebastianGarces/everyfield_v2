"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * TEMPORARY — evaluation scaffolding for the W-014 TOC layout ruling, to be
 * stripped once one prototype is chosen.
 *
 * Floating bar at the bottom of the wiki pages that switches between the three
 * TOC layout prototypes by stamping `data-toc-proto` on <html>:
 *
 *   a — Wide: right-rail TOC beside the prose, article card widened to 68rem
 *       so the prose keeps its ~768px measure
 *   b — Sidebar: TOC nested under the active article in the left sidebar,
 *       active styling wrapping the whole block
 *   c — Top: the mobile closed-disclosure TOC, kept on desktop, card width
 *       unchanged
 *
 * The choice persists in localStorage; an inline script in the wiki layout
 * re-applies it before first paint so a reload does not flash prototype A.
 */

export type TocProto = "a" | "b" | "c";

export const TOC_PROTO_STORAGE_KEY = "wiki-toc-proto";

const PROTOTYPES: { id: TocProto; label: string; hint: string }[] = [
  { id: "a", label: "A · Wide", hint: "Right rail, wider article card" },
  { id: "b", label: "B · Sidebar", hint: "TOC under the active sidebar item" },
  { id: "c", label: "C · Top", hint: "Collapsible above the article" },
];

function currentProto(): TocProto {
  const value = document.documentElement.dataset.tocProto;
  return value === "b" || value === "c" ? value : "a";
}

/** Outside the component: the compiler's immutability rule (correctly) has no
 * opinion about module-scope DOM mutation. */
function applyProto(next: TocProto) {
  document.documentElement.dataset.tocProto = next;
  try {
    localStorage.setItem(TOC_PROTO_STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable (private mode); the switch still applies.
  }
}

/** The <html> attribute is external state, so it is read as one. */
function subscribeToProto(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-toc-proto"],
  });
  return () => observer.disconnect();
}

export function TocPrototypeSwitcher() {
  // `null` on the server: it cannot know the stored choice, so the buttons
  // render unselected until hydration reads the attribute the inline script
  // set before first paint.
  const proto = useSyncExternalStore(
    subscribeToProto,
    currentProto,
    () => null
  );

  const select = (next: TocProto) => {
    applyProto(next);
  };

  return (
    <div
      data-testid="toc-proto-switcher"
      className="bg-card fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-1.5 shadow-lg"
    >
      <span className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">
        Prototype
      </span>
      {PROTOTYPES.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          title={hint}
          aria-pressed={proto === id}
          onClick={() => select(id)}
          className={cn(
            "cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors",
            proto === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
