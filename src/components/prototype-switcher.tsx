"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * A floating pill for evaluating N competing UI implementations live, in the
 * real app, before ruling on one. Not mounted anywhere in production — this
 * is a harness to reach for whenever a design decision deserves side-by-side
 * candidates instead of a guess. First used for the W-014 wiki TOC layout
 * ruling (PR #138), where three layouts shipped together and the winner was
 * picked by flipping between them on the preview deployment.
 *
 * ## The pattern
 *
 * 1. Build every candidate into the SAME branch, all present in the DOM,
 *    selected purely by CSS keyed off an attribute on <html>. With Tailwind,
 *    ancestor arbitrary variants do this statically:
 *
 *      className="hidden [[data-my-proto=b]_&]:block"
 *      className="max-w-3xl [[data-my-proto=a]_&]:lg:max-w-5xl"
 *
 *    Switching is instant — no reload, no re-render, scroll position kept —
 *    which is what makes A/B/C comparison honest.
 *
 * 2. Mount this switcher in the layout that owns the page under evaluation:
 *
 *      <PrototypeSwitcher
 *        attribute="data-my-proto"
 *        storageKey="my-proto"
 *        options={[
 *          { id: "a", label: "A · Wide", hint: "what A does" },
 *          { id: "b", label: "B · Sidebar", hint: "what B does" },
 *        ]}
 *      />
 *
 * 3. Re-apply the stored choice before first paint so reloads don't flash
 *    the default — render the string from `prototypeInitScript` in the same
 *    layout. React never manages <html> attributes, so this cannot cause a
 *    hydration mismatch:
 *
 *      <script dangerouslySetInnerHTML={{ __html: prototypeInitScript(
 *        "data-my-proto", "my-proto", ["a", "b"]) }} />
 *
 * 4. After the ruling: delete the losing variants, collapse the winner's
 *    variant classes into plain ones, unmount the switcher and the script.
 *    The evaluation scaffolding never merges as live UI.
 */

export type PrototypeOption = {
  /** Attribute value; keep it short ("a", "b", "c"). */
  id: string;
  /** Button text, e.g. "A · Wide". */
  label: string;
  /** Tooltip: one line on what this candidate does. */
  hint?: string;
};

type PrototypeSwitcherProps = {
  /** The attribute stamped on <html>, e.g. "data-toc-proto". */
  attribute: string;
  /** localStorage key persisting the choice across reloads. */
  storageKey: string;
  options: PrototypeOption[];
  /** Pill caption. */
  label?: string;
};

/**
 * The inline-script source that re-applies the stored choice before first
 * paint. Values outside `ids` fall back to the first id, so a stale stored
 * value from a finished evaluation can never select nothing.
 */
export function prototypeInitScript(
  attribute: string,
  storageKey: string,
  ids: string[]
): string {
  const idsJson = JSON.stringify(ids);
  return `try{var p=localStorage.getItem(${JSON.stringify(storageKey)});document.documentElement.setAttribute(${JSON.stringify(attribute)},${idsJson}.includes(p)?p:${JSON.stringify(ids[0])})}catch(e){document.documentElement.setAttribute(${JSON.stringify(attribute)},${JSON.stringify(ids[0])})}`;
}

/** Outside the component: the compiler's immutability rule (correctly) has no
 * opinion about module-scope DOM mutation. */
function applyPrototype(attribute: string, storageKey: string, id: string) {
  document.documentElement.setAttribute(attribute, id);
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // Storage may be unavailable (private mode); the switch still applies.
  }
}

/** The <html> attribute is external state, so it is read as one. */
function subscribeToAttribute(attribute: string) {
  return (onStoreChange: () => void) => {
    const observer = new MutationObserver(onStoreChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [attribute],
    });
    return () => observer.disconnect();
  };
}

export function PrototypeSwitcher({
  attribute,
  storageKey,
  options,
  label = "Prototype",
}: PrototypeSwitcherProps) {
  // `null` on the server: it cannot know the stored choice, so the buttons
  // render unselected until hydration reads the attribute the init script
  // set before first paint.
  const active = useSyncExternalStore(
    subscribeToAttribute(attribute),
    () => document.documentElement.getAttribute(attribute),
    () => null
  );

  return (
    <div
      data-testid="prototype-switcher"
      className="bg-card fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-1.5 shadow-lg"
    >
      <span className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      {options.map(({ id, label: optionLabel, hint }) => (
        <button
          key={id}
          type="button"
          title={hint}
          aria-pressed={active === id}
          onClick={() => applyPrototype(attribute, storageKey, id)}
          className={cn(
            "cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors",
            active === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}
