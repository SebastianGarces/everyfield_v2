"use client";

import { Search, XIcon } from "lucide-react";
import {
  Suspense,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AccountSection } from "@/components/settings/sections/account-section";
import { AssociationSection } from "@/components/settings/sections/association-section";
import { ChurchSection } from "@/components/settings/sections/church-section";
import { NotificationsSection } from "@/components/settings/sections/notifications-section";
import { TeamSection } from "@/components/settings/sections/team-section";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { loginPathFor } from "@/lib/auth/safe-redirect";
import { DASHBOARD_PAGE_CONTENT_ID } from "@/lib/dashboard/main-region";
import { cn } from "@/lib/utils";
import {
  cachedSectionView,
  closeSettings,
  sectionRequest,
  settingsHashServerSnapshot,
  settingsHashSnapshot,
  showSection,
  subscribeToSettingsHash,
} from "@/lib/settings/settings-hash";
import type {
  SettingsSectionLoad,
  SettingsSectionViewOf,
} from "@/lib/settings/section-view";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  sectionMatchesQuery,
  settingsSectionFromHash,
  settingsSectionHref,
  type SettingsSectionId,
} from "@/lib/settings/sections";

// ============================================================================
// THE SETTINGS MODAL — client state over whatever screen you are on (#657,
// ruled 2026-08-22, superseding the routing half of 2026-08-21 §187).
//
// ONE COMPONENT, MOUNTED ONCE, BY THE DASHBOARD LAYOUT. It is not a route and it
// is not a slot: it reads `location.hash`, and `#settings/<section>` is the
// whole of its state. So switching sections rewrites a fragment and nothing
// else — no navigation, no new RSC render of the screen behind, no remount of
// this component, and therefore no second open animation. `/phase` is still
// `/phase` the entire time, mounted, scrolled where the reader left it.
//
// WHY THE SECTIONS ARE CLIENT COMPONENTS. A server-rendered section needs a
// route to render it, and there is no route any more. The obvious alternative —
// a server function returning the section's JSX — was BUILT AND MEASURED on
// Next 16.2.2 and does not work: a returned tree containing any client component
// fails to serialize ("Could not find the module … in the React Client
// Manifest"), and every section here is mostly client components. So each
// section takes a finished view model instead, read over ONE endpoint —
// `GET /api/settings/sections/<id>`, which refuses a sessionless caller, asks
// the registry's gate, and answers with what to draw (`readSection` below says
// why it is a route handler and not an action). The seats are still enforced on
// the server, on the read and on every write.
//
// ----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT
// ----------------------------------------------------------------------------
//
// The fragment, the history policy (open pushes one entry, a switch replaces,
// close goes back or strips in place) and the in-flight read all live in
// `@/lib/settings/settings-hash`, which is a plain module a test can drive.
// Three review findings were defects in exactly that logic and none of them was
// visible to a source guard, so it is separated from the chrome below and held
// by `settings-hash.test.ts` instead.
//
// What is left here is a component: the frame, the rail, the search box, and
// which body draws.
// ============================================================================

// ----------------------------------------------------------------------------
// The modal
// ----------------------------------------------------------------------------

