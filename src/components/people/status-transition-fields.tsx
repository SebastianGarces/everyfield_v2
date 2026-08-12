"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  isBackwardProgression,
  STATUS_LABELS,
} from "@/lib/people/status.shared";
import type { PersonStatus, StatusTransition } from "@/lib/people/types";
import { AlertTriangleIcon, ArrowDownIcon, InfoIcon } from "lucide-react";

interface StatusTransitionFieldsProps {
  from: PersonStatus;
  to: PersonStatus;
  transition: StatusTransition;
  reason: string;
  onReasonChange: (reason: string) => void;
}

/**
 * The shared body of the two status dialogs (StatusChangeModal and
 * StatusConfirmationModal): the backward-movement alert, the transition
 * warnings and the required-reason field exist ONCE here, so the copy shown
 * to the user cannot drift between the dropdown path and the drag-drop path.
 */
export function StatusTransitionFields({
  from,
  to,
  transition,
  reason,
  onReasonChange,
}: StatusTransitionFieldsProps) {
  const isMovingBackward = isBackwardProgression(from, to);

  return (
    <>
      {/* Backward Movement Warning */}
      {isMovingBackward && (
        <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <ArrowDownIcon className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <strong>Moving backward in the pipeline.</strong> This person will
            go from {STATUS_LABELS[from]} back to {STATUS_LABELS[to]}. Please
            provide a reason below.
          </AlertDescription>
        </Alert>
      )}

      {/* Other Warnings (skipping stages, etc.) */}
      {!isMovingBackward && transition.warnings.length > 0 && (
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

      {/* Reason - Required for all status changes */}
      <div className="space-y-2">
        <Label htmlFor="reason">
          Reason for change <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="reason"
          placeholder={
            isMovingBackward
              ? "Why is this person moving back in the pipeline? (e.g., changed circumstances, data correction, etc.)"
              : "Enter a reason for this status change..."
          }
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
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
    </>
  );
}
