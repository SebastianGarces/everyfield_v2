"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { resendToNonOpenersAction } from "@/app/(dashboard)/communication/actions";

interface ResendNonOpenersProps {
  communicationId: string;
  /** People this message reached who recorded no open. */
  nonOpenerCount: number;
  /** People who did open it — the other half of the sentence. */
  openedCount: number;
  /** Only a message that was actually sent can be resent. */
  canResend: boolean;
}

/**
 * Resend one message to the recipients who never opened it (COM-018).
 *
 * The count is resolved on the server and shown before the user confirms, so
 * what they agree to is what gets sent. The resend becomes its own message —
 * the original's tracking is left exactly as it was.
 */
export function ResendNonOpeners({
  communicationId,
  nonOpenerCount,
  openedCount,
  canResend,
}: ResendNonOpenersProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!canResend) return null;

  // Nobody left to reach: say so plainly rather than offering a button that
  // can only fail.
  if (nonOpenerCount === 0) {
    return (
      <p
        className="text-muted-foreground text-sm"
        data-testid="resend-nothing-to-do"
      >
        {openedCount > 0
          ? "Everyone opened this message — there is nobody left to resend to."
          : "There is nobody left to resend to."}
      </p>
    );
  }

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await resendToNonOpenersAction(communicationId);
      if ("error" in result && result.error) {
        toast.error(result.error);
        setOpen(false);
        return;
      }
      setOpen(false);
      toast.success(
        `Resent to ${nonOpenerCount} recipient${nonOpenerCount === 1 ? "" : "s"}.`
      );
      if ("communicationId" in result && result.communicationId) {
        router.push(`/communication/${result.communicationId}`);
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="cursor-pointer"
        data-testid="resend-non-openers"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Resend to {nonOpenerCount} who have not opened
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Resend to {nonOpenerCount} recipient
              {nonOpenerCount === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This sends the same message again to the{" "}
              <span data-testid="resend-confirm-count">{nonOpenerCount}</span>{" "}
              recipient{nonOpenerCount === 1 ? "" : "s"} with no open recorded.
              {openedCount > 0 && (
                <>
                  {" "}
                  The {openedCount} who already opened it will not be contacted
                  again.
                </>
              )}{" "}
              It is saved as a new message, so this one keeps its own delivery
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={(event) => {
                // Keep the dialog open while the send is in flight; it closes
                // once the action answers.
                event.preventDefault();
                handleConfirm();
              }}
              disabled={pending}
            >
              {pending ? "Resending..." : "Resend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
