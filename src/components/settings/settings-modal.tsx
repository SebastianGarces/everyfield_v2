"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DASHBOARD_MAIN_ID,
  DEFAULT_SETTINGS_SECTION,
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
// TWO COPIES OF THIS COMPONENT EXIST, and three things below turn on which one
// is rendering: whether it draws at all, how a section switch enters history,
// and what Close does. The overlaid copy comes from the intercepting slot; the
// cold-load copy comes from the real `/settings/*` route under `children`, for a
// URL somebody pasted. `dismissal` is the one prop that tells them apart, and
// each rule that reads it carries its own reason at the point of use.
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
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const searchId = useId();

  // WHICH OF THE TWO INSTANCES THIS IS, and everything below turns on it.
  //
  // `replace` is only ever passed by the REAL `/settings/*` route — the one that
  // draws the modal on a cold load, under the layout's `children`. `back` is only
  // ever passed by the intercepting slot. So this reads "am I the cold-load
  // copy?" without the routes having to say it twice.
  const isColdLoad = dismissal.kind === "replace";

  // THE COLD-LOAD COPY STANDS DOWN ONCE THE SLOT TAKES OVER.
  //
  // After a pasted `/settings/church`, `children` is pinned at that route for as
  // long as the document lives — a client-side move to another section is
  // INTERCEPTED into the `@settings` slot and never re-renders `children`. Both
  // trees would then be holding a modal, and two of them stack: one showing
  // Church, one showing Team, each with its own search box.
  //
  // The URL settles it. This copy was rendered for exactly one section; if the
  // address bar no longer names that section, the slot owns the modal and this
  // one must draw nothing. The intercepted copy re-renders on every navigation,
  // so its pathname always matches and this can never hide it — which is why it
  // is gated on `isColdLoad` as well, rather than left to that coincidence.
  const ownHref = settingsSectionHref(activeId);
  const stillMine =
    pathname === ownHref ||
    (pathname === "/settings" && activeId === DEFAULT_SETTINGS_SECTION);
  if (isColdLoad && !stillMine) return null;

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

  // HOW A SECTION SWITCH ENTERS HISTORY, and it is not the same in both copies.
  //
  // Overlaid: REPLACE. There is one settings entry sitting on top of the screen
  // the reader came from, and every section reuses it — so Escape is always
  // exactly one `back()` to that screen, however many sections were opened.
  //
  // Cold-loaded: PUSH. There is nothing behind the modal, so an entry that
  // replaced the first one would leave `back()` pointing out of the app
  // entirely. Pushing means the section switch is a step the reader can take
  // back, and it lands on the cold-load copy again, whose Close is the
  // `replace` below.
  const navReplaces = !isColdLoad;

  function goToSection(href: string) {
    if (navReplaces) router.replace(href);
    else router.push(href);
  }

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
                  replace={navReplaces}
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