type SettingsModalProps = {
  /**
   * The sections this account may open, in registry order — resolved by the
   * layout from the session it already holds, with `settingsSectionsFor`.
   *
   * It builds the NAV, and that is all it does. The read endpoint asks the same
   * function again on the server before it reads a row, so a stale or forged
   * list here cannot open a section; it can only fail to list one.
   */
  visibleIds: readonly SettingsSectionId[];
  /**
   * A value that CHANGES ON EVERY SERVER RENDER OF THE LAYOUT, and means
   * nothing else.
   *
   * It is how a settings write reconciles. Every action behind these controls
   * calls `refresh()` (`memory/contracts/data-patterns.md`), which re-renders
   * the route's server components — including the layout that renders this — so
   * a new value arriving here IS the signal "the server has changed, read your
   * section again". Without it a section fetched once would sit at the value it
   * had when it was opened: the modal is not part of any route, so nothing else
   * about it re-renders when the route does.
   *
   * IT IS ALSO WHY THE READ IS A ROUTE HANDLER. Every server-ACTION response
   * carries a fresh RSC render of the current route, so a read spelled as an
   * action regenerates this value and asks for itself again, for ever — an
   * unbounded loop at about seven requests a second, measured on the preview
   * before the read moved. See `readSection` in `@/lib/settings/settings-hash`.
   */
  serverRenderId: string;
  /**
   * WHOSE ANSWERS THE CACHE IS HOLDING — the signed-in account, and nothing else
   * is read from it (#673).
   *
   * `serverRenderId` says WHEN an answer was true and is deliberately ignored
   * when a cached section is painted, because painting an older render's answer
   * is the whole feature. So it cannot also say WHO it was true for, and this
   * does. Without it, one account's settings were painted for the next account
   * to sign in on the same tab: signing out is a server action ending in
   * `redirect()`, which is a CLIENT-SIDE navigation, so the document — and the
   * module-scope cache in it — outlives the session. Measured on the preview: a
   * coach opened settings and the first painted frame carried the previous
   * reader's name and email address.
   */
  scope: string;
};

export function SettingsModal({
  visibleIds,
  serverRenderId,
  scope,
}: SettingsModalProps) {
  const hash = useSyncExternalStore(
    subscribeToSettingsHash,
    settingsHashSnapshot,
    settingsHashServerSnapshot
  );
  const activeId = settingsSectionFromHash(hash);

  // THE ADDRESS BAR IS CORRECTED TO WHAT IS ON SCREEN. `#settings`,
  // `#settings/sharing` and a typo all resolve to a real section, and without
  // this the URL would go on naming something the modal is not showing — which
  // is the one thing a mechanism whose whole state is the URL cannot afford. It
  // converges in one pass: the rewrite makes the fragment canonical, so the
  // change it triggers finds nothing left to do.
  useEffect(() => {
    if (activeId === null) return;
    if (window.location.hash !== settingsSectionHref(activeId)) {
      showSection(activeId);
    }
  }, [activeId, hash]);

  if (activeId === null) return null;
  return (
    <SettingsDialog
      activeId={activeId}
      visibleIds={visibleIds}
      serverRenderId={serverRenderId}
      scope={scope}
    />
  );
}

/**
 * Split from `SettingsModal` so that everything below mounts when settings
 * OPENS and unmounts when it closes.
 *
 * The search query is the reason: it belongs to one visit, and a component that
 * survives closing would offer the next one a filtered rail it never typed.
 * Section switches happen inside this component, so they are the case it does
 * NOT remount for — which is the whole point of the issue.
 */
