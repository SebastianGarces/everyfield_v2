"use client";

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
  STATUS_LABELS,
  validateStatusTransition,
} from "@/lib/people/status.shared";
import type { PersonStatus, PersonWithTags } from "@/lib/people/types";
import { useState } from "react";
import { StatusTransitionFields } from "./status-transition-fields";

interface StatusConfirmationModalProps {
  person: PersonWithTags;
  newStatus: PersonStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason?: string) => void;
}

/**
 * A simplified status change modal for pipeline drag-drop.
 * The new status is pre-determined (by the target column), so there's no dropdown.
 * Shows warnings and allows adding a reason/note.
 */
export function StatusConfirmationModal({
  person,
  newStatus,
  open,
  onOpenChange,
  onConfirm,
}: StatusConfirmationModalProps) {
  const [reason, setReason] = useState("");

  // Get validation result for the transition
  const transition = validateStatusTransition(person.status, newStatus);

  const handleSubmit = () => {
    const reasonValue = reason.trim() || undefined;
    onConfirm(reasonValue);
    // Reset state after confirm
    setReason("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      // Reset form when opening
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
          {/* New Status Display */}
          <div className="space-y-2">
            <Label>New Status</Label>
            <div className="bg-muted rounded-md border px-3 py-2 text-sm">
              {STATUS_LABELS[newStatus]}
            </div>
          </div>

          {/* Warnings + required reason — shared with the dropdown modal */}
          <StatusTransitionFields
            from={person.status}
            to={newStatus}
            transition={transition}
            reason={reason}
            onReasonChange={setReason}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!reason.trim()}
          >
            Update Status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
