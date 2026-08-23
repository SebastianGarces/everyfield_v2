"use client";

import { Check } from "lucide-react";
import { useRef, useState } from "react";

// ============================================================================
// SAVE ON LEAVING, ONCE (#618).
//
// The church profile's five text fields and its two day counts both commit when
// focus leaves them — or when Enter says the planter has finished — and both
// report what they did in one line underneath. Written twice, the two copies
// drifted immediately — one of them committed on each input's blur and refused
// the planter halfway through editing a pair — so the machine lives here and the
// components are markup.
//
// ----------------------------------------------------------------------------
// WHY THERE IS NO `useOptimistic` HERE
// ----------------------------------------------------------------------------
//
// memory/contracts/data-patterns.md is `useOptimistic` + a server `refresh()`,
// and every OTHER settings control follows it. A text input cannot: an
// optimistic value only moves inside a transition, so a controlled input bound
// to one refuses keystrokes.
//
// The house rule underneath it still holds, and holds more strictly than usual
// — SERVER DATA IS NEVER COPIED INTO REACT STATE. The DOM holds the draft
// (uncontrolled inputs, seeded once with `defaultValue`), the server holds the
// truth, and the only state here is `SaveState`, which describes a request
// rather than a value. `isDirty` asks the DOM against the server prop each time
// it is called, so nothing can go stale.
//
// It is also why a `refresh()` landing mid-edit cannot eat a keystroke: the
// re-render hands down a new `defaultValue`, and an uncontrolled input ignores
// it (better-accessibility → forms: "never lose typed input to a re-render").
//
// ----------------------------------------------------------------------------
// SAVES ARE SEQUENCED, AND THAT IS A CORRECTNESS RULE
// ----------------------------------------------------------------------------
//
// `isDirty` compares against the PROP, which lags until `refresh()` lands, so a
// planter who edits, blurs, refocuses and edits again has two writes to the same
// column in the air at once. Over neon-http nothing orders them, and the loser
// is whichever the database applies last — the DOM shows the newer text either
// way, so a silent lost update looks exactly like a save that worked.
//
// `chain` makes each field's writes strictly sequential. It is per-hook, so two
// DIFFERENT fields still save concurrently, which is what CS-015's independence
// means.
//
// ----------------------------------------------------------------------------
// AND IT IS ALSO WHY A COMMIT COMPARES AGAINST WHAT WE SENT, NOT ONLY THE PROP
// ----------------------------------------------------------------------------
//
// There are two ways to reach a commit — Enter and blur — and pressing Enter and
// then tabbing away reaches both, a keystroke apart. The prop cannot have caught
// up in that keystroke, so a comparison against the prop alone calls the second
// one dirty and writes the identical value again: two round trips, and a status
// line that says Saving… twice for one edit.
//
// So the hook remembers the value it last HANDED to `save` and has not since
// seen refused, and `decideCommit` treats that as the truth when it is newer
// than the prop. A refusal drops it, because the planter must be able to send
// the same text again once whatever refused it is gone.
// ============================================================================

/** What one field (or one field group) is doing right now. */
export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "failed"; message: string; invalid: readonly string[] };

/** What every settings action returns, narrowed to the part this cares about. */
export type SaveOutcome =
  | { success: true }
  | { success: false; error: string; invalid?: readonly string[] };

/**
 * What one commit should do, given the three values that decide it.
 *
 * Pure, and exported, for the same reason `commitOnEnter` is: the components
 * are not reachable from `pnpm test`, and this rule is the one a second commit
 * path can break silently — the write still happens, so nothing looks wrong.
 *
 * - `save` — the DOM holds an answer the server neither has nor is being told.
 * - `nothing` — this is the value already in flight, so the second of Enter and
 *   blur is not a second edit.
 * - `reset` — the DOM agrees with the server, so whatever the last save said is
 *   no longer about anything on screen.
 */
export type CommitDecision = "save" | "nothing" | "reset";

export function decideCommit({
  typed,
  stored,
  sent,
}: {
  /** What the DOM holds now. */
  typed: string;
  /** What the server held at the last render. Lags a write until `refresh()`. */
  stored: string;
  /** The value handed to `save` and not since refused, or null for neither. */
  sent: string | null;
}): CommitDecision {
  if (typed !== (sent ?? stored)) return "save";
  return sent === null ? "reset" : "nothing";
}

