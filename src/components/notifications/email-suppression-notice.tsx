"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { clearMyEmailSuppressionAction } from "@/app/(dashboard)/settings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// ============================================================================
// "We stopped emailing you" — and the way back (#324).
//
// A permanent bounce writes an `email_suppressions` row and every later send
// reads it. Without this notice the recipient is simply not emailed any more,
// with nothing on any screen saying so and no way back except an operator
// running SQL: the acceptance criterion is explicit that a bounce is not a life
// sentence, so the un-suppress half needs a surface, not just a function.
//
// It is SELF-SERVICE, on the screen the recipient already owns, because the
// person who can fix the mailbox is the person who holds it. The action behind
// the button takes no address at all — it reads the session's own — so this
// component has nothing to pass it and no id to get wrong.
//
// Whether the notice appears is the SERVER's decision (`isAddressSuppressed` in
// `/settings`), so nothing here holds server data: the notice is rendered from
// props, the action calls `refresh()`, and the re-render is what makes it
// disappear (memory/contracts/data-patterns.md). `useTransition` is UI state —
// "a request is in flight" — which is the legitimate kind.
// ============================================================================

interface EmailSuppressionNoticeProps {
  /** The reader's own address. Shown so they can see WHICH mailbox to fix. */
  email: string;
}

/** The heading, said plainly: what stopped, not what bounced. */
export const EMAIL_SUPPRESSION_NOTICE_TITLE =
  "We stopped emailing this address";

/** Confirmation, worded so a no-op clear is not reported as a failure. */
export const EMAIL_SUPPRESSION_CLEARED_MESSAGE = "Email is back on.";

export function EmailSuppressionNotice({ email }: EmailSuppressionNoticeProps) {
  const [pending, startTransition] = useTransition();

  function turnEmailBackOn() {
    startTransition(async () => {
      // The action RETURNS its failures. A server action that throws rejects
      // this promise and unwinds the transition without ever reaching the toast
      // — the reader would see the button settle and be told nothing (#236).
      const result = await clearMyEmailSuppressionAction();

      if (result.success) toast.success(EMAIL_SUPPRESSION_CLEARED_MESSAGE);
      else toast.error(result.error);
    });
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>{EMAIL_SUPPRESSION_NOTICE_TITLE}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p className="text-pretty">
          Mail to <span className="font-medium">{email}</span> came back
          permanently undeliverable, so EveryField stopped sending there. Your
          in-app notifications are unaffected. Once the mailbox works again,
          turn email back on — nothing else about your settings changes.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={turnEmailBackOn}
          disabled={pending}
        >
          {pending ? "Turning email back on…" : "Turn email back on"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
