"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import {
  acceptAssociationInvitation,
  declineAssociationInvitation,
} from "./actions";

// ============================================================================
// The two answers to an invitation (#304, OV-004/OV-006).
//
// Shared by the settings association area and the dashboard reminder, so the
// planter answers the same question the same way wherever they meet it — and so
// "the reminder is dismissed only by ANSWERING" is true by construction: this
// component has no dismiss, and there is no other control on either surface that
// makes the invitation go away.
//
// NO SERVER DATA IN STATE (`memory/contracts/data-patterns.md`). The invitation
// arrives as props from a server component and is never copied into `useState`;
// the only state here is UI state — a transition's pending flag and the last
// refusal message. On success there is nothing to update locally: the action
// calls `refresh()`, the server re-renders without this invitation, and the
// component unmounts.
//
// Neither button is `useOptimistic`-shaped either, deliberately. An optimistic
// accept would show the plant as associated before the server had decided, and
// an accept can genuinely be refused after the click — the slot may have been
// taken, or the invitation revoked. So the buttons go busy and the server
// answers; this is a decision, not a like button.
// ============================================================================

export function InvitationAnswer({
  invitationId,
  orgName,
}: {
  invitationId: string;
  orgName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function answer(action: typeof acceptAssociationInvitation) {
    setError(null);
    startTransition(async () => {
      const result = await action(invitationId);
      if (!result.success) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="cursor-pointer"
          disabled={pending}
          onClick={() => answer(acceptAssociationInvitation)}
        >
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={pending}
          onClick={() => answer(declineAssociationInvitation)}
        >
          Decline
        </Button>
      </div>
      {/* Named for a screen reader on both buttons at once: "Accept" alone is
          ambiguous on a dashboard that may carry two invitations. */}
      <p className="sr-only">
        Accept or decline the invitation from {orgName}.
      </p>
    </div>
  );
}
