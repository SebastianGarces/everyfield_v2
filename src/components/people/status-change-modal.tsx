"use client";

import { changeStatusWithReasonAction } from "@/app/(dashboard)/people/actions";
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
import {
  getAvailableStatuses,
  STATUS_LABELS,
  validateStatusTransition,
} from "@/lib/people/status.shared";
import type { PersonForClient, PersonStatus } from "@/lib/people/types";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusTransitionFields } from "./status-transition-fields";

interface StatusChangeModalProps {
  person: PersonForClient;
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

  // Get validation result for the selected transition
  const transition = validateStatusTransition(person.status, selectedStatus);

  const hasChanges = selectedStatus !== person.status;
  const availableStatuses = getAvailableStatuses();

  const handleSubmit = () => {
    if (!hasChanges) return;

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

          {/* Warnings + required reason — shared with the drag-drop modal */}
          {hasChanges && (
            <StatusTransitionFields
              from={person.status}
              to={selectedStatus}
              transition={transition}
              reason={reason}
              onReasonChange={setReason}
            />
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
            disabled={!hasChanges || isPending || !reason.trim()}
          >
            {isPending ? "Updating..." : "Update Status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