function SettingsDialog({
  activeId,
  visibleIds,
  serverRenderId,
  scope,
}: SettingsModalProps & { activeId: SettingsSectionId }) {
  const [query, setQuery] = useState("");
  // The Retry count, which is UI state and nothing else: it is part of the read
  // key, so bumping it is what makes a retry a NEW request rather than a replay
  // of the cached failure.
  //
  // ONE COUNT PER SECTION, because a retry BELONGS to the section it was pressed
  // in. As a single number for the whole dialog it was a segment of a per-section
  // key that a different section could move: after one Try again anywhere,
  // everything asked for attempt 1 — a key nothing had prefetched — and every
  // later switch paid a fresh read, which is the acceptance criterion this issue
  // exists for, quietly undone by its own error path.
  const [attempts, setAttempts] = useState<
    Partial<Record<SettingsSectionId, number>>
  >({});
  const attempt = attempts[activeId] ?? 0;
  const retry = () =>
    setAttempts((held) => ({ ...held, [activeId]: (held[activeId] ?? 0) + 1 }));
  const searchId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const activeEntryRef = useRef<HTMLAnchorElement>(null);

  const active = SETTINGS_SECTIONS.find((section) => section.id === activeId);

  // The nav's own subject: the visible sections in registry order. `inNav` is
  // what would keep an unlisted section addressable; every entry is in the nav
  // today (`sections.test.ts` asserts the unlisted set is empty).
  const navSections = SETTINGS_SECTIONS.filter(
    (section) => section.inNav && visibleIds.includes(section.id)
  );
  const matches = navSections.filter((section) =>
    sectionMatchesQuery(section, query)
  );
  const searching = query.trim() !== "";

  // The read, keyed by the account, the section, the last server render and this
  // section's retry count — see `sectionRequest`, which holds it OUTSIDE React
  // because a suspended render is replayed and a replay would mint a second
  // promise.
  const request = sectionRequest(scope, activeId, serverRenderId, attempt);

  // WHAT THIS ACCOUNT ALREADY KNOWS about this section, which is what stands in
  // while the read above is in flight (#673). `null` on a first visit, so a
  // first open still draws the skeleton.
  const stale = cachedSectionView(scope, activeId);

  // PREFETCH EVERY VISIBLE SECTION, ONCE PER OPENING (#673). There are at most
  // five and each is small, so the switch a reader makes next has its values
  // already in hand — that is the whole of "no spinner per switch". They are
  // idempotent: `sectionRequest` is keyed, so this asks for the active section's
  // read the render above already started, and a StrictMode double-invoke costs
  // nothing.
  //
  // AN EFFECT, AND ON PURPOSE. This is not data SYNC — the read is keyed and the
  // answer never reaches React state (`memory/contracts/data-patterns.md`) — it
  // is a WARM, and "when settings opens" is exactly the moment an effect names.
  // Spelling it during render would fire five reads on every `serverRenderId`
  // change instead, which is the burst after a write that #673 rules against:
  // the section on screen refetches, the other four revalidate when they are
  // next looked at.
  //
  // MOUNT IS THE WHOLE TRIGGER, so the dependency list is empty and says so. A
  // list naming the values the body happens to read would be a promise to
  // re-prefetch when they move, which is exactly what must not happen.
  useEffect(() => {
    for (const id of visibleIds) sectionRequest(scope, id, serverRenderId, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A SWITCH IS A NEW PANE, NOT A SCROLLED ONE. Nothing here remounts on a
  // switch — that is the whole mechanism — so the scroller kept the previous
  // section's `scrollTop`, and a reader who left Church halfway down arrived in
  // Notifications halfway down.
  //
  // AND THE RAIL IS PULLED BACK TO THE ENTRY IT IS NAMING. On a phone the nav
  // scrolls sideways and five entries are about 556px in a 327px viewport, so
  // the section on screen could be named off the edge of it. `nearest` on both
  // axes so an entry already in view moves nothing.
  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
    activeEntryRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeId]);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeSettings();
      }}
    >
      <DialogContent
        // NOTHING INSIDE IS FOCUSED ON OPEN (#657). Radix hands focus to the
        // first focusable, which is the search box — so the modal opened with a
        // cursor blinking in a field nobody asked for, and a screen reader
        // announced "Search settings, edit text" instead of the dialog. Focus
        // goes to the dialog itself instead: its title is announced, Escape
        // works, and Tab starts at the top of the rail.
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Radix restores focus to whatever held it when the dialog opened.
          // That is normally the Settings item inside the avatar dropdown,
          // which has been unmounted by the time we get here, so the restore
          // lands on `<body>` and the next Tab starts at the top of the
          // document. Hand focus to the region the reader is looking at
          // instead.
          event.preventDefault();
          document.getElementById(DASHBOARD_PAGE_CONTENT_ID)?.focus();
        }}
        tabIndex={-1}
        // `showCloseButton={false}`: Close is drawn by this component instead —
        // in the section pane's top bar once the panes sit side by side, and as
        // the usual corner X while they are stacked. The built-in one is
        // absolute over the whole dialog, so the scrollbar ran behind it.
        showCloseButton={false}
        className="bg-card flex h-[calc(100dvh-1.5rem)] w-full max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 md:h-[min(40rem,calc(100dvh-4rem))] md:max-w-3xl md:flex-row lg:max-w-4xl"
      >
        {/* The stacked layout's Close, hidden once the section pane's bar takes
            over at `md`. */}
        <SettingsClose className="absolute top-3 right-3 z-10 md:hidden" />
        {/* THE RAIL. `border-b` on a stacked phone layout and `border-r` once
            the two panes sit side by side, so the seam always separates the
            navigation from the section rather than floating.

            AND NO TINT OF ITS OWN. `bg-muted/40` over the dialog's `bg-card`
            put the rail within 1.009:1 of the active entry's own fill — two
            greys nobody can tell apart — so the rail is the dialog's surface
            and the ENTRIES carry the state instead: `bg-muted` for the fill,
            and a 4px `--ef` edge for which one is open. That is the treatment
            `wiki-sidebar.tsx` already ships, and the green edge is the signal
            this rail was the only navigation in the product without. */}
        <div className="flex shrink-0 flex-col border-b md:w-44 md:border-r md:border-b-0 lg:w-48">
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
                className="bg-card pl-8"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter jumps to the first match, so a reader who typed
                  // "zone" never has to move to the mouse to open the section
                  // holding it (CS-016: "choosing a match shows its section").
                  if (event.key !== "Enter") return;
                  const first = matches[0];
                  if (!first) return;
                  event.preventDefault();
                  showSection(first.id);
                  // …AND FOCUS GOES WITH IT. The jump redraws the pane and used
                  // to leave the caret in the search box, so the next Tab
                  // resumed at the top of the rail and a screen reader had no
                  // reason to look at what had just opened. The heading is
                  // `tabIndex={-1}` for exactly this. What is SAID is the
                  // status region's job below, since the heading's own text
                  // does not change until the commit after this handler.
                  titleRef.current?.focus();
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
                // A REAL ANCHOR AT A REAL ADDRESS, whose default action is
                // cancelled. `#settings/church` is where this section lives, so
                // the entry can be copied, opened in a new tab and read by
                // anything that reads links — while the click itself goes
                // through `showSection`, which REPLACES. Letting the browser
                // follow it would push one history entry per section switch,
                // and Close would then be as many steps back as the reader was
                // curious.
                <a
                  key={section.id}
                  ref={isActive ? activeEntryRef : undefined}
                  href={settingsSectionHref(section.id)}
                  aria-current={isActive ? "page" : undefined}
                  onClick={(event) => {
                    // A modified click is the reader asking the BROWSER for
                    // something — a new tab, a saved link — so it is left alone
                    // and the `href` is what serves it.
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
                    showSection(section.id);
                  }}
                  // THE EDGE'S COLOUR BELONGS TO A BRANCH, NEVER TO THE BASE.
                  // `before:bg-transparent` and `before:bg-ef` compile to the
                  // same specificity, and Tailwind emits transparent LATER in
                  // the sheet — so an element carrying both is transparent
                  // whatever the branch says, and the active entry shipped with
                  // no green edge at all (measured in the browser:
                  // rgba(0, 0, 0, 0)). `wiki-sidebar.tsx` survives the same
                  // pair only because `cn()` runs tailwind-merge, which DELETES
                  // the losing class; a template literal has no such editor, so
                  // the two colours may never both be in the string.
                  className={`relative flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors before:absolute before:top-0 before:left-0 before:h-full before:w-[4px] before:transition-colors md:shrink md:whitespace-normal ${
                    isActive
                      ? "bg-muted text-foreground before:bg-ef"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground before:bg-transparent"
                  }`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {section.label}
                </a>
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
                className="text-foreground hover:text-muted-foreground cursor-pointer text-sm font-medium underline underline-offset-4 transition-colors"
              >
                Clear search
              </button>
            </div>
          )}
        </div>

        {/* THE SECTION PANE. From `md` up, a fixed bar owns the top of the
            pane and hosts Close; the scrollable container starts UNDER it, so
            content clips against the bar and the scrollbar's track begins
            below the X instead of running behind it. The bar is `h-15` and the
            X sits `pr-3` from the edge, which puts the glyph's centre exactly on
            the search field's: the rail's `p-3` above an `h-9` input centres it
            30px down, and a centred X in a 60px bar lands on the same line. At
            `h-12` it sat six pixels high of the one horizontal the eye reads
            straight across the seam between the two panes. */}
        <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
          <div className="hidden h-15 shrink-0 items-center justify-end pr-3 md:flex">
            <SettingsClose />
          </div>

          {/* `overscroll-contain` so a flick at the end of a long section does
              not scroll the screen behind the modal.

              AND IT IS THE `@container` the section forms measure against. The
              pane is the width that decides whether a field grid is one column
              or two — the viewport is not, because the rail takes 14 or 16rem
              off it and the dialog itself caps at `md`. */}
          <div
            ref={paneRef}
            className="@container flex flex-1 flex-col overflow-y-auto overscroll-contain"
          >
            <div className="space-y-1 px-5 pt-5 pr-12 md:px-6 md:pt-1 md:pr-6">
              <DialogTitle
                ref={titleRef}
                // Focusable only by script: the search box's Enter jump hands
                // focus here, and nothing else should stop on a heading.
                tabIndex={-1}
                className="text-xl font-semibold tracking-tight"
              >
                {active?.label ?? "Settings"}
              </DialogTitle>
              {active && (
                <DialogDescription className="max-w-prose text-pretty">
                  {active.description}
                </DialogDescription>
              )}
              {/* WHICH SECTION IS ON SCREEN, SAID OUT LOUD. A switch rewrites
                  the pane under a reader whose focus has not moved, and the
                  dialog announces its title once, on open — so without this
                  nothing at all marks the change. Rendered on every pass, so a
                  repeated switch is announced again. */}
              <p role="status" className="sr-only">
                {active ? `${active.label} settings` : "Settings"}
              </p>
            </div>

            {/* THE TITLE AND THE RAIL ARE ALREADY DRAWN by the time this waits —
              they come from the registry, which the browser has. Only the
              section's own values are ever pending, which is why the frame does
              not flicker on the way in.

              KEYED BY SECTION so a switch shows the fallback (a new boundary
              suspends into it) while a `refresh()`-driven re-read does not (the
              same boundary, updated inside the router's transition, keeps what
              is on screen until the new values arrive). The key must NOT gain
              `serverRenderId`: that would turn every write into a new boundary,
              and a new boundary drops what the reader is looking at.

              AND THE FALLBACK IS THE LAST ANSWER THIS ACCOUNT HOLDS, not a
              skeleton, whenever there is one (#673). That is the
              stale-while-revalidate half of the mechanism in one expression: the
              cached values paint instantly and `use(request)` below replaces
              them with the fresh ones — so the pane is never blank for a section
              this reader has already opened. It is on screen ONLY while the read
              for the current `serverRenderId` is in flight, which is what keeps
              a cached value presentation rather than state.

              THE STALE COPY IS `inert`, AND THAT IS NOT CAUTION. A fallback is a
              SECOND TREE: React never carries state from it into the children,
              so the moment the revalidation lands this instance is unmounted and
              a fresh one takes its place. The sections are forms — a password
              being typed, an email being changed, an optimistic toggle mid-flight
              — so an interactive stale copy hands the reader controls that are
              about to be thrown away, and a write that lands a few hundred
              milliseconds later takes their typing with it. `inert` costs
              nothing the skeleton did not already cost (this is the moment that
              USED to be a skeleton, which is no more clickable) and it settles
              the duplicate-`id` question with it: a re-suspended boundary keeps
              its children mounted and hidden beside the fallback, and only one of
              the two answers to a label.

              The right end state is one tree rather than two — the settled answer
              read through the store the fragment already uses, with no fallback
              and no second instance. That is a larger change than this issue,
              and it is written down rather than half-done. */}
            {/* A MEASURE CAP FOR THE WHOLE PANE, not five copies of one class
                across five section files this component does not own. At `lg`
                the pane is wide enough to run a section's prose to 80-85
                characters, past the 45-75 a reader tracks a line across.

                CENTRED PARAGRAPHS OPT OUT, and that is not a hedge: a `max-w`
                narrows the BOX and leaves it flush left, so a `text-center`
                empty state — `plant-coach-list.tsx` has one — would go on
                centring its text inside a box that no longer fills the pane and
                land visibly off centre. A paragraph that centres itself is a
                caption, not a measure of prose. */}
            <div className="flex-1 px-5 py-5 md:px-6 md:py-6 [&_p:not(.text-center)]:max-w-prose">
              <Suspense
                key={activeId}
                fallback={
                  stale ? (
                    <div
                      inert
                      aria-hidden="true"
                      className="pointer-events-none"
                    >
                      <SectionView activeId={activeId} view={stale} />
                    </div>
                  ) : (
                    <SectionSkeleton />
                  )
                }
              >
                <SectionBody
                  activeId={activeId}
                  request={request}
                  onRetry={retry}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * THE MODAL'S CLOSE — drawn twice, spelled once.
 *
 * `DialogContent`'s built-in X is refused here (`showCloseButton={false}`)
 * because it is absolute over the WHOLE dialog and the section's scrollbar ran
 * behind it. What replaces it is two placements of the same control: the corner
 * X while the panes are stacked, and the section pane's own top bar from `md`.
 *
 * ONE COMPONENT RATHER THAN TWO CALL SITES, and the reason is a test. The
 * shared primitive's Close is measured against WCAG 2.5.8's 24x24 floor by
 * `dismiss-target-size.test.ts`, which reads class strings out of
 * `src/components/ui/` — so these two, being neither shared nor in that
 * directory, were the only dismiss controls in the product growing their own
 * box on trust. As one component there is ONE class string to measure, and that
 * file now measures it and sweeps this directory for a second one. `className`
 * carries PLACEMENT only; the box is not a caller's to change.
 */
