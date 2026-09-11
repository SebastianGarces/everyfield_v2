"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptSeatInvitationAction } from "./actions";

export function AcceptSeatInvitation({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    acceptSeatInvitationAction,
    {}
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="invitation" value={token} />
      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="w-full cursor-pointer"
      >
        {pending ? "Accepting invitation…" : "Accept invitation"}
      </Button>
    </form>
  );
}
