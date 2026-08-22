"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DASHBOARD_MAIN_ID } from "@/lib/dashboard/main-region";
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
// The screen behind is never re-rendered by any of this: the modal lives in a
// parallel slot that intercepts `/settings/*`, so `children` of the dashboard
// layout is still the route the reader was on, mounted, with its state intact.
//
// TWO COPIES OF THIS COMPONENT CAN EXIST, and `overlaid` is what tells them
// apart: the slot's copy sets it, the real `/settings/*` route under `children`
// — the one that draws for a URL somebody pasted — does not. Exactly one of them
// is ever on screen; the stand-down rule below is what guarantees it.
// ============================================================================

type SettingsModalProps = {
  /** The section the URL names, resolved and gate-checked on the server. */
  activeId: SettingsSectionId;
  /** The sections this account may open, in registry order. */
  visibleIds: readonly SettingsSectionId[];
  /**
   * The exact path this copy was rendered for — `/settings/church`, or the bare
   * `/settings`. NOT the section's canonical href: the bare route renders the
   * default section, so the two differ there, and comparing against the section
   * would leave that copy believing `/settings/account` was still its own.
   */
  ownPath: string;
  /** True only for the copy the intercepting slot rendered. */
  overlaid: boolean;
  /**
   * Where Close goes when nothing is behind the modal. Resolved on the server,
   * because only it knows whether this account's home is the plant dashboard or
   * the oversight one.
   */
  home: string;
  /** The section body — a Server Component. */
  children: React.ReactNode;
};

/**
 * Did this document boot straight into settings, with no app screen behind it?
 *
 * A fact about the DOCUMENT, not about the route rendering right now — which is
 * why it cannot be `overlaid`. After a cold load every later section switch is
 * intercepted, so the slot reports `overlaid: true` while there is still nothing
 * to go back to; closing on that answer walks the reader out of the app.
 *
 * Module scope is the honest scope for a per-document fact, and it is only ever
 * touched from an effect, so a server render never reads or writes it — module
 * state in a `"use client"` file is shared across requests on the server.
 * Cleared on dismiss: once the modal has closed, the reader is on a real screen
 * and the next opening has somewhere to return to.
 */
let bootedIntoSettings: boolean | null = null;

export function SettingsModal({
  activeId,
  visibleIds,
  ownPath,
  overlaid,
  home,
  children,
}: SettingsModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const searchId = useId();

  // First copy to mount in this document wins, and it is the truthful one: on a
  // cold load that is the `children` copy, reporting no overlay; on an in-app
  // open it is the slot's, reporting one.
  useEffect(() => {
    if (bootedIntoSettings === null) bootedIntoSettings = !overlaid;
  }, [overlaid]);

  // THE COLD-LOAD COPY STANDS DOWN ONCE THE SLOT TAKES OVER.
  //
  // After a pasted `/settings/church`, `children` is pinned at that path for as
  // long as the document lives — a client-side move to another section is
  // INTERCEPTED into the `@settings` slot and never re-renders `children`. Both
  // trees would then be holding a modal, and the two stack: one showing Church,
  // one showing Team, each with its own search box and its own Close.
  //
  // The address bar settles it. This copy was rendered for exactly one path; the
  // moment the URL names a different one, the slot owns the modal and this copy
  // draws nothing. The slot's copy re-renders on every navigation, so its
  // pathname always matches — but it is excluded explicitly rather than left to
  // that coincidence.
  if (!overlaid && pathname !== ownPath) return null;

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

  // A SECTION SWITCH ALWAYS REPLACES. Settings occupies exactly ONE history
  // entry however many sections the reader opens, so Close is one step and the
  // entries in between are never sections they had already left.
  //
  // This is the whole of the navigation policy, and it lives here rather than
  // at each link, so a section body cannot spell its own (`church-section.tsx`
  // links to Sharing and must go through this).
  function goToSection(href: string) {
    router.replace(href);
  }

  function dismiss() {
    // One entry means `back()` is right whenever an app screen is behind that
    // entry, and wrong when the document booted into settings — there, `back()`
    // leaves the app. `bootedIntoSettings` is the only thing that knows which,
    // because `overlaid` goes stale the moment a cold load switches section.
    const nothingBehind = bootedIntoSettings ?? !overlaid;
    bootedIntoSettings = null;
    if (nothingBehind) router.replace(home);
    else router.back();
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismiss();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          // Radix restores focus to whatever held it when the dialog opened.
          // That is normally the Settings item inside the avatar dropdown,
          // which has been unmounted by the time we get here, so the restore
          // lands on `<body>` and the next Tab starts at the top of the
          // document. Hand focus to the region the reader is looking at
          // instead.
          event.preventDefault();
          document.getElementById(DASHBOARD_MAIN_ID)?.focus();
        }}
        className="bg-card flex h-[calc(100dvh-1.5rem)] w-full max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl md:h-[min(40rem,calc(100dvh-4rem))] md:flex-row lg:max-w-4xl"
      >
        {/* THE RAIL. `border-b` on a stacked phone layout and `border-r` once
            the two panes sit side by side, so the seam always separates the
            navigation from the section rather than floating. */}
        <div className="bg-muted/40 flex shrink-0 flex-col border-b md:w-56 md:border-r md:border-b-0 lg:w-64">
          {/* `pr-12` ONLY while the panes are stacked. The dialog's Close sits
              at the content's top-right corner, which on a phone is directly
              over this search field — measured at 375px, the two boxes
              overlapped and Close covered the field's own clear button. Once
              the rail moves beside the section (`md`), the corner belongs to
              the section pane and the rail needs no reservation. */}
          <div className="p-3 pr-12 md:pr-3">
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
                  goToSection(settingsSectionHref(first.id));
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