function SettingsClose({ className }: { className?: string }) {
  return (
    <DialogClose
      className={cn(
        "ring-offset-background focus-visible:ring-ring grid size-6 place-items-center rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden [&_svg]:pointer-events-none [&_svg]:size-4",
        className
      )}
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </DialogClose>
  );
}

/**
 * One body per section id, as a total map rather than a switch.
 *
 * `Record<SettingsSectionId, …>` is the exhaustiveness check: adding an id to
 * the registry fails the build here until it has something to draw. Its twin is
 * `SECTION_READS` in `section-data.ts`, which fails until it has something to
 * read.
 */
const SECTION_BODIES: {
  [Id in SettingsSectionId]: (props: {
    view: SettingsSectionViewOf<Id>;
  }) => React.ReactNode;
} = {
  account: AccountSection,
  church: ChurchSection,
  team: TeamSection,
  association: AssociationSection,
  notifications: NotificationsSection,
};

function SectionBody({
  activeId,
  request,
  onRetry,
}: {
  activeId: SettingsSectionId;
  request: Promise<SettingsSectionLoad>;
  onRetry: () => void;
}) {
  const result = use(request);

  // THREE FAILURES, THREE REMEDIES, and collapsing them was a review finding
  // whose worst case was silent: a 401 answered as a refusal bounced the reader
  // to the default section, whose read had already failed and was cached, and
  // the pane showed grey rectangles for ever with no way out.
  if (!result.ok) {
    if (result.reason === "unauthorized") return <SectionSignedOut />;
    if (result.reason === "failed")
      return <SectionUnavailable retry={onRetry} />;
    return <SectionRefused activeId={activeId} retry={onRetry} />;
  }

  // THE TAG IS CHECKED, NOT ASSUMED. The view carries the section it belongs to
  // and the server answered the id we asked for, so this is never false — but it
  // is what makes the pairing below sound rather than merely likely, and it is
  // the only place the answer OFF THE WIRE and the body map meet. Without it the
  // cast would be a promise that a body and a view model match, kept by nobody.
  if (result.view.section !== activeId) {
    return <SectionRefused activeId={activeId} retry={onRetry} />;
  }

  return <SectionView activeId={activeId} view={result.view} />;
}

