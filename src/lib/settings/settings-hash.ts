"use client";

import {
  settingsSectionFromHash,
  settingsSectionHref,
  type SettingsSectionId,
} from "@/lib/settings/sections";
import type {
  SettingsSectionLoad,
  SettingsSectionViewOf,
} from "@/lib/settings/section-view";

// ============================================================================
// WHERE SETTINGS LIVES: `#settings/<section>`, and the rules for moving it
// (#657, ruled 2026-08-22).
//
// Settings is client state over whatever screen the reader is on, and the URL's
// FRAGMENT is that state. This module is the whole of it — the store the modal
// subscribes to, the history policy, and the section reads with their
// stale-while-revalidate cache — separated from the
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
    // A VISIT ENDS HERE. What survives it is the ANSWERS only — see
    // `dropReadsThatAreNotAnswers`. They are kept because `serverRenderId`
    // already says when they stopped being true (#673).
    dropReadsThatAreNotAnswers();
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
// The read, and the stale-while-revalidate cache in front of it
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
 * THE READS, CACHED OUTSIDE REACT — and they have to be outside.
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
 * ONE MAP, TWO JOBS, AND THAT IS WHY THE ANSWER IS KEPT BESIDE THE PROMISE
 * (#673). It is a stale-while-revalidate cache: the promise is what a render
 * suspends on, and `settled` is what a LATER visit can paint immediately while
 * the read for the current `serverRenderId` is still in flight. Deriving the
 * second from the first is impossible — a promise has no synchronous value —
 * and a parallel map of views would be a second place for "the newest answer
 * for this section" to be decided. Here it is one scan over one insertion-
 * ordered map, so an answer that arrives out of order cannot overwrite a newer
 * one: the newest READ wins, not the newest RESPONSE.
 *
 * THE KEY IS (scope, section, serverRenderId, attempt) and every part earns its
 * place. `serverRenderId` moves on every server render of the dashboard layout,
 * so it is already the invalidation signal a write needs — nothing new is
 * threaded for that. `attempt` is what makes a Retry a fresh request rather than
 * a replay of the cached failure. And `scope` is WHOSE answers these are.
 *
 * THE SCOPE IS NOT DECORATION — IT IS THE ONE THING KEEPING THIS CACHE OUT OF
 * ANOTHER ACCOUNT'S HANDS, and without it this shipped a real disclosure
 * (measured on the preview, before the fix). Signing out is a SERVER ACTION
 * ENDING IN `redirect()`, and a server redirect is a CLIENT-SIDE navigation
 * (→ `memory/invariants.md` → Client/Server Data Synchronization, measured for
 * #658): it reuses every layout segment the two routes share, so `/login` and
 * the dashboard share the root layout and THE DOCUMENT SURVIVES A SIGN-OUT. One
 * account's answers were therefore still here when the next account signed in on
 * the same tab, and `cachedSectionView` — which deliberately ignores
 * `serverRenderId`, since serving an answer from an older render is its whole
 * job — handed them straight over. What it looked like: sign in as a sending
 * church Owner, open settings, sign out, sign in as a coach, open settings, and
 * the first painted frame carried the PREVIOUS reader's name and email address
 * before the coach's own answer replaced it. Two accounts always differ in this
 * segment, so no entry of theirs can ever be found; every foreign entry is also
 * dropped on the first read of a new scope, so nothing lingers to be found by a
 * later bug either.
 *
 * THREE READS PER SECTION, NOT ONE. React can render two keys inside one
 * window: a `refresh()` transition renders at the new `serverRenderId` while an
 * urgent update — a keystroke in the search box — re-renders the committed tree
 * at the old one. With a single slot each render evicts the other's promise and
 * mints a fresh one, which is the same loop at a lower rate. The third slot is
 * a retry's headroom. It is per SECTION because all five are prefetched
 * together, so a global cap of two would have the modal evicting its own
 * prefetch as it filled it.
 *
 * WHAT IS HELD, AND FOR HOW LONG. Module scope is per-TAB memory, so a new tab
 * and a full page load start empty — but the DOCUMENT is not the bound that
 * matters, as the scope note above says; the SCOPE is. A section this account may
 * not open is never held either: the prefetch walks `visibleIds`, and a gated
 * section reached by a typed fragment answers `{ ok: false, reason: "refused" }`,
 * which is not an answer and is never `settled.ok`.
 */
type SectionRead = {
  /** The one promise for these inputs — the loop above is what forbids a second. */
  promise: Promise<SettingsSectionLoad>;
  /** The answer once it lands; `null` while the read is in flight. */
  settled: SettingsSectionLoad | null;
};

const reads = new Map<string, SectionRead>();

/** See "THREE READS PER SECTION" above. */
const READS_PER_SECTION = 3;

/** Everything this scope's reads are filed under. Never build a key any other way. */
function keyPrefix(scope: string, id: SettingsSectionId): string {
  return `${scope} ${id} `;
}

export function sectionRequest(
  scope: string,
  id: SettingsSectionId,
  serverRenderId: string,
  attempt: number
): Promise<SettingsSectionLoad> {
  const key = `${keyPrefix(scope, id)}${serverRenderId} ${attempt}`;
  const existing = reads.get(key);
  if (existing) return existing.promise;

  // A NEW SCOPE EMPTIES THE MAP. Matching on the scope segment is already enough
  // to keep one account from finding another's answers; this is so nothing of
  // theirs is still sitting here to be found by a later mistake.
  for (const held of reads.keys()) {
    if (!held.startsWith(`${scope} `)) reads.delete(held);
  }

  const entry: SectionRead = {
    settled: null,
    // `entry` is referenced from a callback that cannot run before the object
    // exists, so the cycle is only apparent.
    promise: readSection(id).then((load) => {
      entry.settled = load;
      return load;
    }),
  };
  reads.set(key, entry);

  const prefix = keyPrefix(scope, id);
  const mine = [...reads.keys()].filter((held) => held.startsWith(prefix));
  for (const stale of mine.slice(0, -READS_PER_SECTION)) reads.delete(stale);
  return entry.promise;
}

/**
 * The newest ANSWER THIS SCOPE holds for a section, or `null` for one it has
 * never loaded.
 *
 * THIS IS PRESENTATION, NOT STATE (#673, `memory/invariants.md` →
 * Client/Server Data Synchronization). Its one caller paints it as the Suspense
 * fallback for the read at the CURRENT `serverRenderId` — so it is on screen
 * only while that read is in flight, and the fresh answer replaces it the moment
 * it lands. Nothing reads it without a revalidation running, and nothing stores
 * it in React state.
 *
 * IT IGNORES `serverRenderId` ON PURPOSE — serving an answer from an older
 * render IS the feature — which is exactly why it must NOT ignore the scope. See
 * the scope note above for what that cost before it was keyed.
 *
 * Newest READ rather than newest RESPONSE: the map is insertion-ordered, so the
 * last matching entry is the most recently ASKED, and a slower earlier read that
 * settles afterwards is passed over rather than allowed to win.
 *
 * THE TAG IS CHECKED HERE, which is what makes the return type true. The caller
 * pairs this view with the body for `id`, and this is the boundary where the
 * cache's key and the answer's own `section` field meet.
 */
export function cachedSectionView<Id extends SettingsSectionId>(
  scope: string,
  id: Id
): SettingsSectionViewOf<Id> | null {
  const prefix = keyPrefix(scope, id);
  let newest: SettingsSectionViewOf<Id> | null = null;
  for (const [key, entry] of reads) {
    if (!key.startsWith(prefix)) continue;
    const settled = entry.settled;
    if (settled?.ok && settled.view.section === id) {
      newest = settled.view as SettingsSectionViewOf<Id>;
    }
  }
  return newest;
}

/**
 * Closing keeps the ANSWERS and drops everything else (#673).
 *
 * The answers stay, because `serverRenderId` already says when they stopped
 * being true. Closing moves neither it nor the section, so what #657 dropped
 * here to avoid serving "the previous visit's roster" is now served on purpose
 * — with a revalidation in flight whenever the render id has moved.
 *
 * A FAILURE HAS TO BE CACHED WITHIN A VISIT — a key that mints a new promise on
 * every render is the replay loop above, so the cached failure is what lets the
 * pane say so and stand still — AND MUST NOT SURVIVE ONE. `attempt` is the
 * dialog's own state and resets to 0 when the modal unmounts, so a kept failure
 * would be replayed on the next opening under the very key the reader arrives
 * back on, and a section that failed once would look broken for as long as the
 * tab lived.
 *
 * SO THE TEST IS "IS THIS AN ANSWER", NOT "DID THIS FAIL", and the difference is
 * a bug that the prefetch made five wide. A read still IN FLIGHT at close has
 * settled to nothing yet, so asking whether it failed says no and keeps it — and
 * it then writes its failure into a map nobody will clear, under attempt 0, at a
 * render id that has not moved. Opening settings starts five reads; closing a
 * second later can leave all five in flight, and any that fail are cached
 * failures for sections the reader never even looked at. Dropping them here is
 * safe precisely because the dialog has gone: nothing is suspended on those
 * promises, so re-minting one is not the replay loop, it is one more request.
 */
function dropReadsThatAreNotAnswers() {
  for (const [key, entry] of reads) {
    if (!entry.settled?.ok) reads.delete(key);
  }
}

/** Test seam: the module's per-document facts, reset between cases. */
export function __resetSettingsHashForTest() {
  listeners.clear();
  openedByPush = false;
  wasOpen = false;
  wasOn = "";
  historyWatched = false;
  reads.clear();
}