export function useFieldSave({
  typed,
  stored,
  save,
}: {
  /**
   * What the DOM holds, spelled so that two equal ANSWERS compare equal —
   * trimmed text, a number rather than its digits. Asked on every commit.
   */
  typed: () => string;
  /** The server's value in that same spelling. */
  stored: string;
  /** Write what the DOM holds. Only called when the commit is a `save`. */
  save: () => Promise<SaveOutcome>;
}): { state: SaveState; commit: () => void } {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const sent = useRef<string | null>(null);

  // NOT memoised, and NOT reading its callbacks out of a "latest" ref. `commit`
  // is handed to a DOM `onBlur`, so a fresh identity on every render costs nothing —
  // and closing over the CURRENT render's `typed`/`stored`/`save` is what makes
  // the comparison right without any ref housekeeping. (Writing a ref during
  // render is also what `react-hooks/refs` refuses, correctly.)
  const commit = () => {
    // The prop has caught up with our last write, so the two are one fact and
    // only the prop needs keeping — which puts the field back under the plain
    // "agrees with the server" arm below.
    if (sent.current === stored) sent.current = null;

    const value = typed();
    const decision = decideCommit({ typed: value, stored, sent: sent.current });

    if (decision === "nothing") return;
    if (decision === "reset") {
      // Put back to what the server holds — including after a refusal, because
      // the planter has just undone whatever was refused.
      setState({ status: "idle" });
      return;
    }

    sent.current = value;
    setState({ status: "saving" });

    chain.current = chain.current
      .then(() => save())
      .then((result) => {
        // `=== value` because the chain may already be carrying a NEWER commit
        // by the time this one answers, and that one's value is the live claim.
        if (!result.success && sent.current === value) sent.current = null;

        setState(
          result.success
            ? { status: "saved" }
            : {
                status: "failed",
                message: result.error,
                invalid: result.invalid ?? [],
              }
        );
      })
      .catch(() => {
        // A rejected action means the round trip failed, not that the value
        // was refused — the actions themselves return their refusals. Never
        // rethrow: an unhandled rejection here has nobody to tell.
        if (sent.current === value) sent.current = null;

        setState({
          status: "failed",
          message: "Unable to save. Check your connection and try again.",
          invalid: [],
        });
      });
  };

  return { state, commit };
}

/**
 * The one line under a field that says what the last save did.
 *
 * RENDERED ON EVERY PASS, never mounted together with its content — a polite
 * region inserted with its text already in it is announced inconsistently, and
 * this one updates on every save. Empty it has no line box, so it costs no
 * height while idle.
 *
 * `role="status"` rather than `role="alert"`: better-accessibility → forms
 * reserves `alert` for form-level errors not tied to a field, and every message
 * here is tied to one.
 */
export function FieldSaveStatus({
  id,
  state,
}: {
  id: string;
  state: SaveState;
}) {
  const failed = state.status === "failed";

  return (
    <p
      id={id}
      role="status"
      className={
        failed
          ? "text-destructive text-sm text-pretty"
          : "text-muted-foreground flex items-center gap-1 text-xs"
      }
    >
      {state.status === "saving" ? "Saving…" : null}
      {state.status === "saved" ? (
        <>
          {/* Never colour alone — better-accessibility rule 9 wants a
              redundant cue, so the tick rides beside the word. */}
          <Check className="size-3" aria-hidden="true" />
          Saved
        </>
      ) : null}
      {failed ? state.message : null}
    </p>
  );
}

// ----------------------------------------------------------------------------
// ESCAPE IS THE DIALOG'S, AND NOTHING HERE CAN TAKE IT — MEASURED (#618)
// ----------------------------------------------------------------------------
//
// This module shipped a `revertOnEscape` that was meant to make the first
// Escape cancel the edit and keep the modal open. IT NEVER RAN. Radix's
// dismissable layer attaches its handler as
//
//     ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true })
//
// (`@radix-ui/react-use-escape-keydown`), and a document listener in the CAPTURE
// phase fires before the event has travelled anywhere near the input — so no
// handler on the input, React or native, is reachable in time. On the preview
// the modal closed on the first press and the URL went to `/dashboard`; the
// unit test passed throughout, because it exercised the pure function and never
// the layer that defeats it.
//
// SO ESCAPE CLOSES THE MODAL AND AN UNCOMMITTED EDIT IS DISCARDED. Measured
// alongside it: nothing is saved wrongly — the field's stored value was still
// `Austin` after Escaping out of `ZZZTEST` — so this is ordinary "modal closed
// with something typed in it" and not a corrupted write.
//
// THE FIX BELONGS TO THE MODAL, NOT HERE. `DialogContent` takes
// `onEscapeKeyDown`, so the surface that owns the dialog can refuse the dismiss
// while anything inside it is uncommitted. That is `settings-modal.tsx`, shared
// by all six sections, and giving one section's fields a private channel up to
// it is the threading this repo tells you to stop and question. Carried as a
// follow-up rather than smuggled in here.

/**
 * Enter commits, because a lone input in a dialog has no form to submit and a
 * planter who types a name and presses Enter has finished.
 *
 * IT CALLS THE COMMIT AND DOES NOT BLUR. This used to reach the save by calling
 * `event.currentTarget.blur()`, which does save — and drops keyboard focus to
 * `<body>` on the way, measured on the preview: after Enter in City,
 * `document.activeElement` was BODY, so the next Tab restarted from the top of
 * the dialog and a screen-reader user lost their place for confirming an edit.
 * Saving is the effect the planter asked for; moving focus is not.
 *
 * `decideCommit` is what makes the blur that follows a tab-out free.
 */
export function commitOnEnter(commit: () => void) {
  return (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  };
}