/**
 * A section drawn from values already in hand.
 *
 * TWO CALLERS, AND THAT IS THE POINT (#673): the read's answer, and — as the
 * Suspense fallback — the last answer this tab holds for the section while the
 * current read is in flight. Both draw the identical component from the
 * identical view model, so a revalidation is invisible unless something changed.
 *
 * The cast is the one `SECTION_BODIES` has always needed: the map is total over
 * the id, the view is tagged with it, and the two are paired by whoever checked
 * that tag — `SectionBody` for the wire, `cachedSectionView` for the cache.
 */
function SectionView<Id extends SettingsSectionId>({
  activeId,
  view,
}: {
  activeId: Id;
  view: SettingsSectionViewOf<Id>;
}) {
  const Body = SECTION_BODIES[activeId] as (props: {
    view: SettingsSectionViewOf<Id>;
  }) => React.ReactNode;
  return <Body view={view} />;
}

/**
 * What a refusal draws: nothing, briefly, on the way to the default section.
 *
 * The correction is the same one the deleted `/settings/*` routes made with a
 * `redirect()` — an account that may not open this section is put on the one
 * every account can.
 *
 * UNLESS IT IS ALREADY ON THAT SECTION, which is the case that has nowhere to
 * go: rewriting the fragment to the section it already names changes nothing, so
 * the reader would sit under a skeleton with no way out. Account is visible to
 * every signed-in account and its read has no gate of its own, so reaching this
 * is a fault rather than a permission — and it is answered as one.
 */
