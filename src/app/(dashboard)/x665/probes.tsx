"use client";

// THROWAWAY — #665's bisect rig. Deleted before this branch merges.
//
// The 2x2. Rows are the ACTION (does it call `refresh()`), columns are the
// COMPONENT (does the success render keep the `<form>` that is mid-submission,
// or early-return a tree without it — which is what the original
// `VerifyEmailConfirm` did and `ChangeEmailForm` does not).

import { useActionState } from "react";

import {
  probeWithRefresh,
  probeWithoutRefresh,
  type ProbeOutcome,
} from "./actions";

type Action = () => Promise<ProbeOutcome>;

/** The shape `ChangeEmailForm` has: success renders INSIDE the same form. */
export function KeepsForm({ id, action }: { id: string; action: Action }) {
  const [state, formAction, submitting] = useActionState<
    ProbeOutcome | null,
    FormData
  >(async () => action(), null);

  return (
    <form action={formAction}>
      <p data-testid={`${id}-state`}>
        {state?.ok ? `COMMITTED ${state.stamp}` : "no state"}
      </p>
      <button type="submit" data-testid={`${id}-btn`} disabled={submitting}>
        {submitting ? "PENDING" : "press"}
      </button>
    </form>
  );
}

/** The shape the original `VerifyEmailConfirm` had: success early-returns a
 *  tree with no `<form>` in it at all. */
export function DropsForm({ id, action }: { id: string; action: Action }) {
  const [state, formAction, submitting] = useActionState<
    ProbeOutcome | null,
    FormData
  >(async () => action(), null);

  if (state?.ok) {
    return (
      <div>
        <p data-testid={`${id}-state`}>{`COMMITTED ${state.stamp}`}</p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <p data-testid={`${id}-state`}>no state</p>
      <button type="submit" data-testid={`${id}-btn`} disabled={submitting}>
        {submitting ? "PENDING" : "press"}
      </button>
    </form>
  );
}
