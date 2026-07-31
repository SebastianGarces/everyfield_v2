"use client";

import { useActionState } from "react";

import { requestInviteAction, type RequestInviteState } from "../actions";

const initialState: RequestInviteState = { status: "idle" };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(
    requestInviteAction,
    initialState
  );

  if (state.status === "success") {
    return (
      <p className="invite-done">
        Thank you — we&rsquo;ve got your request. We&rsquo;ll be in touch as
        invites open up through sending networks and churches.
      </p>
    );
  }

  return (
    <>
      <form className="invite-form" action={formAction}>
        <label htmlFor="invite-email">Work email</label>
        <input
          id="invite-email"
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
          We&rsquo;ll only use this to send your invite.
        </p>
      )}
    </>
  );
}
