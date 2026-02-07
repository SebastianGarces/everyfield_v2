"use client";

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
import { Textarea } from "@/components/ui/textarea";
import {
  isBackwardProgression,
  STATUS_LABELS,
  validateStatusTransition,
} from "@/lib/people/status.shared";
import type { PersonStatus, PersonWithTags } from "@/lib/people/types";
import { AlertTriangleIcon, ArrowDownIcon } from "lucide-react";
import { useState } from "react";

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
 * Shows warnings and allows adding an optional reason/note.
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
  const transition = validateStatusTransition(person.status, newStatus, person);

  const isMovingBackward = isBackwardProgression(person.status, newStatus);

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

          {/* Backward Movement Warning */}
          {isMovingBackward && (
            <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
              <ArrowDownIcon className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>Moving backward in the pipeline.</strong> This person
                will go from {STATUS_LABELS[person.status]} back to{" "}
                {STATUS_LABELS[newStatus]}. Please provide a reason below.
              </AlertDescription>
            </Alert>
          )}

          {/* Other Warnings (skipping stages, etc.) */}
          {!isMovingBackward && transition.warnings.length > 0 && (
            <div className="space-y-2">
              {transition.warnings.map((warning, index) => (
                <Alert key={index} variant="default">
                  <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
                  <AlertDescription>{warning}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          {/* Reason - Recommended for backward, optional otherwise */}
          <div className="space-y-2">
            <Label htmlFor="reason">
              {isMovingBackward ? (
                <>
                  Reason for change{" "}
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
              placeholder="Enter a reason for this status change..."
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
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit}>
            Update Status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
