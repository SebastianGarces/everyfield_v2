"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * F12 / OB-010 + OB-011 — "dismissible", as a hook.
 *
 * Web storage is an EXTERNAL STORE, so it is read with `useSyncExternalStore`
 * rather than `useState` + `useEffect` (`memory/contracts/data-patterns.md`:
 * effects are for external systems, not for holding a value the render needs).
 * Same mechanism the no-planter nudge has used since OB-004; this is the shared
 * version, because the two dismissals OB-010 and OB-011 add differ from it only
 * in their key and their lifetime.
 *
 * THE SERVER SNAPSHOT IS "dismissed" on purpose. The banner is therefore absent
 * from the SSR HTML and appears on hydration, so somebody who dismissed it never
 * watches it flash back in on every navigation — for a banner whose whole
 * promise is "never again", that flash would be the bug people remember.
 *
 * WHAT THIS DOES NOT DO. Storage is per browser, not per user: dismissing on a
 * laptop does not dismiss on a phone. Making it per user means a column and a
 * migration; until then the prompts that must never come back are additionally
 * closed by their own data — an answered leadership question stops
 * `shouldPromptPastorConfirmation` cold, whatever any storage says — so the
 * worst case is one more sighting on a second device, not a re-ask of something
 * already answered.
 */
export type DismissalScope = "session" | "forever";

const listeners = new Map<string, Set<() => void>>();

function storageFor(scope: DismissalScope): Storage {
  return scope === "session" ? window.sessionStorage : window.localStorage;
}

function readDismissed(key: string, scope: DismissalScope): boolean {
  try {
    return storageFor(scope).getItem(key) === "true";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Showing the
    // banner is the safe failure: whatever it is about is still true.
    return false;
  }
}

function notify(key: string) {
  const subscribers = listeners.get(key);
  if (!subscribers) return;
  for (const listener of subscribers) listener();
}

/**
 * Keys are church-scoped so one plant's dismissal is not another's. A viewer
 * with no church (`null`) shares the literal `null` bucket — the key this
 * template has always minted for them.
 */
export function dismissalKey(name: string, churchId: string | null): string {
  return `everyfield:${name}:${churchId}`;
}

export function useDismissed(key: string, scope: DismissalScope) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      let subscribers = listeners.get(key);
      if (!subscribers) {
        subscribers = new Set();
        listeners.set(key, subscribers);
      }
      subscribers.add(onStoreChange);
      return () => {
        subscribers.delete(onStoreChange);
      };
    },
    [key]
  );

  const getSnapshot = useCallback(
    () => readDismissed(key, scope),
    [key, scope]
  );

  const dismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => true // no storage on the server — render nothing
  );

  const dismiss = useCallback(() => {
    try {
      storageFor(scope).setItem(key, "true");
    } catch {
      // Without storage the banner returns on the next render, which is the
      // same as it returning next session. Nothing to recover from.
    }
    notify(key);
  }, [key, scope]);

  return { dismissed, dismiss };
}
