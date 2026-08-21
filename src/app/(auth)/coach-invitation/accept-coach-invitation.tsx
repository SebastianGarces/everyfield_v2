"use client";

import { Button } from "@/components/ui/button";
import { useActionState } from "react";
import { acceptCoachInvitationAction } from "./actions";

/**
 * The Accept button, for a viewer who is already signed in.
 *
 * The token rides in a HIDDEN FIELD rather than being read from the URL by the
 * action: `acceptCoachInvitationAction` is a POST endpoint that never saw this
 * page, so it re-resolves everything it is given and trusts none of it. The
 * address the token is bound to is checked against the SESSION, which is the one
 * value a form cannot supply.
 *
 * A success redirects, so there is no success state to render — only the one
 * refusal sentence, which is the same for every reason it could be refused.
 */
export function AcceptCoachInvitation({
  token,
  churchName,
}: {
  token: string;
  churchName: string;
}) {
  const [state, formAction, pending] = useActionState(
    acceptCoachInvitationAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="invitation" value={token} />

      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full cursor-pointer"
        disabled={pending}
      >
        {pending ? "Accepting…" : `Accept and coach ${churchName}`}
      </Button>
    </form>
  );
}
