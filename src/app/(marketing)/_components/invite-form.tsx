"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { requestInviteAction, type RequestInviteState } from "../actions";

const initialState: RequestInviteState = { status: "idle" };

export function InviteForm() {
  // A fresh key resets useActionState — that is how "use a different email"
  // gets the form back after a success, typo'd address and all.
  const [attempt, setAttempt] = useState(0);

  return (
    <InviteAttempt
      key={attempt}
      focusOnMount={attempt > 0}
      onStartOver={() => setAttempt((n) => n + 1)}
    />
  );
}

function InviteAttempt({
  focusOnMount,
  onStartOver,
}: {
  focusOnMount: boolean;
  onStartOver: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    requestInviteAction,
    initialState
  );
  const doneRef = useRef<HTMLParagraphElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const succeeded = state.status === "success";

  useEffect(() => {
    if (succeeded) doneRef.current?.focus();
  }, [succeeded]);

  useEffect(() => {
    if (focusOnMount) emailRef.current?.focus();
  }, [focusOnMount]);

  if (succeeded) {
    return (
      <div className="invite-done-wrap">
        <p className="invite-done" role="status" tabIndex={-1} ref={doneRef}>
          Thank you — we&rsquo;ve got your request. We&rsquo;ll be in touch as
          invites open up through sending networks and churches.
        </p>
        <button className="invite-again" type="button" onClick={onStartOver}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <>
      <form className="invite-form" action={formAction}>
        <label htmlFor="invite-email">Work email</label>
        <input
          id="invite-email"
          ref={emailRef}
          type="email"
          name="email"
          required
          placeholder="name@church.org"
          autoComplete="email"
        />
        {/* Honeypot — humans never see or fill this. */}
        <input
          type="text"
          name="website"
          className="invite-hp"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Request an invite"}
        </button>
      </form>
      {state.status === "error" ? (
        <p className="invite-error" role="alert">
          {state.message}
        </p>
      ) : (
        <p className="invite-note">
          Free while EveryField is in alpha — no card, nothing to cancel. We
          read every request and reply within a few days, and we&rsquo;ll only
          use your email to send your invite.
        </p>
      )}
    </>
  );
}
