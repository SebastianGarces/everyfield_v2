"use client";

import { Check } from "lucide-react";
import { useRef, useState } from "react";

// The DOM owns the draft. State describes whether it differs and what its save
// is doing. Requests are sequenced and capture their values before entering the
// queue. A successful acknowledgement bridges the gap until refreshed props arrive.

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
  reset,
}: {
  /**
   * What the DOM holds, spelled so that two equal ANSWERS compare equal —
   * trimmed text, a number rather than its digits. Asked on every commit.
   */
  typed: () => string;
  /** The server's value in that same spelling. */
  stored: string;
  /** Write what the DOM holds. Only called when the commit is a `save`. */
  save: (value: string) => Promise<SaveOutcome>;
  /** Restore the displayed draft to the last accepted value. */
  reset: (value: string) => void;
}) {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [dirty, setDirty] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const sent = useRef<string | null>(null);
  const latestCommit = useRef(0);
  const accepted = useRef<{
    value: string;
    superseded: readonly string[];
  } | null>(null);
  const baseline = () => {
    if (
      accepted.current &&
      (stored === accepted.current.value ||
        !accepted.current.superseded.includes(stored))
    ) {
      accepted.current = null;
      if (state.status !== "saving") sent.current = null;
    }
    return accepted.current?.value ?? stored;
  };

  const onInput = () => setDirty(typed() !== baseline());
  const revert = () => {
    if (state.status === "saving") return;
    reset(baseline());
    setDirty(false);
    setState({ status: "idle" });
  };

  const commit = () => {
    // The prop has caught up with our last write, so the two are one fact and
    // only the prop needs keeping — which puts the field back under the plain
    // "agrees with the server" arm below.
    if (sent.current === stored) sent.current = null;

    const value = typed();
    const decision = decideCommit({
      typed: value,
      stored: baseline(),
      sent: sent.current,
    });

    if (decision === "nothing") return;
    if (decision === "reset") {
      if (state.status === "saving") return;
      // Put back to what the server holds — including after a refusal, because
      // the planter has just undone whatever was refused.
      setDirty(false);
      setState({ status: "idle" });
      return;
    }

    const commitId = ++latestCommit.current;
    sent.current = value;
    setState({ status: "saving" });

    let superseded: readonly string[] = [stored];
    chain.current = chain.current
      .then(() => {
        // A queued write may start after an earlier write has succeeded. Those
        // earlier values can still arrive as props while this request settles.
        if (accepted.current) {
          superseded = [
            ...superseded,
            ...accepted.current.superseded,
            accepted.current.value,
          ];
        }
        return save(value);
      })
      .then((result) => {
        if (result.success) accepted.current = { value, superseded };
        if (commitId !== latestCommit.current) return;
        if (!result.success) sent.current = null;
        setDirty(!result.success || typed() !== value);
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
        if (commitId !== latestCommit.current) return;
        sent.current = null;
        setDirty(true);
        setState({
          status: "failed",
          message: "Unable to save. Check your connection and try again.",
          invalid: [],
        });
      });
  };

  return {
    state,
    commit,
    dirty,
    revert,
    editProps: {
      onInput,
      "data-uncommitted":
        dirty || state.status === "saving" ? "true" : undefined,
    },
  };
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
  dirty,
  revert,
}: {
  id: string;
  state: SaveState;
  dirty: boolean;
  revert: () => void;
}) {
  const failed = state.status === "failed";

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        {dirty && state.status !== "saving" && !failed ? "Not saved" : null}
        {state.status === "saved" && !dirty ? (
          <>
            {/* Never colour alone — better-accessibility rule 9 wants a
              redundant cue, so the tick rides beside the word. */}
            <Check className="size-3" aria-hidden="true" />
            Saved
          </>
        ) : null}
        {failed ? state.message : null}
      </p>
      {(dirty || state.status === "saving") && (
        <button
          type="button"
          disabled={state.status === "saving"}
          onClick={revert}
          className="text-muted-foreground cursor-pointer text-xs underline underline-offset-4 disabled:opacity-50"
        >
          Revert edit
        </button>
      )}
    </div>
  );
}

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
