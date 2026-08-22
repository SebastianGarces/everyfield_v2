"use client";

import { Search } from "lucide-react";
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
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DASHBOARD_MAIN_ID } from "@/lib/dashboard/main-region";
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
// THE HISTORY POLICY, WHICH THIS FILE OWNS ENTIRELY
// ----------------------------------------------------------------------------
//
//   OPEN   pushes exactly ONE entry, through `openSettings`. The avatar menu
//          still spells a real `<a href="#settings/account">` — so the address
//          is copyable, and the modal opens with no JavaScript at all — but a
//          plain click is cancelled and routed here, because a NATIVE fragment
//          navigation is invisible to Next's router and the first `refresh()`
//          afterwards wipes the fragment (see `openSettings`).
//   SWITCH replaces. However many sections a reader opens from the rail,
//          settings occupies that one entry: no back-through-every-section.
//   CLOSE  goes BACK when this document pushed the entry, so the reader lands
//          exactly where they were with the fragment gone. When the document was
//          COLD-LOADED on a settings URL there is nothing behind it, so Close
//          strips the fragment in place instead — `/phase#settings/church` closes
//          to `/phase`, still mounted, never reloaded and never bounced to some
//          account's home.
//
// Which of the two Close is turns on a fact about the DOCUMENT, and the store
// below is what knows it: only a PUSH can take a document from "no settings
// fragment" to "settings fragment" while it is running, because switches
// replace. So the transition itself is the evidence, and no component has to be
// told how it was opened. This is the same question `bootedIntoSettings` used to
// answer by asking which route had matched.
// ============================================================================

// ----------------------------------------------------------------------------
// The hash store
//
// `useSyncExternalStore` rather than an effect, so the modal has no "opening"
// frame it renders wrongly and no state to keep in step with the address bar.
// The SERVER snapshot is always "no fragment" — a fragment never reaches a
// server — which is exactly right: a cold load renders the page normally and the
// modal opens over it on hydration.
// ----------------------------------------------------------------------------

const listeners = new Set<() => void>();

/**
 * Did THIS document push the entry the settings fragment sits on?
 *
 * Module scope is the honest scope for a per-document fact, and it is only ever
 * read or written from the browser, so a server render never touches it (module
 * state in a `"use client"` file is shared across requests on the server).
 */
let openedByPush = false;

/** The open-ness the last transition left, so the next one can be compared to it. */
let wasOpen = false;

function isSettingsHash(hash: string): boolean {
  return settingsSectionFromHash(hash) !== null;
}

/**
 * Re-read the address bar and tell the store.
 *
 * `pushedHere` is decided HERE rather than by whoever moved the URL, because
 * only a transition can answer it: a fragment that was absent a moment ago and
 * is present now arrived on a NEW history entry — the rail replaces, and a cold
 * load makes no transition at all. Forward after a Back-close lands here too,
 * and it is a push in every sense that matters, because there is an entry behind
 * it again.
 */
function onUrlChange() {
  const nowOpen = isSettingsHash(window.location.hash);
  if (nowOpen && !wasOpen) openedByPush = true;
  if (!nowOpen) openedByPush = false;
  wasOpen = nowOpen;
  for (const listener of listeners) listener();
}

/**
 * WATCH THE HISTORY API, NOT ONLY `hashchange` — measured on the preview.
 *
 * `pushState` and `replaceState` fire NOTHING, and Next's client router writes
 * every URL it navigates to with them. So an arrival that LANDS on a settings
 * fragment through the router left this store holding the fragment the document
 * had booted with, and the modal stayed shut with `#settings/notifications` in
 * the address bar. Two shipped paths do exactly that: the login round trip,
 * which follows a mailed `/settings/notifications` through its redirect to
 * `/dashboard#settings/notifications`, and "Back to settings" on the
 * verify-email screen.
 *
 * Patched once, never unpatched, and it DELEGATES rather than replaces — the
 * original is called with the original arguments and its return value passed
 * back, so the router is unaffected. `showSection` and `closeSettings` call
 * `onUrlChange` themselves as well, which is a harmless second notification:
 * re-reading the address bar is idempotent.
 */
let historyWatched = false;
function watchHistory() {
  if (historyWatched) return;
  historyWatched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function (...args: Parameters<typeof original>) {
      const result = original.apply(window.history, args);
      onUrlChange();
      return result;
    };
  }
}

