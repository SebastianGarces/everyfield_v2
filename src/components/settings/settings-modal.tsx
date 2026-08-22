"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SETTINGS_SECTIONS,
  sectionMatchesQuery,
  settingsSectionHref,
  type SettingsSectionId,
} from "@/lib/settings/sections";

// ============================================================================
// THE SETTINGS MODAL — chrome only (CS-001, CS-016, #615).
//
// It draws the side navigation, the search box and the frame; the SECTION is
// `children`, rendered on the server by the route and handed through. That
// split is what keeps every section body a Server Component holding its own
// reads — the modal never learns what a section contains, and a section never
// learns it is in a modal.
//
// THE NAV IS `<Link replace>`, NOT A PUSH, AND THAT IS THE CLOSE BEHAVIOUR'S
// OTHER HALF. Closing an overlaid modal is `router.back()`; if switching
// sections pushed, a reader who looked at three sections would need three
// presses of Escape to get back to the screen they opened settings from, and
// the two in between would be sections they had already left. Replacing keeps
// exactly one settings entry in history, so Escape always lands on the screen
// behind — which is what "closing returns to the screen behind" means.
//
// The screen behind is never re-rendered by any of this: the modal lives in a
// parallel slot that intercepts `/settings/*`, so `children` of the dashboard
// layout is still the route the reader was on, mounted, with its state intact.
// ============================================================================

/**
 * What closing does, decided by the ROUTE that rendered the modal and never
 * guessed from history length.
 *
 * - `back` — the modal was intercepted over a live screen, so the screen behind
 *   is one entry back and is still mounted.
 * - `replace` — the URL was loaded cold and there is nothing behind it. The
 *   settings entry is replaced rather than pushed so Back does not reopen it.
 */
export type SettingsDismissal =
  | { kind: "back" }
  | { kind: "replace"; href: string };

type SettingsModalProps = {
  /** The section the URL names, resolved and gate-checked on the server. */
  activeId: SettingsSectionId;
  /** The sections this account may open, in registry order. */
  visibleIds: readonly SettingsSectionId[];
  dismissal: SettingsDismissal;
  /** The section body — a Server Component. */
  children: React.ReactNode;
};

export function SettingsModal({
  activeId,
  visibleIds,
  dismissal,
  children,
}: SettingsModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchId = useId();

  const active = SETTINGS_SECTIONS.find((section) => section.id === activeId);

  // The nav's own subject: the visible sections in registry order. `inNav` is
  // what keeps `sharing` addressable without listing a sixth entry the ruling
  // does not name.
  const navSections = SETTINGS_SECTIONS.filter(
    (section) => section.inNav && visibleIds.includes(section.id)
  );
  const matches = navSections.filter((section) =>
    sectionMatchesQuery(section, query)
  );
  const searching = query.trim() !== "";

  function dismiss() {
    if (dismissal.kind === "back") {
      router.back();
      return;
    }
    router.replace(dismissal.href);
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismiss();
      }}
    >
      <DialogContent className="bg-card flex h-[calc(100dvh-1.5rem)] w-full max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl md:h-[min(40rem,calc(100dvh-4rem))] md:flex-row lg:max-w-4xl">
        {/* THE RAIL. `border-b` on a stacked phone layout and `border-r` once
            the two panes sit side by side, so the seam always separates the
            navigation from the section rather than floating. */}
        <div className="bg-muted/40 flex shrink-0 flex-col border-b md:w-56 md:border-r md:border-b-0 lg:w-64">
          <div className="p-3">
            {/* A real label, visually hidden: the placeholder is an example of
                what to type and disappears the moment anything is typed. */}
            <label htmlFor={searchId} className="sr-only">
              Search settings
            </label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                id={searchId}
                type="search"
                value={query}
                placeholder="Search"
                autoComplete="off"
                className="bg-background pl-8"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter jumps to the first match, so a reader who typed
                  // "zone" never has to move to the mouse to open the section
                  // holding it (CS-016: "choosing a match shows its section").
                  if (event.key !== "Enter") return;
                  const first = matches[0];
                  if (!first) return;
                  event.preventDefault();
                  router.replace(settingsSectionHref(first.id));
                }}
              />
            </div>
          </div>

          <nav
            aria-label="Settings sections"
            className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-x-visible md:overflow-y-auto"
          >
            {matches.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeId;
              return (
                <Link
                  key={section.id}
                  href={settingsSectionHref(section.id)}
                  replace
                  aria-current={isActive ? "page" : undefined}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors md:shrink ${
                    isActive
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {section.label}
                </Link>
              );
            })}
          </nav>

          {/* Named query and a way out, rather than a shrug. Polite rather than
              assertive: the count is a result, not an error, and the region is
              rendered on every pass so a repeated update is announced. */}
          <p
            role="status"
            className={`text-muted-foreground px-3 pb-3 text-sm text-pretty ${
              searching && matches.length === 0 ? "" : "sr-only"
            }`}
          >
            {searching
              ? matches.length === 0
                ? `No settings match “${query.trim()}”.`
                : `${matches.length} of ${navSections.length} sections shown.`
              : ""}
          </p>
          {searching && matches.length === 0 && (
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-foreground cursor-pointer text-sm font-medium underline underline-offset-4"
              >
                Clear search
              </button>
            </div>
          )}
        </div>

        {/* THE SECTION. `overscroll-contain` so a flick at the end of a long
            section does not scroll the screen behind the modal. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <div className="space-y-1 px-5 pt-5 pr-12 md:px-6 md:pt-6 md:pr-14">
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {active?.label ?? "Settings"}
            </DialogTitle>
            {active && (
              <DialogDescription className="text-pretty">
                {active.description}
              </DialogDescription>
            )}
          </div>

          <div className="flex-1 px-5 py-5 md:px-6 md:py-6">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
