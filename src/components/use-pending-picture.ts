"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { profilePhotoRefusal } from "@/lib/profile-photo";

// ============================================================================
// THE HALF OF A PICTURE CONTROL A REVIEWER CANNOT CHECK BY EYE (P-024).
//
// Two surfaces let somebody change a picture — a person's photo on the profile
// form, an account's own in settings — and since #654 they render ONE control,
// `picture-field.tsx`, which is this hook's only consumer. What lives here
// rather than there is the half a reviewer cannot check by eye: an optimistic
// preview, the object URL behind it, and the rule that every such URL is
// revoked exactly once. That logic shipped twice in #617 and had drifted before
// the branch was even reviewed; the markup did the same, one issue later.
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

/**
 * THREE OPTIONS, AND IT STARTED AS FIVE.
 *
 * The two that went were the same at both of the call sites there were then:
 * the gate (always `profilePhotoRefusal` — it is one rule by design, so letting
 * a caller choose it invites a second) and announcing the outcome (both spelled
 * the same toast, so the hook spells it once). A broad interface that hides
 * little is a reader learning the surface AND the implementation; what actually
 * varies is only what is shown, what to call, and what to call it — and since
 * #654 the one caller reads all three off `picture-field.tsx`'s subject table.
 */
type PendingPictureOptions = {
  /** The route the SERVER says the picture is at, or undefined for none. */
  storedSrc: string | undefined;
  send: {
    upload: (file: File) => Promise<PictureOutcome>;
    remove: () => Promise<PictureOutcome>;
  };
  /** What to say on success. A person has a photo; an account has a profile picture. */
  copy: { uploaded: string; removed: string };
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
  send,
  copy,
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

  // A plain closure, like `run` below. NEITHER is memoised, deliberately:
  // nothing depends on either identity, and memoising one invites somebody to
  // memoise the other — which would need `settle`, `send` and `copy` in a
  // dependency array that has to stay right for the revoke discipline to hold.
  const settle = (next: Pending | null) => {
    const previous = liveUrl.current;
    const nextUrl = next?.kind === "uploaded" ? next.objectUrl : null;

    if (previous && previous !== nextUrl) {
      URL.revokeObjectURL(previous);
    }

    liveUrl.current = nextUrl;
    setPending(next);
  };

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
          toast.error(outcome.message);
          return;
        }

        settle(onOk());
        toast.success(succeeded);
      } catch {
        // The request never got an answer — a dropped connection, a 500 with no
        // body, a rejected transition. Silence here is a spinner that stops and
        // nothing else, so the reader is told the same way any refusal tells
        // them.
        const message = "That did not reach us. Check your connection.";
        settle(null);
        setError(message);
        toast.error(message);
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
      const refusal = profilePhotoRefusal(file);
      if (refusal) {
        setError(refusal);
        toast.error(refusal);
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