function subscribe(onStoreChange: () => void): () => void {
  if (listeners.size === 0) {
    wasOpen = isSettingsHash(window.location.hash);
    window.addEventListener("hashchange", onUrlChange);
    // Back and Forward through a router-driven entry, which reports as a pop
    // rather than as a fragment change.
    window.addEventListener("popstate", onUrlChange);
    watchHistory();
  }
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      window.removeEventListener("hashchange", onUrlChange);
      window.removeEventListener("popstate", onUrlChange);
    }
  };
}

const getSnapshot = () => window.location.hash;
const getServerSnapshot = () => "";

/**
 * Show a section without touching the history stack.
 *
 * `replaceState` fires no `hashchange`. The store watches the history API too
 * (`watchHistory`), so this is already noticed; the explicit call keeps this
 * function correct on its own terms rather than by a side effect of a patch
 * somewhere above it.
 */
function showSection(id: SettingsSectionId) {
  window.history.replaceState(null, "", settingsSectionHref(id));
  onUrlChange();
}

/**
 * OPEN SETTINGS — the one way in, and it must go through `pushState`.
 *
 * A plain `<a href="#settings/account">` opens the modal on its own and needs no
 * JavaScript, which is why the avatar menu still spells one. It is not enough by
 * itself: a NATIVE fragment navigation is invisible to Next's client router, so
 * the router's idea of the current URL keeps saying `/dashboard` — and the first
 * `refresh()` after that (every settings write calls one) rewrites the address
 * bar from the router's copy and takes the fragment with it. Measured on the
 * preview: toggle one notification preference and the modal closed under the
 * reader's hands.
 *
 * `pushState` is the documented way to hand the App Router a URL it did not
 * navigate to, so this keeps the two in step. The anchors keep their `href` —
 * the address is real, copyable and middle-clickable — and cancel their own
 * default so this runs instead.
 *
 * ONE ENTRY, which is what makes Close one step back. See the header.
 */
export function openSettings(id: SettingsSectionId) {
  window.history.pushState(null, "", settingsSectionHref(id));
  onUrlChange();
}

/**
 * Should this click be handled by the app, or by the browser?
 *
 * A modified click is the reader asking the BROWSER for something — a new tab, a
 * download, a saved link — so it is left alone, and the `href` is what serves it.
 */
function isPlainClick(event: React.MouseEvent): boolean {
  return (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.button === 0
  );
}

/**
 * THE ONE WAY TO LINK TO A SETTINGS SECTION from anywhere in the app.
 *
 * A real anchor at a real address, whose plain click is cancelled and sent to
 * `openSettings`. Both halves matter and neither is enough alone: the `href` is
 * what a reader can copy, middle-click and follow with JavaScript off, and the
 * handler is what keeps Next's router in step with the fragment (see
 * `openSettings`).
 *
 * It exists so the two callers — the avatar menu and the dashboard's
 * association reminder — cannot spell that pair differently, and so a SERVER
 * component can link to settings without becoming a client one for the sake of
 * an `onClick`.
 */
export function SettingsLink({
  section,
  className,
  children,
}: {
  section: SettingsSectionId;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={settingsSectionHref(section)}
      className={className}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        openSettings(section);
      }}
    >
      {children}
    </a>
  );
}

function closeSettings() {
  if (openedByPush) {
    // One entry was pushed, so one step removes it — and the fragment change
    // that follows is a real `hashchange`, which resets the latch for the next
    // opening.
    window.history.back();
    return;
  }
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search
  );
  onUrlChange();
}

// ----------------------------------------------------------------------------
// The read
// ----------------------------------------------------------------------------

/**
 * Ask the server for a section's values.
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION, and that is load-bearing rather than
 * stylistic. Every server-action response carries a fresh RSC render of the
 * current route, which regenerates `serverRenderId` — the value this read is
 * keyed by. As an action it therefore asked for itself again on its own answer,
 * for ever. JSON over `fetch` re-renders nothing, so that chain terminates.
 *
 * A failed read is `{ ok: false }`, the same answer a refusal gives, because the
 * remedy is the same one: show the reader a section that works. A network blip
 * while switching sections must not leave a dialog with a permanent skeleton in
 * it.
 */
async function readSection(
  id: SettingsSectionId
): Promise<SettingsSectionLoad> {
  try {
    const response = await fetch(`/api/settings/sections/${id}`);
    if (!response.ok) return { ok: false };
    return (await response.json()) as SettingsSectionLoad;
  } catch {
    return { ok: false };
  }
}

