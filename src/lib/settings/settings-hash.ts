"use client";

import {
  settingsSectionFromHash,
  settingsSectionHref,
  type SettingsSectionId,
} from "@/lib/settings/sections";
import type { SettingsSectionLoad } from "@/lib/settings/section-view";

// ============================================================================
// WHERE SETTINGS LIVES: `#settings/<section>`, and the rules for moving it
// (#657, ruled 2026-08-22).
//
// Settings is client state over whatever screen the reader is on, and the URL's
// FRAGMENT is that state. This module is the whole of it — the store the modal
// subscribes to, the history policy, and the in-flight read — separated from the
// component that draws it so a test can DRIVE it rather than grep for it. That
// separation is not tidiness: three defects found in review lived in exactly
// this logic, and a topological guard cannot see any of them
// (`settings-hash.test.ts` is the table that can).
//
// ----------------------------------------------------------------------------
// THE HISTORY POLICY
// ----------------------------------------------------------------------------
//
//   OPEN   pushes exactly ONE entry, through `openSettings`.
//   SWITCH replaces, so however many sections a reader opens from the rail,
//          settings occupies that one entry.
//   CLOSE  goes BACK when this document pushed an entry ON THIS PAGE, so the
//          reader lands where they were with the fragment gone. Otherwise it
//          strips the fragment IN PLACE — which covers a cold load
//          (`/phase#settings/church` closes to `/phase`, never reloaded and
//          never bounced to an account's home) and covers an arrival that
//          changed PAGE and fragment together, where one step back would leave
//          the page rather than close the modal.
//
// THE PAGE HALF OF THAT LAST RULE IS LOAD-BEARING and was missed on the first
// pass. `verify-email/confirmed/page.tsx` links to `/dashboard#settings/account`
// and sits inside the dashboard group — so the modal is already mounted when the
// reader presses it, the router's push changes path AND fragment in one entry,
// and a
// latch that watched only the fragment concluded "this document pushed it" and
// closed by walking the reader back to a consumed token screen.
//
// NOTHING HERE IS DEPENDENCY-INJECTED. Every function reaches `window` when it
// is CALLED rather than when the module loads, so a test supplies a fake
// `globalThis.window` and drives the real code. A seam parameter threaded
// through nine functions to avoid that would be the threading to refuse.
// ============================================================================

const listeners = new Set<() => void>();

/**
 * Did THIS document push the entry the settings fragment sits on, on THIS page?
 *
 * Module scope is the honest scope for a per-document fact, and it is only ever
 * read or written from the browser, so a server render never touches it (module
 * state in a `"use client"` file is shared across requests on the server).
 */
let openedByPush = false;

/** The open-ness the last transition left, so the next one can be compared to it. */
let wasOpen = false;

/** The page the last transition left, for the same reason. */
let wasOn = "";

function pageOf(): string {
  return window.location.pathname + window.location.search;
}

function isSettingsHash(hash: string): boolean {
  return settingsSectionFromHash(hash) !== null;
}

/**
 * Re-read the address bar, decide what the transition MEANT, and tell the store.
 *
 * The two facts it maintains are the two the rest of this module cannot recover
 * later: whether the entry now showing was pushed by this document on this page,
 * and — because closing is where a visit ends — when to drop the read.
 */
function onUrlChange() {
  const nowOpen = isSettingsHash(window.location.hash);
  const nowOn = pageOf();

  if (!nowOpen) {
    openedByPush = false;
    // A VISIT ENDS HERE, so the read ends with it. Closing moves neither the
    // section nor the server render, so without this the next opening would be
    // served the previous visit's roster from the cache below.
    forgetSection();
  } else if (!wasOpen || nowOn !== wasOn) {
    // THE ENTRY NOW SHOWING IS NOT THE ONE WE WERE LOOKING AT, so what Close
    // means has to be decided again. It is ours to remove with one step back
    // only when this document opened settings on the page it was ALREADY on:
    // a cold load pushed nothing, and an arrival that changed page and fragment
    // together has a previous entry that is a different screen, not this one
    // without its modal.
    //
    // Stated once, as one expression. It was two lines that agreed with each
    // other until they did not — and the redundant one hid the fact that a red
    // check of the other proved nothing.
    openedByPush = !wasOpen && nowOn === wasOn;
  }
  // Anything else is a SECTION SWITCH — same page, still open — which changes
  // nothing about how this was opened.

  wasOpen = nowOpen;
  wasOn = nowOn;
  for (const listener of listeners) listener();
}

/**
 * WATCH THE HISTORY API, NOT ONLY `hashchange` — measured on the preview.
 *
 * `pushState` and `replaceState` fire NOTHING, and Next's client router writes
 * every URL it navigates to with them. So an arrival that LANDS on a settings
 * fragment through the router left this store holding the fragment the document
 * had booted with, and the modal stayed shut with `#settings/notifications` in
 * the address bar.
 *
 * Patched once, never unpatched, and it DELEGATES rather than replaces — the
 * original is called with the original arguments and its return value passed
 * back, so the router is unaffected.
 */
