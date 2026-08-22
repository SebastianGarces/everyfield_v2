"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

// ============================================================================
// THE HALF OF A PICTURE CONTROL A REVIEWER CANNOT CHECK BY EYE (P-024).
//
// Two surfaces let somebody change a picture — a person's photo on the profile
// form, an account's own in settings — and the markup of each is its own. What
// is NOT its own is this: an optimistic preview, the object URL behind it, and
// the rule that every such URL is revoked exactly once. That logic shipped
// twice in #617, and the copies had drifted before the branch was even reviewed.
//
// THREE THINGS IT GETS RIGHT THAT ARE EASY TO GET WRONG:
//
//   1. AN OBJECT URL IS REVOKED ON EVERY TRANSITION OFF IT, INCLUDING UNMOUNT.
//      `URL.createObjectURL` pins its blob for the life of the DOCUMENT, not the
//      component. The settings modal's common path is upload, close, unmount —
//      so without the cleanup below, up to 3MB stays pinned until the tab is
//      closed, and the leak is invisible in every screenshot.
//   2. THE REVOKE IS NOT A SIDE EFFECT INSIDE A STATE UPDATER. React requires
//      updaters to be pure and double-invokes them in StrictMode; doing it there
//      works today only because revoking twice happens to be harmless, which is
//      not a property the next edit inherits.
//   3. A REJECTED ACTION IS STILL AN ANSWER. A dropped connection rejects the
//      promise inside the transition — without a catch the spinner clears and
//      the reader is told nothing at all.
//
// ONE VALUE FOR "WHAT I JUST DID", not a preview string beside a `removed`
// boolean: those two can disagree, and "a preview I also removed" has no
// meaning. The absent case is `null` — nothing pending, so the stored value is
// what shows.
// ============================================================================

type Pending = { kind: "uploaded"; objectUrl: string } | { kind: "removed" };

/** What an action answers with, in the shape both surfaces' actions already have. */
export type PictureOutcome = { ok: true } | { ok: false; message: string };

type PendingPictureOptions = {
  /** The route the SERVER says the picture is at, or undefined for none. */
  storedSrc: string | undefined;
  /** Why this file cannot be a picture, or null — the gate, applied before the request exists. */
  refuse: (file: File) => string | null;
  send: {
    upload: (file: File) => Promise<PictureOutcome>;
    remove: () => Promise<PictureOutcome>;
  };
  /** What to say on success. The two surfaces name the thing differently. */
  copy: { uploaded: string; removed: string };
  /** Announce an outcome — a toast at both call sites. */
  onSettled: (outcome: { ok: boolean; message: string }) => void;
};

export type PendingPicture = {
  /** What to show right now: the pending picture if there is one, else the stored one. */
  src: string | undefined;
  /** Which control owns the spinner, or null when idle. */
  inFlight: "upload" | "remove" | null;
  /** The last refusal, to render and to point `aria-describedby` at. */
  error: string | null;
  chooseFile: (file: File) => void;
  removePicture: () => void;
};

export function usePendingPicture({
  storedSrc,
  refuse,
  send,
  copy,
  onSettled,
}: PendingPictureOptions): PendingPicture {
  const [pending, setPending] = useState<Pending | null>(null);
  const [inFlight, setInFlight] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * The live object URL, mirrored out of state.
   *
   * The cleanup below runs at unmount, when the state it would need is already
   * whatever React last rendered — a ref is what survives to be revoked. It is
   * also what keeps the revoke OUT of the updater (point 2 above).
   */
  const liveUrl = useRef<string | null>(null);

  const settle = useCallback((next: Pending | null) => {
    const previous = liveUrl.current;
    const nextUrl = next?.kind === "uploaded" ? next.objectUrl : null;

    if (previous && previous !== nextUrl) {
      URL.revokeObjectURL(previous);
    }

    liveUrl.current = nextUrl;
    setPending(next);
  }, []);

  // The last one, at unmount. Every OTHER transition off an object URL is
  // already revoked by `settle`; this is the one no transition covers.
  useEffect(() => {
    return () => {
      if (liveUrl.current) {
        URL.revokeObjectURL(liveUrl.current);
        liveUrl.current = null;
      }
    };
  }, []);

  // What the reader just did outranks the stored value until the re-read lands:
  // a removal shows initials AT ONCE rather than the face it just deleted, and
  // an upload does not flash the fallback while the browser fetches the route
  // the new key points at.
  const src =
    pending === null
      ? storedSrc
      : pending.kind === "uploaded"
        ? pending.objectUrl
        : undefined;

  const run = (
    kind: "upload" | "remove",
    call: () => Promise<PictureOutcome>,
    onOk: () => Pending,
    succeeded: string
  ) => {
    setError(null);
    setInFlight(kind);

    startTransition(async () => {
      try {
        const outcome = await call();

        if (!outcome.ok) {
          // The server is the gate; a picker's `accept` is a convenience, and a
          // POST never saw one. A refusal drops the pending value so what shows
          // is what is actually stored.
          settle(null);
          setError(outcome.message);
          onSettled({ ok: false, message: outcome.message });
          return;
        }

        settle(onOk());
        onSettled({ ok: true, message: succeeded });
      } catch {
        // The request never got an answer — a dropped connection, a 500 with no
        // body, a rejected transition. Silence here is a spinner that stops and
        // nothing else, so the reader is told the same way any refusal tells
        // them.
        const message = "That did not reach us. Check your connection.";
        settle(null);
        setError(message);
        onSettled({ ok: false, message });
      } finally {
        setInFlight(null);
      }
    });
  };

  return {
    src,
    inFlight,
    error,
    chooseFile: (file) => {
      setError(null);

      // THE SAME RULE THE ACTION APPLIES, applied before the request exists. Not
      // a duplicate of the gate — one function, called from both sides — and it
      // is here because a file over the body cap never reaches the action: the
      // platform answers 413 and the reader gets a console error where a
      // sentence belongs.
      const refusal = refuse(file);
      if (refusal) {
        setError(refusal);
        onSettled({ ok: false, message: refusal });
        return;
      }

      run(
        "upload",
        () => send.upload(file),
        () => ({ kind: "uploaded", objectUrl: URL.createObjectURL(file) }),
        copy.uploaded
      );
    },
    removePicture: () =>
      run("remove", send.remove, () => ({ kind: "removed" }), copy.removed),
  };
}
