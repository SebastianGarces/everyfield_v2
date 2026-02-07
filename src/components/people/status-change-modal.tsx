"use client";

import { changeStatusWithReasonAction } from "@/app/(dashboard)/people/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getAvailableStatuses,
  isBackwardProgression,
  STATUS_LABELS,
  validateStatusTransition,
} from "@/lib/people/status.shared";
import type { Person, PersonStatus } from "@/lib/people/types";
import { AlertTriangleIcon, ArrowDownIcon, InfoIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface StatusChangeModalProps {
  person: Person;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  onOptimisticUpdate?: (newStatus: PersonStatus) => void;
}

export function StatusChangeModal({
  person,
  open,
  onOpenChange,
  onSuccess,
  onOptimisticUpdate,
}: StatusChangeModalProps) {
  const router = useRouter();
  const [selectedStatus, setSelectedStatus] = useState<PersonStatus>(
    person.status
  );
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Get validation result for the selected transition
  const transition = validateStatusTransition(
    person.status,
    selectedStatus,
    person
  );

  const hasChanges = selectedStatus !== person.status;
  const isMovingBackward =
    hasChanges && isBackwardProgression(person.status, selectedStatus);
  const availableStatuses = getAvailableStatuses();

  const handleSubmit = () => {
    if (!hasChanges) return;

    setError(null);

    // Capture values before any state changes
    const statusValue = selectedStatus;
    const reasonValue = reason.trim() || undefined;

    // Close modal FIRST - this starts the close animation
    onOpenChange(false);

    // Delay the optimistic update and server action to let the modal
    // close animation complete before the person prop changes
    setTimeout(() => {
      startTransition(async () => {
        // Apply optimistic update after modal has started closing
        onOptimisticUpdate?.(statusValue);

        // Server action will reconcile via revalidatePath
        const result = await changeStatusWithReasonAction(
          person.id,
          statusValue,
          reasonValue
        );

        if (result.success) {
          toast.success("Status updated", {
            description: `Changed to ${STATUS_LABELS[statusValue]}`,
          });
          onSuccess?.();
        } else {
          // Show error toast
          toast.error("Failed to update status", {
            description: result.error,
          });
          // Refresh to revert the optimistic update with actual server state
          router.refresh();
        }
      });
    }, 150); // Wait for modal close animation to progress
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      // Reset form when OPENING to ensure fresh state
      // This avoids visual changes during close animation
      setSelectedStatus(person.status);
      setReason("");
      setError(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Status</DialogTitle>
          <DialogDescription>
            Update the pipeline status for {person.firstName} {person.lastName}.
            Current status: <strong>{STATUS_LABELS[person.status]}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status Select */}
          <div className="space-y-2">
            <Label htmlFor="status">New Status</Label>
            <Select
              value={selectedStatus}
              onValueChange={(value) =>
                setSelectedStatus(value as PersonStatus)
              }
            >
              <SelectTrigger id="status" className="w-full">
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                {availableStatuses.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                    {status.value === person.status && " (current)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Backward Movement Warning */}
          {isMovingBackward && (
            <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
              <ArrowDownIcon className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>Moving backward in the pipeline.</strong> This person
                will go from {STATUS_LABELS[person.status]} back to{" "}
                {STATUS_LABELS[selectedStatus]}. Please provide a reason below.
              </AlertDescription>
            </Alert>
          )}

          {/* Other Warnings */}
          {hasChanges &&
            !isMovingBackward &&
            transition.warnings.length > 0 && (
              <div className="space-y-2">
                {transition.warnings.map((warning, index) => (
                  <Alert key={index} variant="default">
                    {transition.requiresConfirmation ? (
                      <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
                    ) : (
                      <InfoIcon className="h-4 w-4 text-blue-500" />
                    )}
                    <AlertDescription>{warning}</AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

          {/* Reason - Required for backward, optional otherwise */}
          {hasChanges && (
            <div className="space-y-2">
              <Label htmlFor="reason">
                {isMovingBackward ? (
                  <>
                    Reason for moving backward{" "}
                    <span className="text-amber-600 dark:text-amber-400">
                      (recommended)
                    </span>
                  </>
                ) : (
                  <>
                    Reason for change{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </>
                )}
              </Label>
              <Textarea
                id="reason"
                placeholder={
                  isMovingBackward
                    ? "Why is this person moving back in the pipeline? (e.g., changed circumstances, data correction, etc.)"
                    : "Enter a reason for this status change..."
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className={
                  isMovingBackward
                    ? "border-amber-500/50 focus-visible:ring-amber-500"
                    : ""
                }
              />
              <p className="text-muted-foreground text-xs">
                This will be recorded in the activity timeline.
              </p>
            </div>
          )}

          {/* Error display */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!hasChanges || isPending}
          >
            {isPending ? "Updating..." : "Update Status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