let historyWatched = false;
function watchHistory() {
  if (historyWatched) return;
  historyWatched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function (...args: unknown[]) {
      const result = (original as (...a: unknown[]) => unknown).apply(
        window.history,
        args
      );
      onUrlChange();
      return result;
    } as typeof original;
  }
}

export function subscribeToSettingsHash(onStoreChange: () => void): () => void {
  if (listeners.size === 0) {
    wasOpen = isSettingsHash(window.location.hash);
    wasOn = pageOf();
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

export const settingsHashSnapshot = () => window.location.hash;

/** A fragment never reaches a server, so a server render always draws no modal. */
export const settingsHashServerSnapshot = () => "";

/**
 * OPEN SETTINGS — the one way in, and it must go through `pushState`.
 *
 * A plain `<a href="#settings/account">` opens the modal on its own and needs no
 * JavaScript, which is why `SettingsLink` still spells one. It is not enough by
 * itself: a NATIVE fragment navigation is invisible to Next's client router, so
 * the router's idea of the current URL keeps saying `/dashboard` — and the first
 * `refresh()` after that (every settings write calls one) rewrites the address
 * bar from the router's copy and takes the fragment with it. Measured on the
 * preview: toggle one notification preference and the modal closed under the
 * reader's hands.
 *
 * `pushState` is the documented way to hand the App Router a URL it did not
 * navigate to, so this keeps the two in step.
 */
export function openSettings(id: SettingsSectionId) {
  window.history.pushState(null, "", settingsSectionHref(id));
  onUrlChange();
}

/**
 * Show a section without touching the history stack.
 *
 * Also the CORRECTION for a fragment that names something else — a typo, or the
 * retired `sharing` id — so the address bar can never keep saying something the
 * modal is not showing.
 */
export function showSection(id: SettingsSectionId) {
  window.history.replaceState(null, "", settingsSectionHref(id));
  onUrlChange();
}

export function closeSettings() {
  if (openedByPush) {
    // One entry was pushed, on this page, so one step removes it — and the
    // change that follows resets the latch for the next opening.
    window.history.back();
    return;
  }
  window.history.replaceState(null, "", pageOf());
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
 * THE THREE FAILURES ARE TOLD APART, because their remedies are nothing alike:
 * a gate refusal is corrected to a section that works, an expired session is a
 * trip to `/login` — the answer the rest of the app gives — and a transport
 * failure is a message with a Retry. Collapsing them was a review finding, and
 * the shape it produced was the worst of the three: an expired session drew grey
 * rectangles for ever, because the refusal bounced to a default section whose
 * read had already failed and was cached.
 */
export async function readSection(
  id: SettingsSectionId
): Promise<SettingsSectionLoad> {
  try {
    const response = await fetch(`/api/settings/sections/${id}`);
    if (response.status === 401) return { ok: false, reason: "unauthorized" };
    if (!response.ok) return { ok: false, reason: "failed" };
    return (await response.json()) as SettingsSectionLoad;
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * THE IN-FLIGHT READS, CACHED OUTSIDE REACT — and they have to be outside.
 *
 * The section is unwrapped with `use()`, so the promise has to exist before the
 * render that consumes it. A promise minted during render is the documented
 * hazard React warns about, and this is what it looks like in practice
 * (measured on the preview): a render that SUSPENDS is discarded and replayed, a
 * replay re-runs `useMemo`, a re-run mints a second promise, and consuming that
 * one suspends again — a loop at about six reads a second for as long as the
 * modal stayed open. A `useMemo` cannot hold this because React is free to drop
 * it; module scope is not React's to drop.
 *
 * TWO ENTRIES, NOT ONE. React can render two keys inside one window: a
 * `refresh()` transition renders at the new `serverRenderId` while an urgent
 * update — a keystroke in the search box — re-renders the committed tree at the
 * old one. With a single slot each render evicts the other's promise and mints a
 * fresh one, which is the same loop at a lower rate.
 *
 * AND THEY DO NOT OUTLIVE THE VISIT: `onUrlChange` drops them the moment
 * settings closes, so what is held is only ever an in-flight REQUEST for the
 * modal on screen — never server data parked for later, which is what
 * `memory/invariants.md` → Client/Server Data Synchronization forbids.
 */
const requests = new Map<string, Promise<SettingsSectionLoad>>();

export function sectionRequest(
  id: SettingsSectionId,
  serverRenderId: string,
  attempt: number
): Promise<SettingsSectionLoad> {
  const key = `${id} ${serverRenderId} ${attempt}`;
  const existing = requests.get(key);
  if (existing) return existing;

  const request = readSection(id);
  requests.set(key, request);
  // Keep the previous key for the interleaved render above, and nothing older.
  for (const stale of [...requests.keys()].slice(0, -2)) requests.delete(stale);
  return request;
}

function forgetSection() {
  requests.clear();
}

/** Test seam: the module's per-document facts, reset between cases. */
export function __resetSettingsHashForTest() {
  listeners.clear();
  openedByPush = false;
  wasOpen = false;
  wasOn = "";
  historyWatched = false;
  requests.clear();
}
