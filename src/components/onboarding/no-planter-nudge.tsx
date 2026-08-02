"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { UserRoundX, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LEADERSHIP_STEP_HREF } from "@/lib/onboarding/leadership";

/**
 * F12 / OB-004 — the dashboard nudge for a church in the explicit no-planter
 * state.
 *
 * Persistent, not permanent: it comes back every session until the answer
 * changes, because a plant with no planter loses follow-up tasks silently and a
 * one-time toast would let that become invisible. Dismissal is per session
 * (`sessionStorage`) rather than per user, so "not right now" costs a click and
 * not the reminder.
 *
 * It links back into the leadership step — the one specced re-entry path into
 * onboarding; leaving the flow is otherwise one-way (ruling 2026-07-31).
 *
 * Dismissal is read through `useSyncExternalStore`, not `useState` +
 * `useEffect`: `sessionStorage` is an external store, and this is the hook that
 * subscribes to one without a cascading render. The server snapshot is
 * "dismissed", so the banner is absent from the SSR HTML and appears on
 * hydration — a planter who dismissed it never sees it flash back in on every
 * navigation, which for a banner that returns each session is the failure that
 * would make people stop reading it.
 */
const DISMISSED_KEY = "everyfield:no-planter-nudge-dismissed";

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function isDismissed() {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Showing the
    // nudge is the safe failure: the plant really does have no planter.
    return false;
  }
}

/** No storage on the server — treat it as dismissed and render nothing. */
function isDismissedOnServer() {
  return true;
}

function dismiss() {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, "true");
  } catch {
    // Nothing to do: without storage the nudge simply returns on the next
    // render, which is the same as it returning next session.
  }
  for (const listener of listeners) listener();
}

export function NoPlanterNudge() {
  const dismissed = useSyncExternalStore(
    subscribe,
    isDismissed,
    isDismissedOnServer
  );

  if (dismissed) return null;

  return (
    // `role="status"` over Alert's `role="alert"`: this is a standing condition,
    // not a time-sensitive interruption, and it mounts on hydration of every
    // dashboard load — assertive would talk over the page each time.
    <Alert role="status" data-testid="no-planter-nudge" className="pr-12">
      <UserRoundX />
      <AlertTitle>No planter assigned to this plant</AlertTitle>
      <AlertDescription>
        <p>
          You told us someone else will lead this plant. Until a planter is
          assigned, follow-up and evaluation tasks after a meeting have nobody
          to go to, so they are not created.
        </p>
        <Button asChild variant="outline" size="sm" className="cursor-pointer">
          <Link href={LEADERSHIP_STEP_HREF}>Change this answer</Link>
        </Button>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={dismiss}
        className="absolute top-2 right-2 cursor-pointer"
      >
        <X aria-hidden="true" />
        <span className="sr-only">Dismiss for this session</span>
      </Button>
    </Alert>
  );
}