function SectionRefused({
  activeId,
  retry,
}: {
  activeId: SettingsSectionId;
  retry: () => void;
}) {
  const correctable = activeId !== DEFAULT_SETTINGS_SECTION;
  useEffect(() => {
    if (correctable) showSection(DEFAULT_SETTINGS_SECTION);
  }, [correctable]);
  if (!correctable) return <SectionUnavailable retry={retry} />;
  return <SectionSkeleton />;
}

/**
 * The session ended while the modal was open.
 *
 * It sends the reader to sign in and come back HERE, which is the answer the
 * rest of the product gives a stale session (`loginPathFor`, the same builder
 * the proxy and the dashboard layout use). A settings modal that invented its
 * own answer would be the one surface where an expired session looks like a bug.
 *
 * The `assign` is in an effect rather than in render because it is a navigation,
 * and the message is what a reader sees in the moment before it happens.
 */
function SectionSignedOut() {
  useEffect(() => {
    window.location.assign(
      loginPathFor(window.location.pathname + window.location.search)
    );
  }, []);
  return (
    <p className="text-muted-foreground text-sm text-pretty">
      Your session has ended. Taking you to sign in…
    </p>
  );
}

/**
 * The read did not come back — a dropped connection, or a server that answered
 * with something other than this section.
 *
 * A NAMED FAILURE AND A WAY OUT, never a skeleton that never resolves. Retry
 * bumps the read key, so it is a fresh request rather than a replay of the
 * cached failure — which is the only reason a button here is worth anything.
 */
function SectionUnavailable({ retry }: { retry: () => void }) {
  return (
    <div role="status" className="space-y-3">
      <p className="text-sm text-pretty">
        Unable to load this section. Nothing you have saved is affected.
      </p>
      <Button variant="outline" className="cursor-pointer" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * The section pane while its values are in flight.
 *
 * Blocks rather than a spinner, and roughly where a section's own blocks are, so
 * the pane keeps its shape and nothing jumps when the values land. `role`-less
 * and `aria-hidden`: the arrival is announced by the section itself, and a
 * screen reader has no use for three grey rectangles.
 */
function SectionSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