/**
 * THE IN-FLIGHT READ, CACHED OUTSIDE REACT — and it has to be outside.
 *
 * The section is unwrapped with `use()`, so the promise has to exist before the
 * render that consumes it. A promise minted during render is the documented
 * hazard React warns about, and this is what it looks like in practice
 * (measured on the preview): a render that SUSPENDS is discarded and replayed,
 * a replay re-runs `useMemo`, a re-run mints a second promise, and consuming
 * that one suspends again — a loop at about six reads a second, for as long as
 * the modal stayed open. A `useMemo` cannot hold this because React is free to
 * drop it; module scope is not React's to drop.
 *
 * KEYED BY THE TWO THINGS A READ DEPENDS ON: the section asked for, and the last
 * server render. That is the whole read policy — ask again when the reader picks
 * a different section, ask again when a write has changed the server, ask at no
 * other time.
 *
 * ONE ENTRY, NOT A MAP. A second section is a new key, and the answer to the old
 * one is of no further use — caching it would be caching server data, which is
 * the thing `memory/invariants.md` → Client/Server Data Synchronization
 * forbids. What is held here is an in-flight REQUEST, which cannot go stale: it
 * is replaced the moment either input moves.
 *
 * Module scope is safe here for the same reason `openedByPush` above is: nothing
 * renders `SettingsDialog` on the server — the store's server snapshot is always
 * "no fragment" — so no server request can reach this.
 */
let cachedKey: string | null = null;
let cachedRequest: Promise<SettingsSectionLoad> | null = null;

function sectionRequest(
  id: SettingsSectionId,
  serverRenderId: string
): Promise<SettingsSectionLoad> {
  const key = `${id} ${serverRenderId}`;
  if (cachedKey !== key || cachedRequest === null) {
    cachedKey = key;
    cachedRequest = readSection(id);
  }
  return cachedRequest;
}

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
   * before the read moved. See `readSection` above.
   */
  serverRenderId: string;
};

export function SettingsModal({
  visibleIds,
  serverRenderId,
}: SettingsModalProps) {
  const hash = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const activeId = settingsSectionFromHash(hash);

  if (activeId === null) return null;
  return (
    <SettingsDialog
      activeId={activeId}
      visibleIds={visibleIds}
      serverRenderId={serverRenderId}
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
}: SettingsModalProps & { activeId: SettingsSectionId }) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

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

  // The read, keyed by the section and by the last server render — see
  // `sectionRequest`, which holds it OUTSIDE React because a suspended render is
  // replayed and a replay would mint a second promise.
  const request = sectionRequest(activeId, serverRenderId);

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
          document.getElementById(DASHBOARD_MAIN_ID)?.focus();
        }}
        tabIndex={-1}
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
                  showSection(first.id);
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
                  href={settingsSectionHref(section.id)}
                  aria-current={isActive ? "page" : undefined}
                  onClick={(event) => {
                    if (!isPlainClick(event)) return;
                    event.preventDefault();
                    showSection(section.id);
                  }}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors md:shrink ${
                    isActive
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
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

          {/* THE TITLE AND THE RAIL ARE ALREADY DRAWN by the time this waits —
              they come from the registry, which the browser has. Only the
              section's own values are ever pending, which is why the frame does
              not flicker on the way in.

              KEYED BY SECTION so a switch shows the skeleton (a new boundary
              suspends into its fallback) while a `refresh()`-driven re-read does
              not (the same boundary, updated inside the router's transition,
              keeps what is on screen until the new values arrive). */}
          <div className="flex-1 px-5 py-5 md:px-6 md:py-6">
            <Suspense key={activeId} fallback={<SectionSkeleton />}>
              <SectionBody activeId={activeId} request={request} />
            </Suspense>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
}: {
  activeId: SettingsSectionId;
  request: Promise<SettingsSectionLoad>;
}) {
  const result = use(request);

  if (!result.ok) return <SectionRefused />;

  // THE TAG IS CHECKED, NOT ASSUMED. The view carries the section it belongs to
  // and the server answered the id we asked for, so this is never false — but it
  // is what makes the pairing below sound rather than merely likely, and it is
  // the only place the tag and the map meet. Without it the cast would be a
  // promise that a body and a view model match, kept by nobody.
  const view = result.view;
  if (view.section !== activeId) return <SectionRefused />;
  const Body = SECTION_BODIES[activeId] as (props: {
    view: typeof view;
  }) => React.ReactNode;

  return <Body view={view} />;
}

/**
 * What a refusal draws: nothing, briefly, on the way to the default section.
 *
 * The correction is the same one the deleted `/settings/*` routes made with a
 * `redirect()` — an account that may not open this section is put on the one
 * every account can. It cannot loop: `account` is visible to every signed-in
 * account and its read has no gate of its own to fail.
 */
function SectionRefused() {
  useEffect(() => {
    showSection(DEFAULT_SETTINGS_SECTION);
  }, []);
  return <SectionSkeleton />;
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
